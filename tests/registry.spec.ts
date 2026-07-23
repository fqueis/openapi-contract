/**
 * Seam under test: BackendRegistry (durable on-demand backend registration).
 *
 * Covers:
 * 1. use/list makes a backend retrievable with default `/docs-json`
 * 2. Re-use renews `lastUsedAt`
 * 3. Registry TTL expiry removes entries from list/get
 * 4. forget removes one; clear removes all
 * 5. Absolute `/docs-json` URL normalizes to origin + specPath
 * 6. Custom relative specPath, derived ids, invalid URLs, corrupt disk files
 *
 * Out of scope: OpenAPI fetch/parse, SpecCache, OpenApiContractService orchestration,
 * MCP tool registration wrappers.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '@/config.js';
import { BackendRegistry, deriveBackendId, detectAbsoluteSpecUrl, normalizeBaseUrl } from '@/registry.js';

describe('BackendRegistry', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('makes a used backend retrievable by id with default /docs-json spec path', async () => {
    const { registry } = await createRegistry();

    await registry.use({ baseUrl: 'http://localhost:3000', id: 'timesheet' });

    const listed = await registry.list();
    expect(listed).toEqual([
      expect.objectContaining({
        id: 'timesheet',
        baseUrl: 'http://localhost:3000',
        specPath: '/docs-json',
      }),
    ]);
  });

  it('renews lastUsedAt when the same backend is used again', async () => {
    const { registry, clock } = await createRegistry();
    await registry.use({ baseUrl: 'http://localhost:3000', id: 'timesheet' });

    clock.now = 5_000;
    await registry.use({ baseUrl: 'http://localhost:3000', id: 'timesheet' });

    const [entry] = await registry.list();
    expect(entry?.lastUsedAt).toBe(5_000);
  });

  it('stops listing a backend after its registry TTL expires', async () => {
    const { registry, clock, config } = await createRegistry();
    await registry.use({ baseUrl: 'http://localhost:3000', id: 'timesheet' });

    clock.now = config.registryTtlMs + 1;

    expect(await registry.list()).toEqual([]);
    expect(await registry.get('timesheet')).toBeUndefined();
  });

  it('forget removes one backend; clear removes all', async () => {
    const { registry } = await createRegistry();
    await registry.use({ baseUrl: 'http://localhost:3000', id: 'a' });
    await registry.use({ baseUrl: 'http://localhost:4000', id: 'b' });

    expect(await registry.forget('a')).toBe(true);
    expect(await registry.forget('missing')).toBe(false);
    expect((await registry.list()).map((e) => e.id)).toEqual(['b']);

    expect(await registry.clear()).toBe(1);
    expect(await registry.list()).toEqual([]);
  });

  it('normalizes an absolute /docs-json URL into origin + specPath', async () => {
    const { registry } = await createRegistry();

    const entry = await registry.use({
      baseUrl: 'http://localhost:3000/docs-json',
      id: 'ts',
    });

    expect(entry).toMatchObject({
      baseUrl: 'http://localhost:3000',
      specPath: '/docs-json',
    });
  });

  it('accepts a custom relative specPath and derives an id from host/port', async () => {
    const { registry } = await createRegistry();

    const entry = await registry.use({
      baseUrl: 'http://localhost:3000',
      specPath: 'openapi.json',
    });

    expect(entry).toMatchObject({
      id: 'localhost-3000',
      specPath: '/openapi.json',
    });
  });

  it('rejects a non-absolute baseUrl', async () => {
    const { registry } = await createRegistry();
    await expect(registry.use({ baseUrl: 'localhost:3000' })).rejects.toThrow(/Invalid baseUrl/);
  });

  it('reloads a fresh registry file and ignores expired disk entries', async () => {
    const { registry, config, clock } = await createRegistry();
    await registry.use({ baseUrl: 'http://localhost:3000', id: 'fresh' });

    await fs.writeFile(
      config.registryPath,
      JSON.stringify({
        version: 1,
        backends: [
          { id: 'fresh', baseUrl: 'http://localhost:3000', specPath: '/docs-json', lastUsedAt: 0 },
          { id: 'stale', baseUrl: 'http://localhost:4000', specPath: '/docs-json', lastUsedAt: -10_000 },
        ],
      }),
    );

    clock.now = config.registryTtlMs + 1;
    // Force reload via a new registry instance on the same path.
    const reloaded = new BackendRegistry(config, () => clock.now);
    expect(await reloaded.list()).toEqual([]);
  });

  it('throws when the registry file exists but is not valid JSON', async () => {
    const { registry, config } = await createRegistry();
    await fs.mkdir(path.dirname(config.registryPath), { recursive: true });
    await fs.writeFile(config.registryPath, '{not-json');

    await expect(registry.list()).rejects.toThrow();
  });

  it('strips a trailing slash from an absolute baseUrl', () => {
    expect(normalizeBaseUrl('http://localhost:3000/')).toBe('http://localhost:3000');
  });

  it('derives a backend id from host, port, and path', () => {
    expect(deriveBackendId('https://api.example.com/v1')).toBe('api-example-com-v1');
  });

  it('detects a known absolute OpenAPI path on the baseUrl', () => {
    expect(detectAbsoluteSpecUrl('http://localhost:3000/v3/api-docs')).toEqual({
      origin: 'http://localhost:3000',
      specPath: '/v3/api-docs',
    });
  });

  it('returns null when the baseUrl path is not a known OpenAPI document path', () => {
    expect(detectAbsoluteSpecUrl('http://localhost:3000/api')).toBeNull();
  });

  /**
   * Builds a registry against a temp file with an injectable clock.
   *
   * @returns Registry, mutable clock, and resolved config
   */
  async function createRegistry() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openapi-contract-'));
    tempDirs.push(dir);
    const clock = { now: 0 };
    const config = {
      ...loadConfig(),
      registryPath: path.join(dir, 'backends.json'),
      registryTtlMs: 1_000,
      specCacheTtlMs: 60_000,
    };
    return {
      registry: new BackendRegistry(config, () => clock.now),
      clock,
      config,
    };
  }
});
