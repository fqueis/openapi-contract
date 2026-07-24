/**
 * HTTP execution helpers for call_endpoint (auth merge and response parsing).
 *
 * Does not own OpenAPI discovery or URL assembly. Secrets are never persisted;
 * callers pass literal headers and/or env var names per request.
 */

/**
 * Result shape returned to tools after an API call completes.
 */
export type CallEndpointResult = {
  /** HTTP status code from the backend. */
  status: number;
  /** Response headers as a plain lowercase-key map (multi-values joined). */
  headers: Record<string, string>;
  /** Parsed JSON when Content-Type is JSON and body is intact; otherwise string. */
  body: unknown;
  /** Final request URL. */
  url: string;
  /** Uppercase HTTP method. */
  method: string;
  /** True when the returned body was cut to callMaxBodyBytes. */
  truncated: boolean;
};

/**
 * Merges literal headers with values resolved from process.env via headerEnv.
 * Values from headerEnv overwrite the same header name from headers.
 *
 * @param headers - Literal header map from the tool call
 * @param headerEnv - Map of header name → env var name
 * @param env - Env source (defaults to process.env; injectable for tests)
 * @returns Merged header record
 * @throws Error when a referenced env var is missing or empty
 *
 * @example
 * ```typescript
 * mergeCallHeaders(
 *   { Authorization: 'Bearer literal' },
 *   { Authorization: 'API_TOKEN' },
 *   { API_TOKEN: 'from-env' },
 * );
 * // → { Authorization: 'from-env' }
 * ```
 */
export function mergeCallHeaders(
  headers: Record<string, string> | undefined,
  headerEnv: Record<string, string> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const merged: Record<string, string> = { ...(headers ?? {}) };
  for (const [headerName, envName] of Object.entries(headerEnv ?? {})) {
    const value = env[envName];
    if (value === undefined || value.trim() === '') {
      throw new Error(
        `Environment variable "${envName}" for header "${headerName}" is missing or empty. ` +
          `Set it in the MCP server process env, or pass the value via headers instead.`,
      );
    }
    merged[headerName] = value;
  }
  return merged;
}

/**
 * Reads a fetch Response into a {@link CallEndpointResult} body/headers payload.
 *
 * Truncates raw text to `maxBodyBytes` before JSON parse attempts. Truncated
 * bodies are always returned as strings (never partially parsed JSON).
 *
 * @param response - Fetch response
 * @param meta - Request url/method and max body size
 * @returns Normalized call result
 */
export async function materializeCallResult(
  response: Response,
  meta: { url: string; method: string; maxBodyBytes: number },
): Promise<CallEndpointResult> {
  const text = await response.text();
  const truncated = text.length > meta.maxBodyBytes;
  const raw = truncated ? text.slice(0, meta.maxBodyBytes) : text;
  const headerMap = headersToRecord(response.headers);
  const contentType = headerMap['content-type'] ?? '';

  let body: unknown = raw;
  if (!truncated && contentType.toLowerCase().includes('application/json') && raw.length > 0) {
    try {
      body = JSON.parse(raw) as unknown;
    } catch {
      body = raw;
    }
  }

  return {
    status: response.status,
    headers: headerMap,
    body,
    url: meta.url,
    method: meta.method,
    truncated,
  };
}

/**
 * Serializes a request body for fetch: objects become JSON strings.
 *
 * @param body - Tool-provided body
 * @returns Body init value and whether Content-Type should default to JSON
 */
export function serializeCallBody(body: unknown): { body?: string; defaultJson: boolean } {
  if (body === undefined || body === null) {
    return { defaultJson: false };
  }
  if (typeof body === 'string') {
    return { body, defaultJson: false };
  }
  return { body: JSON.stringify(body), defaultJson: true };
}

/**
 * Flattens Headers into a plain object (lowercase keys; joins duplicates).
 *
 * @param headers - Fetch Headers
 * @returns Plain map
 */
function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    const existing = out[key.toLowerCase()];
    out[key.toLowerCase()] = existing ? `${existing}, ${value}` : value;
  });
  return out;
}
