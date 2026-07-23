/**
 * Seam under test: pure OpenAPI transforms (index/search, $ref deref, examples, cache).
 *
 * Covers:
 * 1. Indexing HTTP operations from `paths` (skips non-HTTP keys)
 * 2. Lookup by operationId or method+path; empty lookup misses
 * 3. Free-text search and tag/method/path filters
 * 4. Local `#/components/schemas` dereference, external/missing/circular refs
 * 5. Schema-driven request examples (formats, enum, composition, arrays)
 * 6. SpecCache TTL expiry and clear
 *
 * Out of scope: network fetch, registry persistence, MCP tool wrappers.
 */

import { describe, expect, it } from 'vitest';

import { loadConfig } from '@/config.js';
import { SpecCache } from '@openapi/cache.js';
import { dereferenceSchema, resolveLocalRef } from '@openapi/deref.js';
import { buildRequestExample, exampleFromSchema } from '@openapi/example.js';
import {
  filterOperations,
  findOperation,
  indexOperations,
  searchOperations,
  summarizeOperation,
} from '@openapi/index-ops.js';
import type { OpenApiDocument, Operation } from '@openapi/types.js';

import { sampleOpenApi } from './fixtures/sample-openapi.js';

const document = sampleOpenApi as unknown as OpenApiDocument;

