/**
 * Shared OpenAPI document shapes used across fetch, index, and deref helpers.
 *
 * Kept intentionally loose: OpenAPI documents vary by generator and version.
 */

/**
 * Minimal OpenAPI 3.x document surface required by this MCP.
 */
export interface OpenApiDocument {
  /** OpenAPI 3.x version string when present (e.g. `3.0.3`). */
  openapi?: string;
  /** Swagger 2.0 version string when the document is still Swagger-shaped. */
  swagger?: string;
  /** API metadata used by overview tools. */
  info?: {
    /** Human-readable API title. */
    title?: string;
    /** API version published by the backend. */
    version?: string;
    /** Longer API description for agents. */
    description?: string;
  };
  /** Declared server bases (first entry often used as default origin). */
  servers?: Array<{ url?: string; description?: string }>;
  /** Tag catalog for filtering and overview. */
  tags?: Array<{ name?: string; description?: string }>;
  /** Path template map; each value is a {@link PathItem}. */
  paths?: Record<string, PathItem>;
  /** Reusable components referenced by `$ref`. */
  components?: {
    /** Named schemas under `#/components/schemas`. */
    schemas?: Record<string, JsonSchema>;
    /** Named security schemes under `#/components/securitySchemes`. */
    securitySchemes?: Record<string, SecurityScheme>;
  };
  /** Document-level security requirements inherited by operations. */
  security?: SecurityRequirement[];
  /** Passthrough for vendor extensions and unmodeled OpenAPI fields. */
  [key: string]: unknown;
}

/**
 * Path item holding HTTP method operations plus optional shared parameters.
 */
export type PathItem = Record<string, unknown> & {
  /** Parameters shared by every operation under this path template. */
  parameters?: ParameterObject[];
};

/**
 * Single OpenAPI operation (GET, POST, etc.).
 */
export interface Operation {
  /** Stable operation id when the generator provides one. */
  operationId?: string;
  /** Short summary shown in list/search results. */
  summary?: string;
  /** Longer description for get_operation payloads. */
  description?: string;
  /** Tag names used for filtering. */
  tags?: string[];
  /** Operation-level parameters (override path-level on same name+in). */
  parameters?: ParameterObject[];
  /** Optional request body declaration. */
  requestBody?: RequestBodyObject;
  /** Status-code keyed responses. */
  responses?: Record<string, ResponseObject>;
  /** Operation-level security; empty array means explicitly unauthenticated. */
  security?: SecurityRequirement[];
  /** Passthrough for vendor extensions and unmodeled fields. */
  [key: string]: unknown;
}

/**
 * Path, query, header, or cookie parameter.
 */
export interface ParameterObject {
  /** Parameter name as declared in the document. */
  name?: string;
  /** Location: `path`, `query`, `header`, or `cookie`. */
  in?: string;
  /** Whether the caller must supply the parameter. */
  required?: boolean;
  /** Human-readable parameter purpose. */
  description?: string;
  /** Value schema (may still contain `$ref`). */
  schema?: JsonSchema;
  /** Single explicit example when provided. */
  example?: unknown;
  /** Named examples map; first value is preferred when `example` is absent. */
  examples?: Record<string, { value?: unknown }>;
  /** JSON Pointer / component ref when the parameter is not inlined. */
  $ref?: string;
}

/**
 * Request body wrapper with media types.
 */
export interface RequestBodyObject {
  /** Human-readable body purpose. */
  description?: string;
  /** Whether a body is required for the operation. */
  required?: boolean;
  /** Media type map (`application/json`, etc.). */
  content?: Record<string, MediaTypeObject>;
}

/**
 * Response object with optional content map.
 */
export interface ResponseObject {
  /** Required OpenAPI response description. */
  description?: string;
  /** Media type map for the response payload. */
  content?: Record<string, MediaTypeObject>;
  /** JSON Pointer / component ref when the response is not inlined. */
  $ref?: string;
}

/**
 * Media type entry (application/json, etc.).
 */
export interface MediaTypeObject {
  /** Payload schema (may still contain `$ref`). */
  schema?: JsonSchema;
  /** Single explicit example when provided. */
  example?: unknown;
  /** Named examples map; first value is preferred when `example` is absent. */
  examples?: Record<string, { value?: unknown }>;
}

/**
 * JSON Schema fragment (including `$ref`).
 */
export interface JsonSchema {
  /** Local or external JSON Schema / OpenAPI ref. */
  $ref?: string;
  /** JSON Schema type or union of types. */
  type?: string | string[];
  /** Object property map when `type` includes `object`. */
  properties?: Record<string, JsonSchema>;
  /** Array item schema when `type` includes `array`. */
  items?: JsonSchema;
  /** Required property names for object schemas. */
  required?: string[];
  /** Closed set of allowed values. */
  enum?: unknown[];
  /** Single explicit example. */
  example?: unknown;
  /** Alternate examples list (OpenAPI 3.1 style). */
  examples?: unknown[];
  /** Human-readable field purpose. */
  description?: string;
  /** Format hint (`email`, `uuid`, `date-time`, ...). */
  format?: string;
  /** All-of composition. */
  allOf?: JsonSchema[];
  /** One-of composition. */
  oneOf?: JsonSchema[];
  /** Any-of composition. */
  anyOf?: JsonSchema[];
  /** Whether null is allowed (OpenAPI 3.0 style). */
  nullable?: boolean;
  /** Additional property policy for object schemas. */
  additionalProperties?: boolean | JsonSchema;
  /** Passthrough for vendor extensions and unmodeled keywords. */
  [key: string]: unknown;
}

/**
 * Security scheme from `components.securitySchemes`.
 */
export interface SecurityScheme {
  /** Scheme kind (`http`, `apiKey`, `oauth2`, `openIdConnect`, ...). */
  type?: string;
  /** HTTP auth scheme name when `type` is `http` (e.g. `bearer`). */
  scheme?: string;
  /** Bearer token format hint (e.g. `JWT`). */
  bearerFormat?: string;
  /** Header/query/cookie name when `type` is `apiKey`. */
  name?: string;
  /** apiKey location (`header`, `query`, `cookie`). */
  in?: string;
  /** Human-readable scheme purpose. */
  description?: string;
  /** OAuth2 flows object when `type` is `oauth2` (left untyped). */
  flows?: unknown;
  /** Passthrough for vendor extensions and unmodeled fields. */
  [key: string]: unknown;
}

/**
 * Security requirement map: scheme name → scopes.
 */
export type SecurityRequirement = Record<string, string[]>;

/**
 * Flattened operation row used by list/search/get tools.
 */
export interface IndexedOperation {
  /** Backend id that owns this operation. */
  backendId: string;
  /** HTTP method in uppercase. */
  method: string;
  /** OpenAPI path template. */
  path: string;
  /** Optional operationId. */
  operationId?: string;
  /** Short summary. */
  summary?: string;
  /** Longer description. */
  description?: string;
  /** Tag names. */
  tags: string[];
  /** Raw operation object from the document. */
  operation: Operation;
  /** Path-level parameters merged later by get_operation. */
  pathParameters: ParameterObject[];
}
