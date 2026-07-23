/**
 * Resolves the absolute URL string from a `fetch` first argument.
 *
 * Shared by test fetch stubs so request logging stays consistent across seams.
 *
 * @param input - Value accepted as the first argument to `fetch`
 * @returns Absolute URL string suitable for assertions and path suffix checks
 */
export function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return input.href;
  }

  // Remaining branch is Request (or Request-like); `.url` is always a string there.
  return String(input.url);
}
