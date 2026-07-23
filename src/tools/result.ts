/**
 * MCP tool helpers: JSON result wrapping and error mapping for agents.
 */

/**
 * Builds a successful MCP tool result with JSON text content.
 *
 * @param data - Serializable payload
 * @returns CallToolResult-shaped object
 */
export function jsonResult(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * Builds a tool error result (isError) with a clear message for the agent.
 *
 * @param error - Thrown value
 * @returns CallToolResult-shaped error object
 */
export function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true as const,
    content: [
      {
        type: 'text' as const,
        text: message,
      },
    ],
  };
}
