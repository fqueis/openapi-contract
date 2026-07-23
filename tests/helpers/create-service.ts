/**
 * Shared test helper: real {@link OpenApiContractService} with an injected HTTP
 * fetch at the network boundary (system boundary only; not internal collaborators).
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadConfig } from '@/config.js';
import { OpenApiContractService } from '@/service.js';

import { sampleOpenApi } from '../fixtures/sample-openapi.js';
import { requestUrl } from './request-url.js';

/**
 * Options for {@link createService}.
 */
export type CreateServiceOptions = {
  /**
   * OpenAPI payload returned by successful fetches. Defaults to {@link sampleOpenApi}.
   */
  document?: unknown;
  /**
   * Spec cache TTL in milliseconds. Defaults to 60_000.
   */
  specCacheTtlMs?: number;
  /**
   * Registry TTL in milliseconds. Defaults to one day.
   */
  registryTtlMs?: number;
  /**
   * Injected clock for cache and registry TTL tests.
   */
  now?: () => number;
  /**
   * Custom fetch implementation.
   *
   * Default behavior: `/docs-json` returns 404, `/docs-yaml` returns the fixture
   * document, and any other path returns 404.
   */
  fetchImpl?: typeof fetch;
};

/**
 * Result of {@link createService}: real service plus test observability handles.
 */
export type CreateServiceResult = {
  /** Application service under test. */
  service: OpenApiContractService;
  /** Absolute URLs requested through the default fetch stub. */
  calls: string[];
  /** Temp directory holding the registry file. */
  dir: string;
  /** Removes the temp registry directory. */
  cleanup: () => Promise<void>;
};

/**
 * Builds a service against a temp registry file and a controllable fetch.
 *
 * @param options - Optional document, TTLs, clock, and fetch override
 * @returns Service, call log, temp dir, and cleanup handle
 */
export async function createService(options: CreateServiceOptions = {}): Promise<CreateServiceResult> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openapi-contract-svc-'));
  const calls: string[] = [];
  const document = options.document ?? sampleOpenApi;

  let fetchImpl = options.fetchImpl;
  if (!fetchImpl) {
    fetchImpl = (input) => {
      const url = requestUrl(input);
      calls.push(url);

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

      return Promise.resolve(new Response('missing', { status: 404 }));
    };
  }

  const service = new OpenApiContractService(
    {
      ...loadConfig(),
      registryPath: path.join(dir, 'backends.json'),
      specCacheTtlMs: options.specCacheTtlMs ?? 60_000,
      registryTtlMs: options.registryTtlMs ?? 86_400_000,
    },
    fetchImpl,
    options.now,
  );

  return {
    service,
    calls,
    dir,
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}
