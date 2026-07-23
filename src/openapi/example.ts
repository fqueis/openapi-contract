/**
 * Builds illustrative request examples from OpenAPI media types or schemas.
 *
 * Prefers explicit `example` / `examples`; otherwise walks the schema to invent
 * plausible values (not guaranteed to pass server validation).
 */

import type { JsonSchema, MediaTypeObject, Operation, ParameterObject } from '@openapi/types.js';

/**
 * Structured request example for agent-friendly consumption.
 */
export interface RequestExample {
  /** Path/query/header/cookie parameter examples keyed by name. */
  parameters: Record<string, unknown>;
  /** Example JSON (or other) body when the operation declares a requestBody. */
  body?: unknown;
  /** Media type chosen for the body example. */
  contentType?: string;
}

/**
 * Builds a request example for an operation.
 *
 * @param operation - OpenAPI operation
 * @param parameters - Merged path + operation parameters (already dereferenced schemas optional)
 * @returns Parameter map and optional body example
 */
export function buildRequestExample(operation: Operation, parameters: ParameterObject[]): RequestExample {
  const parameterExamples: Record<string, unknown> = {};
  for (const parameter of parameters) {
    if (!parameter.name) {
      continue;
    }
    parameterExamples[parameter.name] = pickParameterExample(parameter);
  }

  const result: RequestExample = { parameters: parameterExamples };
  const content = operation.requestBody?.content;
  if (!content) {
    return result;
  }

  const preferred = content['application/json'] ?? content['application/*+json'] ?? Object.values(content)[0];
  const contentType =
    content['application/json'] !== undefined
      ? 'application/json'
      : content['application/*+json'] !== undefined
        ? 'application/*+json'
        : Object.keys(content)[0];

  if (preferred) {
    result.body = pickMediaExample(preferred);
    result.contentType = contentType;
  }
  return result;
}

/**
 * Picks an explicit parameter example, else invents one from the schema.
 *
 * @param parameter - Parameter object
 * @returns Example value
 */
function pickParameterExample(parameter: ParameterObject): unknown {
  if (parameter.example !== undefined) {
    return parameter.example;
  }
  const firstNamed = parameter.examples && Object.values(parameter.examples)[0]?.value;
  if (firstNamed !== undefined) {
    return firstNamed;
  }
  return exampleFromSchema(parameter.schema);
}

/**
 * Picks an explicit media-type example, else invents one from the schema.
 *
 * @param media - Media type object
 * @returns Example value
 */
function pickMediaExample(media: MediaTypeObject): unknown {
  if (media.example !== undefined) {
    return media.example;
  }
  const firstNamed = media.examples && Object.values(media.examples)[0]?.value;
  if (firstNamed !== undefined) {
    return firstNamed;
  }
  return exampleFromSchema(media.schema);
}

/**
 * Invents a simple example from a JSON Schema fragment.
 *
 * @param schema - Schema (ideally already dereferenced)
 * @param depth - Recursion guard
 * @returns Example value
 */
export function exampleFromSchema(schema: JsonSchema | undefined, depth = 0): unknown {
  if (!schema || depth > 6) {
    return null;
  }
  if (schema.example !== undefined) {
    return schema.example;
  }
  if (Array.isArray(schema.examples) && schema.examples.length > 0) {
    return schema.examples[0];
  }
  if (schema.enum && schema.enum.length > 0) {
    return schema.enum[0];
  }

  const composed = schema.allOf?.[0] ?? schema.oneOf?.[0] ?? schema.anyOf?.[0];
  if (composed) {
    return exampleFromSchema(composed, depth + 1);
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  switch (type) {
    case 'string':
      if (schema.format === 'date') return '2026-01-15';
      if (schema.format === 'date-time') return '2026-01-15T12:00:00.000Z';
      if (schema.format === 'email') return 'user@example.com';
      if (schema.format === 'uuid') return '00000000-0000-4000-8000-000000000000';
      return 'string';
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return true;
    case 'array':
      return [exampleFromSchema(schema.items, depth + 1)];
    case 'object':
    default: {
      if (schema.properties) {
        const obj: Record<string, unknown> = {};
        for (const [key, prop] of Object.entries(schema.properties)) {
          obj[key] = exampleFromSchema(prop, depth + 1);
        }
        return obj;
      }
      if (type === 'object') {
        return {};
      }
      return null;
    }
  }
}
