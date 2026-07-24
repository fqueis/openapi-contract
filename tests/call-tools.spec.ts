/**
 * Seam under test: call_endpoint MCP tool registration (opt-in gate).
 *
 * Covers:
 * 1. registerCallToolsIfEnabled skips registration when enableCalls is false
 * 2. registerCallToolsIfEnabled registers call_endpoint when enableCalls is true
 * 3. Handler delegates to the service and returns JSON / isError payloads
 *
 * Out of scope: URL builder and service HTTP edge cases (see call-url / call-endpoint specs).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { registerCallToolsIfEnabled } from '@tools/call.js';

import { createService } from './helpers/create-service.js';
import { createRecordingMcpServer } from './helpers/recording-mcp-server.js';
import { requestUrl } from './helpers/request-url.js';
import { sampleOpenApi } from './fixtures/sample-openapi.js';

describe('call_endpoint tool registration', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((fn) => fn()));
  });

  it('does not register call_endpoint when enableCalls is false', async () => {
    const { service } = await setup();
    const recording = createRecordingMcpServer();

    registerCallToolsIfEnabled(recording.server, service, false);

    expect(recording.toolNames()).not.toContain('call_endpoint');
  });

  it('registers call_endpoint when enableCalls is true', async () => {
    const { service } = await setup();
    const recording = createRecordingMcpServer();

    registerCallToolsIfEnabled(recording.server, service, true);

    expect(recording.toolNames()).toContain('call_endpoint');
  });

  it('returns the HTTP result payload for a successful call', async () => {
    const { service } = await setup();
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });
    const recording = createRecordingMcpServer();
    registerCallToolsIfEnabled(recording.server, service, true);

    const result = (await recording.call('call_endpoint', {
      backendId: 'demo',
      operationId: 'login',
      body: { email: 'a@b.com', password: 'x' },
    })) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text) as { status: number; method: string };
    expect(payload.status).toBe(200);
    expect(payload.method).toBe('POST');
  });

  it('maps incomplete lookup to isError without calling the backend API', async () => {
    const { service, apiCalls } = await setup();
    await service.useBackend({ baseUrl: 'http://localhost:3000', id: 'demo' });
    const recording = createRecordingMcpServer();
    registerCallToolsIfEnabled(recording.server, service, true);

    const result = (await recording.call('call_endpoint', {
      backendId: 'demo',
      method: 'GET',
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/operationId|method and path/i);
    expect(apiCalls).toEqual([]);
  });

  /**
   * Service + fetch that serves the sample OpenAPI and JSON API responses.
   */
  async function setup() {
    const apiCalls: string[] = [];
    const document = sampleOpenApi;
    const fetchImpl: typeof fetch = (input) => {
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
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };

    const created = await createService({ fetchImpl });
    cleanups.push(created.cleanup);
    return { service: created.service, apiCalls };
  }
});
