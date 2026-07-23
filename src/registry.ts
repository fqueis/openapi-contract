/**
 * Disk-backed registry of backends used by the MCP.
 *
 * Persists `{ id, baseUrl, specPath, lastUsedAt }` under the configured path,
 * expires entries after {@link AppConfig.registryTtlMs}, and does not store
 * OpenAPI documents (those live in the in-memory spec cache).
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type { AppConfig } from '@/config.js';
import { DEFAULT_SPEC_PATH } from '@/config.js';

/**
 * One registered backend in the on-disk registry.
 */
export interface BackendEntry {
  /** Stable id used by contract tools. */
  id: string;
  /** Origin or absolute OpenAPI URL (without forcing a trailing slash). */
  baseUrl: string;
  /**
   * Relative spec path when `baseUrl` is an origin (e.g. `/docs-json`).
   * Omitted when `baseUrl` already points at the document.
   */
  specPath?: string;
  /** Epoch ms of last successful `use_backend` (drives TTL). */
  lastUsedAt: number;
}

/**
 * On-disk JSON shape for the registry file.
 */
interface RegistryFile {
  version: 1;
  backends: BackendEntry[];
}

/**
 * Manages durable backend registrations with TTL-based expiry.
 */
export class BackendRegistry {
  private backends = new Map<string, BackendEntry>();
  private loaded = false;

  /**
   * @param config - App config providing registry path and TTL
   * @param now - Clock injection for tests; defaults to `Date.now`
   */
  constructor(
    private readonly config: AppConfig,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Ensures the registry file has been read into memory (idempotent).
   *
   * @returns Resolves when loaded
   */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    await this.reloadFromDisk();
    this.loaded = true;
  }

  /**
   * Reloads registry state from disk and drops expired entries.
   *
   * @returns Resolves when memory matches a pruned disk snapshot
   */
  async reloadFromDisk(): Promise<void> {
    try {
      const raw = await fs.readFile(this.config.registryPath, 'utf8');
      const parsed = JSON.parse(raw) as RegistryFile;
      this.backends.clear();
      for (const entry of parsed.backends ?? []) {
        if (this.isFresh(entry)) {
          this.backends.set(entry.id, entry);
        }
      }
      // Persist prune so expired ids do not linger forever on disk.
      await this.persist();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw error;
      }
      this.backends.clear();
    }
  }

  /**
   * Lists backends that have not expired.
   *
   * @returns Fresh backend entries
   */
  async list(): Promise<BackendEntry[]> {
    await this.ensureLoaded();
    this.dropExpiredInMemory();
    return [...this.backends.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Returns a fresh backend by id, or `undefined` if missing/expired.
   *
   * @param id - Backend id
   * @returns Entry or undefined
   */
  async get(id: string): Promise<BackendEntry | undefined> {
    await this.ensureLoaded();
    const entry = this.backends.get(id);
    if (!entry) {
      return undefined;
    }
    if (!this.isFresh(entry)) {
      this.backends.delete(id);
      await this.persist();
      return undefined;
    }
    return entry;
  }

  /**
   * Upserts a backend and renews `lastUsedAt` (starts/extends the 1-day TTL).
   *
   * @param input - Registration fields
   * @returns Persisted entry
   */
  async use(input: { id?: string; baseUrl: string; specPath?: string }): Promise<BackendEntry> {
    await this.ensureLoaded();
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const id = input.id?.trim() || deriveBackendId(baseUrl);
    const specPath = resolveSpecPath(baseUrl, input.specPath);
    const entry: BackendEntry = {
      id,
      baseUrl: stripKnownSpecSuffix(baseUrl, specPath) || baseUrl,
      ...(specPath ? { specPath } : {}),
      lastUsedAt: this.now(),
    };

    // If the caller passed a full document URL, keep baseUrl as origin and set specPath.
    const absoluteSpec = detectAbsoluteSpecUrl(baseUrl);
    if (absoluteSpec) {
      entry.baseUrl = absoluteSpec.origin;
      entry.specPath = absoluteSpec.specPath;
    } else if (!entry.specPath) {
      entry.specPath = DEFAULT_SPEC_PATH;
    }

    this.backends.set(entry.id, entry);
    await this.persist();
    return entry;
  }

  /**
   * Removes one backend from the registry.
   *
   * @param id - Backend id
   * @returns `true` when an entry was removed
   */
  async forget(id: string): Promise<boolean> {
    await this.ensureLoaded();
    const existed = this.backends.delete(id);
    if (existed) {
      await this.persist();
    }
    return existed;
  }

  /**
   * Clears every backend from memory and disk.
   *
   * @returns Number of entries removed
   */
  async clear(): Promise<number> {
    await this.ensureLoaded();
    const count = this.backends.size;
    this.backends.clear();
    await this.persist();
    return count;
  }

  /**
   * Writes the current in-memory map to disk (creates parent dirs).
   *
   * @returns Resolves when the file is written
   */
  private async persist(): Promise<void> {
    const dir = path.dirname(this.config.registryPath);
    await fs.mkdir(dir, { recursive: true });
    const payload: RegistryFile = {
      version: 1,
      backends: [...this.backends.values()],
    };
    await fs.writeFile(this.config.registryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  /**
   * Drops expired entries from the in-memory map without writing until needed.
   */
  private dropExpiredInMemory(): void {
    for (const [id, entry] of this.backends) {
      if (!this.isFresh(entry)) {
        this.backends.delete(id);
      }
    }
  }

  /**
   * @param entry - Registry entry
   * @returns Whether `lastUsedAt` is within the configured TTL
   */
  private isFresh(entry: BackendEntry): boolean {
    return this.now() - entry.lastUsedAt <= this.config.registryTtlMs;
  }
}

/**
 * Trims trailing slashes from a base URL (keeps scheme/host/path otherwise).
 *
 * @param baseUrl - Raw URL from the caller
 * @returns Normalized URL string
 */
export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`Invalid baseUrl "${baseUrl}". Provide an absolute URL such as http://localhost:3000`);
  }
  return trimmed;
}

