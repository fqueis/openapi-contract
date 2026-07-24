/**
 * Seam under test: OpenApiContractService.callEndpoint (HTTP execution).
 *
 * Covers:
 * 1. Successful JSON call against a registered operation
 * 2. HTTP 4xx still returns a result (does not throw)
 * 3. Missing path params throw before fetch
 * 4. Missing headerEnv values throw before fetch
 * 5. headerEnv overlays headers on the same header name
 * 6. Response body truncation when over callMaxBodyBytes
 * 7. TimeoutError / AbortError map to a timeout message
 * 8. Non-abort fetch failures are rethrown
 * 9. Missing operation throws before fetch
 * 10. Existing Content-Type is preserved when serializing a JSON body
 * 11. String bodies are sent without forcing application/json
 *
 * Out of scope: MCP tool registration; pure URL builder edge cases (call-url.spec).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { createService } from './helpers/create-service.js';
import { requestUrl } from './helpers/request-url.js';
import { sampleOpenApi } from './fixtures/sample-openapi.js';

describe('OpenApiContractService.callEndpoint', () => {
  const cleanups: Array<() => Promise<void>> = [];
  const previousEnv = new Map<string, string | undefined>();

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((fn) => fn()));
    for (const [key, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    previousEnv.clear();
  });

  it('executes a JSON operation and returns status, headers, body, url, method', async () => {
    const { service, apiCalls } = await setupWithApi();
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });

    const result = await service.callEndpoint({
      backendId: 'demo',
      operationId: 'login',
      body: { email: 'a@b.com', password: 'secret' },
    });

    expect(apiCalls).toEqual(['http://localhost:3000/v1/auth/login']);
    expect(result).toMatchObject({
      status: 200,
      method: 'POST',
      url: 'http://localhost:3000/v1/auth/login',
      body: { accessToken: 'tok' },
      truncated: false,
    });
    expect(result.headers['content-type']).toMatch(/application\/json/i);
  });

  it('returns HTTP 401 as a normal result without throwing', async () => {
    const { service } = await setupWithApi({
      apiHandler: () =>
        Promise.resolve(
          new Response(JSON.stringify({ message: 'Unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
        ),
    });
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });

    const result = await service.callEndpoint({
      backendId: 'demo',
      method: 'GET',
      path: '/v1/users/{id}',
      pathParams: { id: '1' },
    });

    expect(result.status).toBe(401);
    expect(result.body).toEqual({ message: 'Unauthorized' });
  });

  it('throws when a required path parameter is missing', async () => {
    const { service, apiCalls } = await setupWithApi();
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });

    await expect(
      service.callEndpoint({
        backendId: 'demo',
        operationId: 'getUser',
      }),
    ).rejects.toThrow(/path parameter "id"/i);
    expect(apiCalls).toEqual([]);
  });

  it('throws when a headerEnv variable is missing', async () => {
    const { service, apiCalls } = await setupWithApi();
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });
    snapshotEnv('MISSING_TOKEN');
    delete process.env.MISSING_TOKEN;

    await expect(
      service.callEndpoint({
        backendId: 'demo',
        operationId: 'getUser',
        pathParams: { id: '1' },
        headerEnv: { Authorization: 'MISSING_TOKEN' },
      }),
    ).rejects.toThrow(/MISSING_TOKEN/);
    expect(apiCalls).toEqual([]);
  });

  it('lets headerEnv win over literal headers for the same name', async () => {
    const captured: Array<{ headers: Headers }> = [];
    const { service } = await setupWithApi({
      apiHandler: (input, init) => {
        captured.push({ headers: new Headers(init?.headers) });
        return Promise.resolve(
          new Response(JSON.stringify({ id: '1' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      },
    });
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });
    snapshotEnv('API_TOKEN');
    process.env.API_TOKEN = 'from-env';

    await service.callEndpoint({
      backendId: 'demo',
      operationId: 'getUser',
      pathParams: { id: '1' },
      headers: { Authorization: 'Bearer literal' },
      headerEnv: { Authorization: 'API_TOKEN' },
    });

    expect(captured[0]?.headers.get('Authorization')).toBe('from-env');
  });

  it('truncates oversized response bodies and sets truncated true', async () => {
    const big = 'x'.repeat(50);
    const { service } = await setupWithApi({
      callMaxBodyBytes: 10,
      apiHandler: () =>
        Promise.resolve(
          new Response(big, {
            status: 200,
            headers: { 'content-type': 'text/plain' },
          }),
        ),
    });
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });

    const result = await service.callEndpoint({
      backendId: 'demo',
      operationId: 'getUser',
      pathParams: { id: '1' },
    });

    expect(result.truncated).toBe(true);
    expect(result.body).toBe('xxxxxxxxxx');
  });

  it('maps TimeoutError from fetch into a call_endpoint timeout message', async () => {
    const { service } = await setupWithApi({
      apiHandler: () => {
        const error = new Error('aborted');
        error.name = 'TimeoutError';
        return Promise.reject(error);
      },
    });
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });

    await expect(
      service.callEndpoint({
        backendId: 'demo',
        operationId: 'login',
        body: { email: 'a@b.com', password: 'x' },
      }),
    ).rejects.toThrow(/timed out after \d+ms/);
  });

  it('maps AbortError from fetch into a call_endpoint timeout message', async () => {
    const { service } = await setupWithApi({
      apiHandler: () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      },
    });
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });

    await expect(
      service.callEndpoint({
        backendId: 'demo',
        operationId: 'getUser',
        pathParams: { id: '1' },
      }),
    ).rejects.toThrow(/timed out after/);
  });

  it('rethrows non-abort fetch failures', async () => {
    const { service } = await setupWithApi({
      apiHandler: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });

    await expect(
      service.callEndpoint({
        backendId: 'demo',
        operationId: 'getUser',
        pathParams: { id: '1' },
      }),
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('throws when the operation lookup misses before calling the API', async () => {
    const { service, apiCalls } = await setupWithApi();
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });

    await expect(
      service.callEndpoint({
        backendId: 'demo',
        operationId: 'doesNotExist',
      }),
    ).rejects.toThrow(/Operation not found/);
    expect(apiCalls).toEqual([]);
  });

  it('keeps an explicit Content-Type when the body is a JSON object', async () => {
    const captured: Array<{ headers: Headers; body?: string }> = [];
    const { service } = await setupWithApi({
      apiHandler: (_input, init) => {
        captured.push({
          headers: new Headers(init?.headers),
          body: typeof init?.body === 'string' ? init.body : undefined,
        });
        return Promise.resolve(
          new Response('ok', {
            status: 200,
            headers: { 'content-type': 'text/plain' },
          }),
        );
      },
    });
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });

    await service.callEndpoint({
      backendId: 'demo',
      operationId: 'login',
      body: { email: 'a@b.com', password: 'x' },
      headers: { 'Content-Type': 'application/xml' },
    });

    expect(captured[0]?.headers.get('Content-Type')).toBe('application/xml');
    expect(captured[0]?.body).toBe(JSON.stringify({ email: 'a@b.com', password: 'x' }));
  });

  it('sends a string body without forcing application/json', async () => {
    const captured: Array<{ headers: Headers; body?: string }> = [];
    const { service } = await setupWithApi({
      apiHandler: (_input, init) => {
        captured.push({
          headers: new Headers(init?.headers),
          body: typeof init?.body === 'string' ? init.body : undefined,
        });
        return Promise.resolve(new Response('ok', { status: 200 }));
      },
    });
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });

    await service.callEndpoint({
      backendId: 'demo',
      operationId: 'login',
      body: 'raw-payload',
    });

    expect(captured[0]?.body).toBe('raw-payload');
    expect(captured[0]?.headers.get('Content-Type')).toBeNull();
  });

  /**
   * Remembers a process.env key so afterEach can restore it.
   *
   * @param key - Env key
   */
  function snapshotEnv(key: string) {
    if (!previousEnv.has(key)) {
      previousEnv.set(key, process.env[key]);
    }
  }

  /**
   * Builds a service whose fetch serves the sample OpenAPI and API routes.
   *
   * @param options - Optional API handler and callMaxBodyBytes override
   */
  async function setupWithApi(
    options: {
      apiHandler?: (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response>;
      callMaxBodyBytes?: number;
    } = {},
  ) {
    const apiCalls: string[] = [];
    const document = sampleOpenApi;

    const fetchImpl: typeof fetch = (input, init) => {
      const url = requestUrl(input);

      if (url.endsWith('/docs-json')) {
        return Promise.resolve(new Response('nope', { status: 404 }));
      }
      if (url.endsWith('/docs-yaml')) {
        return Promise.resolve(
          new Response(JSON.stringify(document), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }

      apiCalls.push(url);
      if (options.apiHandler) {
        return options.apiHandler(input, init);
      }
      return Promise.resolve(
        new Response(JSON.stringify({ accessToken: 'tok', id: '1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };

    const created = await createService({ fetchImpl });
    if (options.callMaxBodyBytes !== undefined) {
      (created.service.config as { callMaxBodyBytes: number }).callMaxBodyBytes = options.callMaxBodyBytes;
    }
    cleanups.push(created.cleanup);
    return { service: created.service, apiCalls };
  }
});
