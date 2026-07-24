/**
 * Pure URL assembly for call_endpoint against a registered backend.
 *
 * Joins registry baseUrl, an optional OpenAPI servers[0] prefix (relative or
 * same-origin absolute), path templates, and query. Does not perform HTTP.
 */

/**
 * OpenAPI server entry used when resolving a call URL prefix.
 */
export type CallServer = {
  /** Server URL from the OpenAPI document (relative or absolute). */
  url?: string;
};

/**
 * Inputs for {@link buildCallUrl}.
 */
export type BuildCallUrlInput = {
  /** Registered backend origin (no trailing slash required). */
  baseUrl: string;
  /** OpenAPI `servers` list; only the first entry may contribute a prefix. */
  servers: CallServer[];
  /** OpenAPI path template (e.g. `/v1/users/{id}`). */
  pathTemplate: string;
  /** Values for `{name}` segments in the path template. */
  pathParams?: Record<string, string>;
  /** Query string key/value pairs. */
  query?: Record<string, string>;
};

/**
 * Builds the absolute request URL for an OpenAPI operation call.
 *
 * Relative `servers[0].url` is joined under `baseUrl`. Absolute servers on a
 * different origin are ignored (caller stays on the registered backend).
 * Absolute servers on the same origin contribute their pathname as a prefix.
 *
 * @param input - Backend origin, servers, path template, and optional params
 * @returns Absolute URL string
 * @throws Error when a `{param}` in the path template has no `pathParams` value
 *
 * @example
 * ```typescript
 * buildCallUrl({
 *   baseUrl: 'http://localhost:3000',
 *   servers: [{ url: '/api/v1' }],
 *   pathTemplate: '/users/{id}',
 *   pathParams: { id: '42' },
 * });
 * // → http://localhost:3000/api/v1/users/42
 * ```
 */
export function buildCallUrl(input: BuildCallUrlInput): string {
  const origin = new URL(input.baseUrl);
  const prefix = resolveServerPrefix(origin, input.servers[0]?.url);
  const path = substitutePathParams(input.pathTemplate, input.pathParams ?? {});
  const pathname = joinPath(prefix, path);
  const url = new URL(pathname, origin);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * Resolves an optional servers[0] URL into a path prefix under the backend origin.
 *
 * @param origin - Registered backend origin
 * @param serverUrl - Optional OpenAPI server URL
 * @returns Pathname prefix without trailing slash, or empty string
 */
function resolveServerPrefix(origin: URL, serverUrl: string | undefined): string {
  if (!serverUrl || serverUrl.trim() === '') {
    return '';
  }
  const trimmed = serverUrl.trim();
  if (trimmed.startsWith('/')) {
    return trimTrailingSlash(trimmed);
  }
  try {
    const absolute = new URL(trimmed);
    if (absolute.origin !== origin.origin) {
      return '';
    }
    return trimTrailingSlash(absolute.pathname === '/' ? '' : absolute.pathname);
  } catch {
    return '';
  }
}

/**
 * Replaces `{name}` segments using pathParams.
 *
 * @param pathTemplate - OpenAPI path template
 * @param pathParams - Provided path parameter values
 * @returns Path with substitutions applied
 * @throws Error when a required template parameter is missing
 */
function substitutePathParams(pathTemplate: string, pathParams: Record<string, string>): string {
  return pathTemplate.replace(/\{([^}/]+)\}/g, (_match, name: string) => {
    const value = pathParams[name];
    if (value === undefined) {
      throw new Error(`Missing required path parameter "${name}" for path "${pathTemplate}".`);
    }
    return encodeURIComponent(value);
  });
}

/**
 * Joins a server prefix and operation path with normalized slashes.
 *
 * @param prefix - Optional server pathname prefix
 * @param path - Operation path (usually starts with `/`)
 * @returns Combined pathname starting with `/`
 */
function joinPath(prefix: string, path: string): string {
  const left = trimTrailingSlash(prefix);
  const right = path.startsWith('/') ? path : `/${path}`;
  if (!left) {
    return right;
  }
  return `${left}${right}`;
}

/**
 * Removes a single trailing slash unless the value is only `/`.
 *
 * @param value - Path or prefix
 * @returns Value without a trailing slash
 */
function trimTrailingSlash(value: string): string {
  if (value.length > 1 && value.endsWith('/')) {
    return value.slice(0, -1);
  }
  return value;
}