/**
 * Derives a short backend id from host + optional port/path.
 *
 * @param baseUrl - Normalized base URL
 * @returns Id like `localhost-3000` or `api-example-com`
 */
export function deriveBackendId(baseUrl: string): string {
  const url = new URL(baseUrl);
  const host = url.hostname.replace(/\./g, '-');
  const port = url.port ? `-${url.port}` : '';
  const pathPart = url.pathname.replace(/\/+/g, '-').replace(/^-|-$/g, '');
  const suffix = pathPart && pathPart !== '' ? `-${pathPart}` : '';
  return `${host}${port}${suffix}`.toLowerCase() || 'backend';
}

/**
 * Resolves the relative spec path when the caller did not pass a full document URL.
 *
 * @param baseUrl - Normalized base URL
 * @param specPath - Optional override
 * @returns Relative path or undefined when baseUrl is already a document URL
 */
function resolveSpecPath(baseUrl: string, specPath?: string): string | undefined {
  if (detectAbsoluteSpecUrl(baseUrl)) {
    return undefined;
  }
  if (specPath?.trim()) {
    return specPath.startsWith('/') ? specPath : `/${specPath}`;
  }
  return DEFAULT_SPEC_PATH;
}

/**
 * Detects when `baseUrl` already includes a known OpenAPI document path.
 *
 * @param baseUrl - Normalized URL
 * @returns Origin + relative spec path, or null
 */
export function detectAbsoluteSpecUrl(baseUrl: string): { origin: string; specPath: string } | null {
  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const known = ['/docs-json', '/docs-yaml', '/openapi.json', '/v3/api-docs'];
  for (const candidate of known) {
    if (pathname === candidate || pathname.endsWith(candidate)) {
      const origin = `${url.protocol}//${url.host}`;
      return { origin, specPath: candidate };
    }
  }
  return null;
}

/**
 * Strips a known spec suffix from baseUrl when both were provided redundantly.
 *
 * @param baseUrl - Normalized URL
 * @param specPath - Relative path if any
 * @returns Origin-style URL when a suffix was stripped; otherwise the input
 */
function stripKnownSpecSuffix(baseUrl: string, specPath?: string): string {
  const detected = detectAbsoluteSpecUrl(baseUrl);
  if (detected) {
    return detected.origin;
  }
  if (specPath && baseUrl.endsWith(specPath)) {
    return baseUrl.slice(0, -specPath.length).replace(/\/+$/, '');
  }
  return baseUrl;
}
