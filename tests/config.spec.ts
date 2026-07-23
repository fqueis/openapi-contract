/**
 * Seam under test: loadConfig (env-backed runtime settings).
 *
 * Covers:
 * 1. Defaults when env vars are unset
 * 2. Positive integer overrides for cache/registry TTLs
 * 3. Fallback when env values are empty or non-positive
 * 4. Custom registry path override
 */

import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_REGISTRY_TTL_MS, DEFAULT_SPEC_CACHE_TTL_MS, loadConfig } from '@/config.js';

describe('loadConfig', () => {
  const keys = ['OPENAPI_MCP_CACHE_TTL_MS', 'OPENAPI_MCP_REGISTRY_TTL_MS', 'OPENAPI_MCP_REGISTRY_PATH'] as const;
  const previous = new Map<string, string | undefined>();

  afterEach(() => {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    previous.clear();
  });

  it('returns defaults when env overrides are unset', () => {
    clearEnv();

    const config = loadConfig();

    expect(config.specCacheTtlMs).toBe(DEFAULT_SPEC_CACHE_TTL_MS);
    expect(config.registryTtlMs).toBe(DEFAULT_REGISTRY_TTL_MS);
    expect(config.registryPath).toBe(path.join(os.homedir(), '.openapi-contract-mcp', 'backends.json'));
  });

  it('applies positive integer and path overrides from env', () => {
    setEnv({
      OPENAPI_MCP_CACHE_TTL_MS: '120000',
      OPENAPI_MCP_REGISTRY_TTL_MS: '3600000',
      OPENAPI_MCP_REGISTRY_PATH: 'C:\\tmp\\backends.json',
    });

    expect(loadConfig()).toEqual({
      specCacheTtlMs: 120_000,
      registryTtlMs: 3_600_000,
      registryPath: 'C:\\tmp\\backends.json',
    });
  });

  it('falls back when TTL env values are empty or non-positive', () => {
    setEnv({
      OPENAPI_MCP_CACHE_TTL_MS: '  ',
      OPENAPI_MCP_REGISTRY_TTL_MS: '0',
    });

    const config = loadConfig();
    expect(config.specCacheTtlMs).toBe(DEFAULT_SPEC_CACHE_TTL_MS);
    expect(config.registryTtlMs).toBe(DEFAULT_REGISTRY_TTL_MS);

    setEnv({ OPENAPI_MCP_REGISTRY_TTL_MS: '-5' });
    expect(loadConfig().registryTtlMs).toBe(DEFAULT_REGISTRY_TTL_MS);

    setEnv({ OPENAPI_MCP_REGISTRY_TTL_MS: 'nope' });
    expect(loadConfig().registryTtlMs).toBe(DEFAULT_REGISTRY_TTL_MS);
  });

  /**
   * Clears known OpenAPI MCP env keys after snapshotting their prior values.
   */
  function clearEnv() {
    for (const key of keys) {
      if (!previous.has(key)) {
        previous.set(key, process.env[key]);
      }
      delete process.env[key];
    }
  }

  /**
   * Replaces known OpenAPI MCP env keys for one scenario (after clearing).
   *
   * @param values - Env overrides for this assertion
   */
  function setEnv(values: Partial<Record<(typeof keys)[number], string>>) {
    clearEnv();
    for (const [key, value] of Object.entries(values)) {
      process.env[key] = value;
    }
  }
});
