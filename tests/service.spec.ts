/**
 * Seam under test: OpenApiContractService (tool-facing orchestration).
 *
 * Covers:
 * 1. useBackend falls back when the preferred spec path fails
 * 2. Cached overview succeeds without crossing the HTTP boundary again
 * 3. Spec cache TTL expiry requires a fresh HTTP fetch
 * 4. getOperation returns dereferenced schemas, merged params, and examples
 * 5. getSchema by name and by `#/` ref; missing schema errors
 * 6. refresh / forget / clear lifecycle
 * 7. listTags, getSecurity, listOperations, searchOperations
 * 8. Agent-facing errors for missing backend / operation
 * 9. Sparse OpenAPI documents use empty overview fallbacks
 * 10. getOperation tolerates responses without content and non-object entries
 * 11. getSchema reports unresolvable null component schemas via $ref
 *
 * Out of scope: BackendRegistry TTL edge cases (see registry.spec), pure OpenAPI
 * transforms (see openapi-core.spec), MCP tool registration wrappers (see tools.spec).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { createService } from './helpers/create-service.js';
import { requestUrl } from './helpers/request-url.js';
import { sampleOpenApi } from './fixtures/sample-openapi.js';

describe('OpenApiContractService', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((fn) => fn()));
  });

  it('registers a backend by falling back when /docs-json fails', async () => {
    const { service } = await setup();

    const used = await service.useBackend({
      baseUrl: 'http://localhost:3000',
      id: 'demo',
    });

    expect(used.resolvedPath).toBe('/docs-yaml');
    expect(used.resolvedUrl).toBe('http://localhost:3000/docs-yaml');
  });

  it('serves a second overview from cache without crossing the HTTP boundary', async () => {
    const gate = createFetchGate();
    const { service } = await setup({ fetchImpl: gate.fetchImpl });
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });
    gate.close();

    const overview = await service.getApiOverview('demo');

    expect(overview.info.title).toBe('Sample API');
    expect(overview.operationCount).toBe(2);
    expect(overview.schemaCount).toBe(3);
  });

  it('refetches the OpenAPI document after the spec cache TTL expires', async () => {
    let now = 0;
    const gate = createFetchGate();
    const { service } = await setup({
      specCacheTtlMs: 1_000,
      now: () => now,
      fetchImpl: gate.fetchImpl,
    });
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });
    gate.close();

    now = 1_001;
    gate.open();
    const overview = await service.getApiOverview('demo');

    expect(overview.info.title).toBe('Sample API');
  });

  it('returns dereferenced schemas and a request example for an operation', async () => {
    const { service } = await setup();
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });

    const operation = await service.getOperation('demo', {
      method: 'POST',
      path: '/v1/auth/login',
    });

    expect(operation.requestBody?.content?.['application/json']).toMatchObject({
      schema: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
        },
      },
    });
    expect(operation.requestExample.body).toEqual({
      email: 'user@example.com',
      password: 'string',
    });
    expect(operation.security).toEqual([]);
  });

  it('merges path-level parameters into get_operation for path templates', async () => {
    const { service } = await setup();
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });

    const operation = await service.getOperation('demo', { operationId: 'getUser' });

    expect(operation.parameters.map((p) => p.name)).toEqual(['id', 'include']);
    expect(operation.requestExample.parameters).toMatchObject({
      id: 'string',
      include: 'profile',
    });
  });

  it('returns a component schema by name', async () => {
    const { service } = await setup();
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });

    const byName = await service.getSchema('demo', 'User');

    expect(byName.schema).toMatchObject({
      type: 'object',
      properties: {
        id: { type: 'string' },
        email: { type: 'string', format: 'email' },
      },
    });
  });

  it('returns a component schema by local $ref', async () => {
    const { service } = await setup();
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });

    const byRef = await service.getSchema('demo', '#/components/schemas/LoginRequest');

    expect(byRef.name).toBe('LoginRequest');
    expect(byRef.schema).toMatchObject({ required: ['email', 'password'] });
  });

  it('throws when a schema name is missing', async () => {
    const { service } = await setup();
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });

    await expect(service.getSchema('demo', 'Missing')).rejects.toThrow(/Schema "Missing" not found/);
  });

  it('refresh_backend forces a new OpenAPI fetch across the HTTP boundary', async () => {
    const gate = createFetchGate();
    const { service } = await setup({ fetchImpl: gate.fetchImpl });
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });
    gate.close();
    gate.open();

    const refreshed = await service.refreshBackend('demo');

    expect(refreshed.resolvedPath).toBe('/docs-yaml');
  });

  it('lists declared and operation-only tags sorted by name', async () => {
    const { service } = await setup();
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });

    expect(await service.listTags('demo')).toEqual([
      { name: 'auth', description: 'Authentication' },
      { name: 'users', description: undefined },
    ]);
  });

  it('returns global security when no operation is selected', async () => {
    const { service } = await setup();
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });

    const global = await service.getSecurity('demo');

    expect(global.globalSecurity).toEqual([{ bearerAuth: [] }]);
    expect(global.securitySchemes).toHaveProperty('bearerAuth');
    expect(global.operationSecurity).toBeUndefined();
  });

  it('returns explicit empty operation security for login', async () => {
    const { service } = await setup();
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });

    const login = await service.getSecurity('demo', { operationId: 'login' });

    expect(login.operationSecurity).toEqual([]);
    expect(login.operation).toMatchObject({ method: 'POST', path: '/v1/auth/login' });
  });

  it('returns null operation security when the operation omits security', async () => {
    const { service } = await setup();
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });

    const getUser = await service.getSecurity('demo', { method: 'GET', path: '/v1/users/{id}' });

    expect(getUser.operationSecurity).toBeNull();
  });

  it('lists operations filtered by tag', async () => {
    const { service } = await setup();
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });

    expect(await service.listOperations('demo', { tag: 'auth' })).toEqual([
      expect.objectContaining({ operationId: 'login', method: 'POST' }),
    ]);
  });

  it('lists operations filtered by method', async () => {
    const { service } = await setup();
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });

    expect(await service.listOperations('demo', { method: 'GET' })).toEqual([
      expect.objectContaining({ operationId: 'getUser' }),
    ]);
  });

  it('searches operations by free text against description', async () => {
    const { service } = await setup();
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });

    expect(await service.searchOperations('demo', 'credentials')).toEqual([
      expect.objectContaining({ operationId: 'login' }),
    ]);
  });

  it('forget removes one backend from the registry', async () => {
    const { service } = await setup();
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'a' });
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'b' });

    expect(await service.forgetBackend('a')).toBe(true);
    expect((await service.listBackends()).map((e) => e.id)).toEqual(['b']);
  });

  it('clear removes all backends so overview fails for prior ids', async () => {
    const { service } = await setup();
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'b' });

    expect(await service.clearBackends()).toBe(1);
    expect(await service.listBackends()).toEqual([]);
    await expect(service.getApiOverview('b')).rejects.toThrow(/not registered/);
  });

  it('throws when the backend id is missing from the registry', async () => {
    const { service } = await setup();

    await expect(service.getApiOverview('ghost')).rejects.toThrow(/Call use_backend/);
    await expect(service.refreshBackend('ghost')).rejects.toThrow(/not registered/);
  });

  it('throws when an operation lookup misses', async () => {
    const { service } = await setup();
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });

    await expect(service.getOperation('demo', { operationId: 'nope' })).rejects.toThrow(/Operation not found/);
    await expect(service.getSecurity('demo', { operationId: 'nope' })).rejects.toThrow(/list_operations/);
  });

  it('fills overview fields with empty fallbacks when the document is sparse', async () => {
    const sparse = {
      openapi: '3.0.0',
      paths: {},
    };
    const { service } = await setup({ document: sparse });
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'sparse' });

    const overview = await service.getApiOverview('sparse');

    expect(overview).toMatchObject({
      info: {},
      openapi: '3.0.0',
      servers: [],
      tagCount: 0,
      operationCount: 0,
      schemaCount: 0,
      security: [],
      securitySchemes: {},
    });
  });

  it('lists tags when the document omits the tags array entirely', async () => {
    const untitled = {
      openapi: '3.0.0',
      paths: {
        '/ping': {
          get: {
            operationId: 'ping',
            tags: ['ops'],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    };
    const { service } = await setup({ document: untitled });
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'ping' });

    expect(await service.listTags('ping')).toEqual([{ name: 'ops', description: undefined }]);
  });

  it('keeps non-object response entries and omits content when absent', async () => {
    const doc = {
      openapi: '3.0.0',
      paths: {
        '/v1/ping': {
          get: {
            operationId: 'ping',
            responses: {
              '204': { description: 'No Content' },
              default: 'unexpected',
            },
          },
        },
      },
    };
    const { service } = await setup({ document: doc });
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'ping' });

    const operation = await service.getOperation('ping', { operationId: 'ping' });

    expect(operation.responses['204']).toEqual({
      description: 'No Content',
      content: undefined,
    });
    expect(operation.responses.default).toBe('unexpected');
  });

  it('throws when a $ref resolves to a null component schema', async () => {
    const doc = {
      openapi: '3.0.0',
      paths: {},
      components: {
        schemas: {
          NullSchema: null,
        },
      },
    };
    const { service } = await setup({ document: doc });
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'nulls' });

    await expect(service.getSchema('nulls', '#/components/schemas/NullSchema')).rejects.toThrow(
      /Could not resolve schema/,
    );
  });

  /**
   * Creates a service fixture and registers its cleanup for `afterEach`.
   *
   * @param options - Forwarded to {@link createService}
   * @returns Service fixture (service, calls, cleanup)
   */
  async function setup(options?: Parameters<typeof createService>[0]) {
    const created = await createService(options);
    cleanups.push(created.cleanup);
    return created;
  }

  /**
   * Fetch double that can refuse further HTTP after the cache should serve hits.
   *
   * Proves cache behavior at the HTTP system boundary without asserting call counts.
   */
  function createFetchGate() {
    let open = true;

    const fetchImpl: typeof fetch = (input) => {
      if (!open) {
        return Promise.reject(new Error('unexpected HTTP fetch while cache should serve'));
      }

      const url = requestUrl(input);
      if (url.endsWith('/docs-json')) {
        return Promise.resolve(new Response('nope', { status: 404 }));
      }
      if (url.endsWith('/docs-yaml')) {
        return Promise.resolve(
          new Response(JSON.stringify(sampleOpenApi), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(new Response('missing', { status: 404 }));
    };

    return {
      fetchImpl,
      open: () => {
        open = true;
      },
      close: () => {
        open = false;
      },
    };
  }
});
