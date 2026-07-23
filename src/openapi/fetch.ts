/**
 * Fetches and parses OpenAPI documents from a backend origin.
 *
 * Tries the configured path first, then {@link SPEC_PATH_FALLBACKS}. Prefers
 * JSON; YAML is accepted when the response is YAML or the path ends in yaml.
 */

import { parse as parseYaml } from 'yaml';

import { DEFAULT_SPEC_PATH, SPEC_PATH_FALLBACKS } from '@/config.js';
import type { BackendEntry } from '@/registry.js';
import type { OpenApiDocument } from '@openapi/types.js';

/**
 * Successful fetch metadata returned with the document.
 */
export interface FetchOpenApiResult {
  /** Parsed OpenAPI document. */
  document: OpenApiDocument;
  /** Absolute URL that succeeded. */
  resolvedUrl: string;
  /** Relative path used (when applicable). */
  resolvedPath: string;
}

/**
 * Builds candidate absolute URLs for a backend entry.
 *
 * @param backend - Registered backend
 * @returns Ordered unique candidate URLs
 */
export function buildSpecCandidateUrls(backend: BackendEntry): string[] {
  const primary = backend.specPath ?? DEFAULT_SPEC_PATH;
  const paths = [primary, ...SPEC_PATH_FALLBACKS.filter((p) => p !== primary)];
  const origin = backend.baseUrl.replace(/\/+$/, '');
  return [...new Set(paths.map((p) => `${origin}${p.startsWith('/') ? p : `/${p}`}`))];
}

/**
 * Fetches the OpenAPI document for a backend, applying path fallbacks.
 *
 * @param backend - Registered backend
 * @param fetchImpl - Injected fetch for tests; defaults to global `fetch`
 * @returns Parsed document and the URL/path that worked
 * @throws Error when every candidate fails or the body is not a valid OpenAPI doc
 */
export async function fetchOpenApiDocument(
  backend: BackendEntry,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchOpenApiResult> {
  const candidates = buildSpecCandidateUrls(backend);
  const errors: string[] = [];

  for (const url of candidates) {
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json, application/yaml, text/yaml, */*' },
      });
      if (!response.ok) {
        errors.push(`${url} → HTTP ${response.status}`);
        continue;
      }
      const text = await response.text();
      const document = parseOpenApiBody(text, url);
      assertLooksLikeOpenApi(document, url);
      const resolvedPath = new URL(url).pathname;
      return { document, resolvedUrl: url, resolvedPath };
    } catch (error) {
      errors.push(`${url} → ${(error as Error).message}`);
    }
  }

  throw new Error(
    `Failed to fetch OpenAPI for backend "${backend.id}" (${backend.baseUrl}). Tried:\n- ${errors.join('\n- ')}`,
  );
}

/**
 * Parses JSON or YAML OpenAPI body text.
 *
 * @param text - Response body
 * @param url - Source URL (selects YAML when path/content suggests it)
 * @returns Parsed object
 */
export function parseOpenApiBody(text: string, url: string): OpenApiDocument {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Empty response body');
  }

  const prefersYaml = /\.ya?ml(\?|$)/i.test(url) || trimmed.startsWith('openapi:') || trimmed.startsWith('swagger:');

  if (!prefersYaml) {
    try {
      return JSON.parse(trimmed) as OpenApiDocument;
    } catch {
      // Fall through to YAML for mislabeled YAML responses.
    }
  }

  const parsed: unknown = parseYaml(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('OpenAPI body did not parse to an object');
  }
  return parsed as OpenApiDocument;
}

/**
 * Light validation that the document exposes paths or a recognizable OpenAPI version field.
 *
 * @param document - Candidate document
 * @param url - Source URL for error messages
 * @throws Error when neither version nor paths are present
 */
export function assertLooksLikeOpenApi(document: OpenApiDocument, url: string): void {
  const hasVersion = typeof document.openapi === 'string' || typeof document.swagger === 'string';
  const hasPaths = document.paths !== undefined && typeof document.paths === 'object';
  if (!hasVersion && !hasPaths) {
    throw new Error(`Response from ${url} does not look like an OpenAPI document`);
  }
}
