/**
 * Seam under test: OpenAPI fetch helpers (candidate URLs, body parse, shape guard, fetch loop).
 *
 * Covers:
 * 1. Ordered unique candidate URLs from a backend entry
 * 2. JSON and YAML body parsing (including empty/invalid bodies)
 * 3. Rejection of non-OpenAPI payloads
 * 4. fetchOpenApiDocument success, HTTP failures, and total failure
 *
 * Out of scope: registry persistence, MCP tool wrappers.
 */

import { describe, expect, it } from 'vitest';

import type { BackendEntry } from '@/registry.js';
import {
  assertLooksLikeOpenApi,
  buildSpecCandidateUrls,
  fetchOpenApiDocument,
  parseOpenApiBody,
} from '@openapi/fetch.js';

import { requestUrl } from './helpers/request-url.js';

describe('OpenAPI fetch helpers', () => {
  const backend: BackendEntry = {
    id: 'demo',
    baseUrl: 'http://localhost:3000',
    specPath: '/docs-json',
    lastUsedAt: 0,
  };

  it('lists /docs-json first then known fallbacks without duplicates', () => {
    expect(buildSpecCandidateUrls(backend)).toEqual([
      'http://localhost:3000/docs-json',
      'http://localhost:3000/docs-yaml',
      'http://localhost:3000/openapi.json',
      'http://localhost:3000/v3/api-docs',
    ]);
  });

  it('parses a JSON OpenAPI body', () => {
    const document = parseOpenApiBody('{"openapi":"3.0.0","paths":{}}', 'http://localhost:3000/docs-json');

    expect(document.openapi).toBe('3.0.0');
  });

  it('parses a YAML OpenAPI body', () => {
    const document = parseOpenApiBody('openapi: "3.0.0"\npaths: {}\n', 'http://localhost:3000/docs-yaml');

    expect(document.openapi).toBe('3.0.0');
  });

  it('falls back to YAML when JSON parse fails for a non-yaml URL', () => {
    const document = parseOpenApiBody('openapi: "3.1.0"\npaths: {}\n', 'http://localhost:3000/docs-json');
    expect(document.openapi).toBe('3.1.0');
  });

  it('rejects empty or non-object OpenAPI bodies', () => {
    expect(() => parseOpenApiBody('   ', 'http://localhost:3000/x')).toThrow(/Empty response body/);
    expect(() => parseOpenApiBody('- just a list\n', 'http://localhost:3000/docs-yaml')).toThrow(
      /did not parse to an object/,
    );
  });

  it('rejects a payload that is not an OpenAPI document', () => {
    expect(() => assertLooksLikeOpenApi({ foo: 1 }, 'http://localhost:3000/x')).toThrow(/does not look like/);
  });

  it('accepts swagger version or paths-only documents', () => {
    expect(() => assertLooksLikeOpenApi({ swagger: '2.0' }, 'http://x')).not.toThrow();
    expect(() => assertLooksLikeOpenApi({ paths: {} }, 'http://x')).not.toThrow();
  });

  it('fetchOpenApiDocument returns the first successful candidate', async () => {
    const fetchImpl: typeof fetch = (input) => {
      const url = requestUrl(input);
      if (url.endsWith('/docs-json')) {
        return Promise.resolve(new Response('nope', { status: 404 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ openapi: '3.0.0', paths: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };

    const result = await fetchOpenApiDocument(backend, fetchImpl);
    expect(result.resolvedPath).toBe('/docs-yaml');
    expect(result.document.openapi).toBe('3.0.0');
  });

  it('fetchOpenApiDocument aggregates failures when every candidate fails', async () => {
    const fetchImpl: typeof fetch = () => Promise.resolve(new Response('nope', { status: 500 }));

    await expect(fetchOpenApiDocument(backend, fetchImpl)).rejects.toThrow(/Failed to fetch OpenAPI/);
  });

  it('fetchOpenApiDocument records thrown network errors per candidate', async () => {
    const fetchImpl: typeof fetch = () => Promise.reject(new Error('ECONNREFUSED'));

    await expect(fetchOpenApiDocument(backend, fetchImpl)).rejects.toThrow(/ECONNREFUSED/);
  });
});