describe('OpenAPI transforms', () => {
  it('indexes every HTTP operation from paths and skips non-method keys', () => {
    const operations = indexOperations('demo', document);

    expect(operations.map((op) => `${op.method} ${op.path}`)).toEqual(['POST /v1/auth/login', 'GET /v1/users/{id}']);
  });

  it('indexes an empty list when paths are missing or non-objects', () => {
    expect(indexOperations('demo', {})).toEqual([]);
    expect(
      indexOperations('demo', {
        paths: {
          '/x': null,
          '/y': { get: null, parameters: [] },
        },
      } as unknown as OpenApiDocument),
    ).toEqual([]);
  });

  it('finds an operation by operationId or method+path', () => {
    const operations = indexOperations('demo', document);

    expect(findOperation(operations, { operationId: 'getUser' })?.path).toBe('/v1/users/{id}');
    expect(findOperation(operations, { method: 'POST', path: '/v1/auth/login' })?.operationId).toBe('login');
    expect(findOperation(operations, {})).toBeUndefined();
    expect(findOperation(operations, { operationId: 'missing', method: 'GET', path: '/nope' })).toBeUndefined();
  });

  it('searches operations by free text and returns all when query is blank', () => {
    const operations = indexOperations('demo', document);

    expect(searchOperations(operations, 'login').map((op) => op.operationId)).toEqual(['login']);
    expect(searchOperations(operations, '   ')).toHaveLength(2);
  });

  it('filters operations by tag, method, and path substring', () => {
    const operations = indexOperations('demo', document);

    expect(filterOperations(operations, { tag: 'AUTH' }).map((o) => o.operationId)).toEqual(['login']);
    expect(filterOperations(operations, { method: 'get' }).map((o) => o.operationId)).toEqual(['getUser']);
    expect(filterOperations(operations, { path: '/v1/users' }).map((o) => o.operationId)).toEqual(['getUser']);
  });

  it('summarizes an indexed operation without the raw operation object', () => {
    const [login] = indexOperations('demo', document);
    expect(summarizeOperation(login)).toEqual({
      backendId: 'demo',
      method: 'POST',
      path: '/v1/auth/login',
      operationId: 'login',
      summary: 'Login',
      description: 'Exchange credentials for tokens',
      tags: ['auth'],
    });
  });

  it('dereferences a local components schema $ref', () => {
    const schema = dereferenceSchema({ $ref: '#/components/schemas/LoginRequest' }, document);

    expect(schema).toMatchObject({
      type: 'object',
      required: ['email', 'password'],
      properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string' },
      },
    });
  });

  it('returns undefined when dereferencing an absent schema', () => {
    expect(dereferenceSchema(undefined, document)).toBeUndefined();
  });

  it('annotates an external $ref as unresolved', () => {
    expect(dereferenceSchema({ $ref: 'https://example.com/schemas.json#/Foo' }, document)).toMatchObject({
      'x-unresolved-ref': 'https://example.com/schemas.json#/Foo',
    });
  });

  it('annotates a missing local $ref', () => {
    expect(dereferenceSchema({ $ref: '#/components/schemas/Missing' }, document)).toMatchObject({
      'x-missing-ref': true,
    });
  });

  it('annotates a circular local $ref', () => {
    const cyclicDoc = {
      components: {
        schemas: {
          A: { $ref: '#/components/schemas/B' },
          B: { $ref: '#/components/schemas/A' },
        },
      },
    } as OpenApiDocument;

    expect(dereferenceSchema({ $ref: '#/components/schemas/A' }, cyclicDoc)).toMatchObject({
      'x-circular-ref': true,
    });
  });

  it('merges sibling keywords over a resolved local $ref', () => {
    expect(
      dereferenceSchema({ $ref: '#/components/schemas/User', description: 'sibling wins lightly' }, document),
    ).toMatchObject({
      type: 'object',
      description: 'sibling wins lightly',
    });
  });

  it('resolveLocalRef walks JSON pointers and rejects non-local refs', () => {
    expect(resolveLocalRef(document, 'components/schemas/User')).toBeUndefined();
    expect(resolveLocalRef(document, '#/components/schemas/User')).toMatchObject({ type: 'object' });
    expect(resolveLocalRef(document, '#/components/schemas/User/properties/missing/x')).toBeUndefined();
  });

  it('builds string format examples from schemas', () => {
    expect(exampleFromSchema({ type: 'string', format: 'email' })).toBe('user@example.com');
    expect(exampleFromSchema({ type: 'string', format: 'date' })).toBe('2026-01-15');
    expect(exampleFromSchema({ type: 'string', format: 'date-time' })).toBe('2026-01-15T12:00:00.000Z');
    expect(exampleFromSchema({ type: 'string', format: 'uuid' })).toBe('00000000-0000-4000-8000-000000000000');
  });

  it('builds scalar, enum, and composed schema examples', () => {
    expect(exampleFromSchema({ type: 'boolean' })).toBe(true);
    expect(exampleFromSchema({ type: 'integer' })).toBe(0);
    expect(exampleFromSchema({ enum: ['a', 'b'] })).toBe('a');
    expect(exampleFromSchema({ example: 'explicit' })).toBe('explicit');
    expect(exampleFromSchema({ examples: ['first', 'second'] })).toBe('first');
    expect(exampleFromSchema({ allOf: [{ type: 'string', format: 'email' }] })).toBe('user@example.com');
  });

  it('builds array and object schema examples', () => {
    expect(exampleFromSchema({ type: 'array', items: { type: 'boolean' } })).toEqual([true]);
    expect(exampleFromSchema({ type: 'object' })).toEqual({});
    expect(
      exampleFromSchema({
        type: 'object',
        properties: { n: { type: 'integer' } },
      }),
    ).toEqual({ n: 0 });
    expect(exampleFromSchema(undefined)).toBeNull();
  });

  it('prefers explicit JSON body and parameter examples for a request', () => {
    const operation: Operation = {
      parameters: [{ name: 'skip', in: 'query', example: 2 }],
      requestBody: {
        content: {
          'application/json': {
            example: { ready: true },
          },
        },
      },
    };

    expect(
      buildRequestExample(operation, [
        { name: 'skip', in: 'query', example: 2 },
        { name: 'q', in: 'query', examples: { a: { value: 'from-examples' } } },
        { name: '', in: 'query', schema: { type: 'string' } },
      ]),
    ).toEqual({
      parameters: { skip: 2, q: 'from-examples' },
      body: { ready: true },
      contentType: 'application/json',
    });
  });

  it('prefers named media examples when application/json is absent', () => {
    expect(
      buildRequestExample(
        {
          requestBody: {
            content: {
              'text/plain': {
                examples: { a: { value: 'plain' } },
              },
            },
          },
        },
        [],
      ),
    ).toEqual({
      parameters: {},
      body: 'plain',
      contentType: 'text/plain',
    });
  });

  it('returns only parameters when the operation has no requestBody', () => {
    expect(buildRequestExample({}, [])).toEqual({ parameters: {} });
  });

  it('expires SpecCache entries after TTL and clears all entries', () => {
    let now = 0;
    const cache = new SpecCache(
      { ...loadConfig(), specCacheTtlMs: 100, registryTtlMs: 1_000, registryPath: '/tmp/x' },
      () => now,
    );

    cache.set('demo', {
      document,
      resolvedUrl: 'http://localhost:3000/docs-yaml',
      resolvedPath: '/docs-yaml',
    });
    expect(cache.get('demo')?.resolvedPath).toBe('/docs-yaml');

    now = 101;
    expect(cache.get('demo')).toBeUndefined();
    expect(cache.get('missing')).toBeUndefined();

    cache.set('demo', {
      document,
      resolvedUrl: 'http://localhost:3000/docs-yaml',
      resolvedPath: '/docs-yaml',
      fetchedAt: now,
    });
    cache.clear();
    expect(cache.get('demo')).toBeUndefined();
  });
});
