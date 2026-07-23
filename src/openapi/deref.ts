/**
 * Dereferences local `$ref` pointers within a single OpenAPI document.
 *
 * Cycle-safe: circular refs are replaced with a marker object. External HTTP
 * refs are left unresolved and annotated.
 */

import type { JsonSchema, OpenApiDocument } from '@openapi/types.js';

/**
 * Deep-clones and resolves `$ref` values relative to `document`.
 *
 * @param schema - Schema fragment that may contain `$ref`
 * @param document - Root OpenAPI document (components target)
 * @returns Dereferenced schema clone
 */
export function dereferenceSchema(schema: JsonSchema | undefined, document: OpenApiDocument): JsonSchema | undefined {
  if (!schema) {
    return undefined;
  }
  return derefNode(schema, document, new Set()) as JsonSchema;
}

/**
 * Recursively walks a JSON value, resolving local `#/` refs.
 *
 * @param node - Current node
 * @param document - Root document
 * @param stack - Active ref stack for cycle detection
 * @returns Dereferenced clone
 */
function derefNode(node: unknown, document: OpenApiDocument, stack: Set<string>): unknown {
  if (node === null || typeof node !== 'object') {
    return node;
  }

  if (Array.isArray(node)) {
    return node.map((item) => derefNode(item, document, stack));
  }

  const record = node as Record<string, unknown>;
  if (typeof record.$ref === 'string') {
    const ref = record.$ref;
    if (!ref.startsWith('#/')) {
      return {
        ...record,
        'x-unresolved-ref': ref,
        description: typeof record.description === 'string' ? record.description : `Unresolved external $ref: ${ref}`,
      };
    }
    if (stack.has(ref)) {
      return { $ref: ref, 'x-circular-ref': true };
    }
    const target = resolveLocalRef(document, ref);
    if (target === undefined) {
      return { $ref: ref, 'x-missing-ref': true };
    }
    const nextStack = new Set(stack);
    nextStack.add(ref);
    const resolved = derefNode(target, document, nextStack);
    // Keep sibling keywords (OpenAPI 3.1 style) merged lightly over the target.
    const siblings = { ...record };
    delete siblings.$ref;
    if (Object.keys(siblings).length === 0) {
      return resolved;
    }
    if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
      return { ...resolved, ...siblings };
    }
    return resolved;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = derefNode(value, document, stack);
  }
  return out;
}

/**
 * Resolves a `#/components/schemas/Foo` style pointer against the document.
 *
 * @param document - Root document
 * @param ref - JSON pointer starting with `#/`
 * @returns Target value or undefined
 */
export function resolveLocalRef(document: OpenApiDocument, ref: string): unknown {
  if (!ref.startsWith('#/')) {
    return undefined;
  }
  const parts = ref
    .slice(2)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));

  let current: unknown = document;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
