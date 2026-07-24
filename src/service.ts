/**
 * Application service that orchestrates registry, OpenAPI fetch/cache, contract
 * queries, and optional call_endpoint HTTP execution for MCP tools.
 *
 * Does not own transport or tool registration; tools call into this seam.
 * Does not persist secrets or validate request bodies against OpenAPI schemas.
 */

import type { AppConfig } from '@/config.js';
import { SpecCache } from '@openapi/cache.js';
import { materializeCallResult, mergeCallHeaders, serializeCallBody, type CallEndpointResult } from '@openapi/call.js';
import { buildCallUrl } from '@openapi/call-url.js';
import { dereferenceSchema } from '@openapi/deref.js';
import { buildRequestExample } from '@openapi/example.js';
import { fetchOpenApiDocument } from '@openapi/fetch.js';
import {
  filterOperations,
  findOperation,
  indexOperations,
  searchOperations,
  summarizeOperation,
} from '@openapi/index-ops.js';
import type { JsonSchema, OpenApiDocument, ParameterObject, SecurityRequirement } from '@openapi/types.js';
import { BackendRegistry, type BackendEntry } from '@/registry.js';

/**
 * Shared error message when a backend id is missing from the registry.
 *
 * @param backendId - Requested id
 * @returns Human-readable guidance for agents
 */
export function missingBackendMessage(backendId: string): string {
  return (
    `Backend "${backendId}" is not registered or its registry TTL expired. ` +
    `Call use_backend with baseUrl (e.g. http://localhost:3000) first, then retry.`
  );
}

/**
 * Input for {@link OpenApiContractService.callEndpoint}.
 */
export type CallEndpointInput = {
  /** Registered backend id. */
  backendId: string;
  /** HTTP method when selecting by method+path. */
  method?: string;
  /** OpenAPI path template when selecting by method+path. */
  path?: string;
  /** OpenAPI operationId when selecting by id. */
  operationId?: string;
  /** Values for `{name}` path template segments. */
  pathParams?: Record<string, string>;
  /** Query string parameters. */
  query?: Record<string, string>;
  /** JSON object or raw string body. */
  body?: unknown;
  /** Literal request headers. */
  headers?: Record<string, string>;
  /** Header name → process.env key (wins over `headers` on conflict). */
  headerEnv?: Record<string, string>;
};

/**
 * Orchestrates backend registry, OpenAPI contract reads, and optional HTTP calls.
 */
export class OpenApiContractService {
  readonly registry: BackendRegistry;
  readonly specCache: SpecCache;

  /**
   * @param config - Runtime config
   * @param fetchImpl - Optional fetch injection for tests
   * @param now - Optional clock injection for tests
   */
  constructor(
    readonly config: AppConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    now: () => number = () => Date.now(),
  ) {
    this.registry = new BackendRegistry(config, now);
    this.specCache = new SpecCache(config, now);
  }

  /**
   * Registers or renews a backend and eagerly fetches its OpenAPI document.
   *
   * @param input - baseUrl plus optional id/specPath
   * @returns Registry entry and fetch metadata
   */
  async useBackend(input: { baseUrl: string; id?: string; specPath?: string }): Promise<{
    backend: BackendEntry;
    resolvedUrl: string;
    resolvedPath: string;
  }> {
    const backend = await this.registry.use(input);
    this.specCache.invalidate(backend.id);
    const fetched = await this.getDocument(backend.id, true);
    return {
      backend,
      resolvedUrl: fetched.resolvedUrl,
      resolvedPath: fetched.resolvedPath,
    };
  }

  /**
   * Lists fresh registry backends.
   *
   * @returns Backend entries
   */
  listBackends(): Promise<BackendEntry[]> {
    return this.registry.list();
  }

  /**
   * Removes one backend and its cached document.
   *
   * @param backendId - Backend id
   * @returns Whether an entry existed
   */
  async forgetBackend(backendId: string): Promise<boolean> {
    this.specCache.invalidate(backendId);
    return this.registry.forget(backendId);
  }

  /**
   * Clears the disk registry and in-memory spec cache.
   *
   * @returns Number of backends removed
   */
  async clearBackends(): Promise<number> {
    this.specCache.clear();
    return this.registry.clear();
  }

