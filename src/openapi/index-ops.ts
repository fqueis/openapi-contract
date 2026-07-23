/**
 * Flattens OpenAPI `paths` into searchable {@link IndexedOperation} rows.
 */

import type { IndexedOperation, OpenApiDocument, Operation } from '@openapi/types.js';

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

/**
 * Indexes all operations in a document for list/search tools.
 *
 * @param backendId - Owning backend id
 * @param document - OpenAPI document
 * @returns Flattened operations
 */
export function indexOperations(backendId: string, document: OpenApiDocument): IndexedOperation[] {
  const result: IndexedOperation[] = [];
  const paths = document.paths ?? {};

  for (const [pathKey, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') {
      continue;
    }
    const item = pathItem;
    const pathParameters = Array.isArray(item.parameters) ? item.parameters : [];

    for (const [method, value] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) {
        continue;
      }
      if (!value || typeof value !== 'object') {
        continue;
      }
      const operation = value as Operation;
      result.push({
        backendId,
        method: method.toUpperCase(),
        path: pathKey,
        operationId: operation.operationId,
        summary: operation.summary,
        description: operation.description,
        tags: Array.isArray(operation.tags) ? operation.tags : [],
        operation,
        pathParameters,
      });
    }
  }

  return result.sort((a, b) => {
    const pathCmp = a.path.localeCompare(b.path);
    if (pathCmp !== 0) return pathCmp;
    return a.method.localeCompare(b.method);
  });
}

/**
 * Filters indexed operations by optional tag/method/path substring.
 *
 * @param operations - Full index
 * @param filters - Optional filters
 * @returns Matching operations
 */
export function filterOperations(
  operations: IndexedOperation[],
  filters: {
    tag?: string;
    method?: string;
    path?: string;
  },
): IndexedOperation[] {
  const tag = filters.tag?.trim().toLowerCase();
  const method = filters.method?.trim().toUpperCase();
  const path = filters.path?.trim().toLowerCase();

  return operations.filter((op) => {
    if (tag && !op.tags.some((t) => t.toLowerCase() === tag)) {
      return false;
    }
    if (method && op.method !== method) {
      return false;
    }
    if (path && !op.path.toLowerCase().includes(path)) {
      return false;
    }
    return true;
  });
}

/**
 * Case-insensitive text search across path, summary, description, tags, operationId.
 *
 * @param operations - Full index
 * @param query - Free-text query
 * @returns Matching operations
 */
export function searchOperations(operations: IndexedOperation[], query: string): IndexedOperation[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return operations;
  }
  return operations.filter((op) => {
    const haystack = [op.path, op.method, op.operationId ?? '', op.summary ?? '', op.description ?? '', ...op.tags]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}

/**
 * Finds one operation by method+path or operationId.
 *
 * @param operations - Full index
 * @param lookup - Lookup fields
 * @returns Matching operation or undefined
 */
export function findOperation(
  operations: IndexedOperation[],
  lookup: { method?: string; path?: string; operationId?: string },
): IndexedOperation | undefined {
  if (lookup.operationId?.trim()) {
    const id = lookup.operationId.trim();
    const byId = operations.find((op) => op.operationId === id);
    if (byId) {
      return byId;
    }
  }
  if (lookup.method && lookup.path) {
    const method = lookup.method.toUpperCase();
    const path = lookup.path;
    return operations.find((op) => op.method === method && op.path === path);
  }
  return undefined;
}

/**
 * Summarizes an indexed operation for list/search payloads (omits raw operation).
 *
 * @param op - Indexed operation
 * @returns Lightweight summary
 */
export function summarizeOperation(op: IndexedOperation) {
  return {
    backendId: op.backendId,
    method: op.method,
    path: op.path,
    operationId: op.operationId,
    summary: op.summary,
    description: op.description,
    tags: op.tags,
  };
}
