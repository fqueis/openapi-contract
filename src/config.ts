/**
 * Environment-backed runtime settings for the OpenAPI Contract MCP.
 *
 * Owns TTL units (milliseconds) and the on-disk registry path. Does not load
 * backend lists from env: backends are registered on demand via tools.
 */

import os from 'node:os';
import path from 'node:path';

/** Default OpenAPI document cache TTL: 60 seconds. */
export const DEFAULT_SPEC_CACHE_TTL_MS = 60_000;

/** Default backend registry TTL: 1 day. */
export const DEFAULT_REGISTRY_TTL_MS = 86_400_000;

/** Default relative OpenAPI JSON path for Nest Swagger and similar stacks. */
export const DEFAULT_SPEC_PATH = '/docs-json';

/**
 * Ordered fallback paths tried when the configured or default spec URL fails.
 * JSON paths are preferred; YAML is last among Nest defaults before other stacks.
 */
export const SPEC_PATH_FALLBACKS = ['/docs-json', '/docs-yaml', '/openapi.json', '/v3/api-docs'] as const;

/**
 * Resolved MCP configuration from process environment.
 */
export interface AppConfig {
  /**
   * In-memory OpenAPI document cache TTL in milliseconds.
   */
  specCacheTtlMs: number;
  /**
   * On-disk backend registry TTL in milliseconds (from last successful use).
   */
  registryTtlMs: number;
  /**
   * Absolute path to the backends JSON registry file.
   */
  registryPath: string;
}

/**
 * Reads optional env overrides and returns a complete {@link AppConfig}.
 *
 * @returns Resolved TTLs and registry file path
 *
 * @example
 * ```typescript
 * const config = loadConfig();
 * // config.registryPath → %USERPROFILE%\.openapi-contract-mcp\backends.json
 * ```
 */
export function loadConfig(): AppConfig {
  return {
    specCacheTtlMs: parsePositiveInt(process.env.OPENAPI_MCP_CACHE_TTL_MS, DEFAULT_SPEC_CACHE_TTL_MS),
    registryTtlMs: parsePositiveInt(process.env.OPENAPI_MCP_REGISTRY_TTL_MS, DEFAULT_REGISTRY_TTL_MS),
    registryPath:
      process.env.OPENAPI_MCP_REGISTRY_PATH?.trim() ||
      path.join(os.homedir(), '.openapi-contract-mcp', 'backends.json'),
  };
}

/**
 * Parses a positive integer from an env string, falling back when missing or invalid.
 *
 * @param raw - Raw env value
 * @param fallback - Value used when raw is empty or not a positive integer
 * @returns Parsed positive integer or fallback
 */
function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}