  /**
   * Forces a fresh OpenAPI fetch for a registered backend.
   *
   * @param backendId - Backend id
   * @returns Fetch metadata
   */
  async refreshBackend(backendId: string): Promise<{ resolvedUrl: string; resolvedPath: string }> {
    await this.requireBackend(backendId);
    this.specCache.invalidate(backendId);
    const fetched = await this.getDocument(backendId, true);
    return {
      resolvedUrl: fetched.resolvedUrl,
      resolvedPath: fetched.resolvedPath,
    };
  }

  /**
   * Returns API overview for a backend.
   *
   * @param backendId - Backend id
   * @returns Overview payload
   */
  async getApiOverview(backendId: string) {
    const { document, resolvedUrl, resolvedPath } = await this.getDocument(backendId);
    const operations = indexOperations(backendId, document);
    return {
      backendId,
      resolvedUrl,
      resolvedPath,
      info: document.info ?? {},
      openapi: document.openapi ?? document.swagger,
      servers: document.servers ?? [],
      tagCount: (document.tags ?? []).length,
      operationCount: operations.length,
      schemaCount: Object.keys(document.components?.schemas ?? {}).length,
      security: document.security ?? [],
      securitySchemes: document.components?.securitySchemes ?? {},
    };
  }

  /**
   * Lists tags declared on the document (plus any tags found only on operations).
   *
   * @param backendId - Backend id
   * @returns Tag list with optional descriptions
   */
  async listTags(backendId: string) {
    const { document } = await this.getDocument(backendId);
    const declared = new Map<string, string | undefined>();
    for (const tag of document.tags ?? []) {
      if (tag.name) {
        declared.set(tag.name, tag.description);
      }
    }
    for (const op of indexOperations(backendId, document)) {
      for (const tag of op.tags) {
        if (!declared.has(tag)) {
          declared.set(tag, undefined);
        }
      }
    }
    return [...declared.entries()]
      .map(([name, description]) => ({ name, description }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Returns security schemes and requirements (global and optionally per operation).
   *
   * @param backendId - Backend id
   * @param operationLookup - Optional operation selector
   * @returns Security payload
   */
  async getSecurity(backendId: string, operationLookup?: { method?: string; path?: string; operationId?: string }) {
    const { document } = await this.getDocument(backendId);
    const result: {
      backendId: string;
      globalSecurity: SecurityRequirement[];
      securitySchemes: Record<string, unknown>;
      operationSecurity?: SecurityRequirement[] | null;
      operation?: { method: string; path: string; operationId?: string };
    } = {
      backendId,
      globalSecurity: document.security ?? [],
      securitySchemes: document.components?.securitySchemes ?? {},
    };

    if (operationLookup && (operationLookup.operationId || (operationLookup.method && operationLookup.path))) {
      const op = findOperation(indexOperations(backendId, document), operationLookup);
      if (!op) {
        throw new Error(operationNotFoundMessage(operationLookup));
      }
      result.operation = {
        method: op.method,
        path: op.path,
        operationId: op.operationId,
      };
      // Explicit empty array means "no auth"; undefined falls back to global.
      result.operationSecurity = op.operation.security !== undefined ? op.operation.security : null;
    }

    return result;
  }

  /**
   * Lists operations with optional filters.
   *
   * @param backendId - Backend id
   * @param filters - tag/method/path filters
   * @returns Summaries
   */
  async listOperations(backendId: string, filters: { tag?: string; method?: string; path?: string } = {}) {
    const { document } = await this.getDocument(backendId);
    return filterOperations(indexOperations(backendId, document), filters).map(summarizeOperation);
  }

  /**
   * Searches operations by free text.
   *
   * @param backendId - Backend id
   * @param query - Search string
   * @returns Summaries
   */
  async searchOperations(backendId: string, query: string) {
    const { document } = await this.getDocument(backendId);
    return searchOperations(indexOperations(backendId, document), query).map(summarizeOperation);
  }

  /**
   * Returns a detailed operation with dereferenced schemas and a request example.
   *
   * @param backendId - Backend id
   * @param lookup - method+path and/or operationId
   * @returns Enriched operation payload
   */
  async getOperation(backendId: string, lookup: { method?: string; path?: string; operationId?: string }) {
    const { document } = await this.getDocument(backendId);
    const indexed = findOperation(indexOperations(backendId, document), lookup);
    if (!indexed) {
      throw new Error(operationNotFoundMessage(lookup));
    }

    const parameters = mergeParameters(indexed.pathParameters, indexed.operation.parameters).map((parameter) => ({
      ...parameter,
      schema: dereferenceSchema(parameter.schema, document),
    }));

    const requestBody = indexed.operation.requestBody
      ? {
          description: indexed.operation.requestBody.description,
          required: indexed.operation.requestBody.required,
          content: mapContentSchemas(indexed.operation.requestBody.content, document),
        }
      : undefined;

    const responses: Record<string, unknown> = {};
    for (const [status, response] of Object.entries(indexed.operation.responses ?? {})) {
      if (!response || typeof response !== 'object') {
        responses[status] = response;
        continue;
      }
      responses[status] = {
        description: response.description,
        content: mapContentSchemas(response.content, document),
      };
    }

    const example = buildRequestExample(
      {
        ...indexed.operation,
        requestBody: requestBody as typeof indexed.operation.requestBody,
      },
      parameters,
    );

    return {
      backendId,
      method: indexed.method,
      path: indexed.path,
      operationId: indexed.operationId,
      summary: indexed.summary,
      description: indexed.description,
      tags: indexed.tags,
      security: indexed.operation.security !== undefined ? indexed.operation.security : (document.security ?? []),
      parameters,
      requestBody,
      responses,
      requestExample: example,
    };
  }

  /**
   * Executes an HTTP request against a registered backend operation.
   *
   * Resolves the operation from the OpenAPI document, builds the URL from
   * `baseUrl` plus an optional relative/same-origin `servers[0]` prefix, merges
   * auth headers, and returns status/body even for HTTP 4xx/5xx. Transport
   * failures (timeout, missing path param, missing headerEnv) throw.
   *
   * @param input - Backend, operation selector, params, body, and auth
   * @returns Normalized HTTP result for the agent
   */
  async callEndpoint(input: CallEndpointInput): Promise<CallEndpointResult> {
    const backend = await this.requireBackend(input.backendId);
    const { document } = await this.getDocument(input.backendId);
    const indexed = findOperation(indexOperations(input.backendId, document), {
      method: input.method,
      path: input.path,
      operationId: input.operationId,
    });
    if (!indexed) {
      throw new Error(operationNotFoundMessage(input));
    }

    const url = buildCallUrl({
      baseUrl: backend.baseUrl,
      servers: document.servers ?? [],
      pathTemplate: indexed.path,
      pathParams: input.pathParams,
      query: input.query,
    });

    const headers = mergeCallHeaders(input.headers, input.headerEnv);
    const serialized = serializeCallBody(input.body);
    if (serialized.defaultJson && !hasHeaderIgnoreCase(headers, 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }

    const method = indexed.method;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: serialized.body,
        signal: AbortSignal.timeout(this.config.callTimeoutMs),
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(`call_endpoint timed out after ${this.config.callTimeoutMs}ms for ${method} ${url}.`, {
          cause: error,
        });
      }
      throw error;
    }

    return materializeCallResult(response, {
      url,
      method,
      maxBodyBytes: this.config.callMaxBodyBytes,
    });
  }

  /**
   * Returns a dereferenced component schema by name or `#/…` ref.
   *
   * @param backendId - Backend id
   * @param nameOrRef - Schema name or local `$ref`
   * @returns Schema payload
   */
  async getSchema(backendId: string, nameOrRef: string) {
    const { document } = await this.getDocument(backendId);
    const ref = nameOrRef.startsWith('#/') ? nameOrRef : `#/components/schemas/${nameOrRef}`;
    const name = nameOrRef.startsWith('#/') ? (nameOrRef.split('/').pop() ?? nameOrRef) : nameOrRef;

    let schema: JsonSchema | undefined;
    if (nameOrRef.startsWith('#/')) {
      schema = dereferenceSchema({ $ref: ref }, document);
    } else {
      const raw = document.components?.schemas?.[name];
      if (!raw) {
        throw new Error(`Schema "${name}" not found under components.schemas for backend "${backendId}".`);
      }
      schema = dereferenceSchema(raw, document);
    }

    if (!schema) {
      throw new Error(`Could not resolve schema "${nameOrRef}" for backend "${backendId}".`);
    }

    return {
      backendId,
      name,
      ref,
      schema,
    };
  }

  /**
   * Loads a backend entry or throws with agent-friendly guidance.
   *
   * @param backendId - Backend id
   * @returns Backend entry
   */
  async requireBackend(backendId: string): Promise<BackendEntry> {
    const backend = await this.registry.get(backendId);
    if (!backend) {
      throw new Error(missingBackendMessage(backendId));
    }
    return backend;
  }

  /**
   * Returns a cached or freshly fetched OpenAPI document for a backend.
   *
   * @param backendId - Backend id
   * @param force - When true, bypasses cache
   * @returns Document and resolution metadata
   */
  async getDocument(
    backendId: string,
    force = false,
  ): Promise<{
    document: OpenApiDocument;
    resolvedUrl: string;
    resolvedPath: string;
  }> {
    if (!force) {
      const cached = this.specCache.get(backendId);
      if (cached) {
        return cached;
      }
    }
    const backend = await this.requireBackend(backendId);
    const fetched = await fetchOpenApiDocument(backend, this.fetchImpl);
    this.specCache.set(backendId, fetched);
    return fetched;
  }
}

/**
 * Builds the agent-facing message when an operation lookup misses.
 *
 * @param lookup - Failed lookup fields
 * @returns Error message suggesting list/search tools
 */
function operationNotFoundMessage(lookup: { method?: string; path?: string; operationId?: string }): string {
  const parts = [
    lookup.operationId ? `operationId=${lookup.operationId}` : null,
    lookup.method && lookup.path ? `${lookup.method.toUpperCase()} ${lookup.path}` : null,
  ].filter(Boolean);
  return `Operation not found (${parts.join(', ') || 'empty lookup'}). Use list_operations or search_operations.`;
}

/**
 * Merges path-level and operation-level parameters (operation wins on same name+in).
 *
 * @param pathParameters - Path item parameters
 * @param operationParameters - Operation parameters
 * @returns Merged list
 */
function mergeParameters(
  pathParameters: ParameterObject[],
  operationParameters: ParameterObject[] | undefined,
): ParameterObject[] {
  const map = new Map<string, ParameterObject>();
  for (const parameter of pathParameters) {
    const key = `${parameter.in ?? ''}:${parameter.name ?? ''}`;
    map.set(key, parameter);
  }
  for (const parameter of operationParameters ?? []) {
    const key = `${parameter.in ?? ''}:${parameter.name ?? ''}`;
    map.set(key, parameter);
  }
  return [...map.values()];
}

/**
 * Dereferences schemas inside a content map.
 *
 * @param content - Media type map
 * @param document - Root document
 * @returns Content map with dereferenced schemas
 */
function mapContentSchemas(
  content: Record<string, { schema?: JsonSchema; example?: unknown; examples?: unknown }> | undefined,
  document: OpenApiDocument,
): Record<string, unknown> | undefined {
  if (!content) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [mediaType, media] of Object.entries(content)) {
    out[mediaType] = {
      ...media,
      schema: dereferenceSchema(media.schema, document),
    };
  }
  return out;
}

/**
 * Checks whether a header name exists in a record (case-insensitive).
 *
 * @param headers - Header map
 * @param name - Header name to find
 * @returns True when present
 */
function hasHeaderIgnoreCase(headers: Record<string, string>, name: string): boolean {
  const target = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

/**
 * Detects AbortSignal timeout / abort errors across runtimes.
 *
 * @param error - Caught value
 * @returns True when the failure is an abort/timeout
 */
function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const name = (error as { name?: string }).name;
  return name === 'TimeoutError' || name === 'AbortError';
}
