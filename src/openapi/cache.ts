/**
 * In-memory OpenAPI document cache keyed by backend id.
 *
 * TTL is configured via {@link AppConfig.specCacheTtlMs}. Does not persist to disk.
 */

import type { AppConfig } from '@/config.js';
import type { OpenApiDocument } from '@openapi/types.js';

/**
 * Cached document entry with resolution metadata.
 */
export interface CachedSpec {
  /** Parsed OpenAPI document. */
  document: OpenApiDocument;
  /** Absolute URL that successfully returned the document. */
  resolvedUrl: string;
  /** Relative path segment of that URL (e.g. `/docs-json`). */
  resolvedPath: string;
  /** Epoch ms when the entry was stored (drives TTL). */
  fetchedAt: number;
}

/**
 * TTL cache for OpenAPI documents.
 */
export class SpecCache {
  private readonly entries = new Map<string, CachedSpec>();

  /**
   * @param config - Provides `specCacheTtlMs`
   * @param now - Clock injection for tests
   */
  constructor(
    private readonly config: AppConfig,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Returns a fresh cached spec, or `undefined` when missing/expired.
   *
   * @param backendId - Registry backend id
   * @returns Cached entry or undefined
   */
  get(backendId: string): CachedSpec | undefined {
    const entry = this.entries.get(backendId);
    if (!entry) {
      return undefined;
    }
    if (this.now() - entry.fetchedAt > this.config.specCacheTtlMs) {
      this.entries.delete(backendId);
      return undefined;
    }
    return entry;
  }

  /**
   * Stores a freshly fetched document.
   *
   * @param backendId - Registry backend id
   * @param value - Document and resolution metadata
   */
  set(backendId: string, value: Omit<CachedSpec, 'fetchedAt'> & { fetchedAt?: number }): void {
    this.entries.set(backendId, {
      document: value.document,
      resolvedUrl: value.resolvedUrl,
      resolvedPath: value.resolvedPath,
      fetchedAt: value.fetchedAt ?? this.now(),
    });
  }

  /**
   * Invalidates one backend's cached document.
   *
   * @param backendId - Registry backend id
   */
  invalidate(backendId: string): void {
    this.entries.delete(backendId);
  }

  /**
   * Clears the entire in-memory cache.
   */
  clear(): void {
    this.entries.clear();
  }
}
