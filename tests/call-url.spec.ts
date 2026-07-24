/**
 * Seam under test: buildCallUrl (pure URL assembly for call_endpoint).
 *
 * Covers:
 * 1. baseUrl + path when servers are empty (timesheet-like)
 * 2. baseUrl + relative servers[0] + path
 * 3. Absolute servers on a foreign origin are ignored
 * 4. Absolute servers on the same origin contribute their path prefix
 * 5. Path param substitution and missing required param errors
 * 6. Query string encoding
 *
 * Out of scope: HTTP fetch; auth headers; MCP tool wiring.
 */

import { describe, expect, it } from 'vitest';

import { buildCallUrl } from '@openapi/call-url.js';

describe('buildCallUrl', () => {
  it('joins baseUrl and path when servers are empty', () => {
    expect(
      buildCallUrl({
        baseUrl: 'http://localhost:3000',
        servers: [],
        pathTemplate: '/v1/auth/login',
      }),
    ).toBe('http://localhost:3000/v1/auth/login');
  });

  it('prepends a relative server path prefix', () => {
    expect(
      buildCallUrl({
        baseUrl: 'http://localhost:3000',
        servers: [{ url: '/api/v1' }],
        pathTemplate: '/users/{id}',
        pathParams: { id: '42' },
      }),
    ).toBe('http://localhost:3000/api/v1/users/42');
  });

  it('ignores absolute servers on a different origin', () => {
    expect(
      buildCallUrl({
        baseUrl: 'http://localhost:3000',
        servers: [{ url: 'https://api.other.example/v1' }],
        pathTemplate: '/v1/users',
      }),
    ).toBe('http://localhost:3000/v1/users');
  });

  it('uses path prefix from absolute servers on the same origin', () => {
    expect(
      buildCallUrl({
        baseUrl: 'http://localhost:3000',
        servers: [{ url: 'http://localhost:3000/api' }],
        pathTemplate: '/users',
      }),
    ).toBe('http://localhost:3000/api/users');
  });

  it('encodes query parameters', () => {
    expect(
      buildCallUrl({
        baseUrl: 'http://localhost:3000',
        servers: [],
        pathTemplate: '/v1/entries/history',
        query: { from: '2026-01-01', q: 'a b' },
      }),
    ).toBe('http://localhost:3000/v1/entries/history?from=2026-01-01&q=a+b');
  });

  it('throws when a path template parameter is missing', () => {
    expect(() =>
      buildCallUrl({
        baseUrl: 'http://localhost:3000',
        servers: [],
        pathTemplate: '/v1/users/{id}',
        pathParams: {},
      }),
    ).toThrow(/path parameter "id"/i);
  });
});
