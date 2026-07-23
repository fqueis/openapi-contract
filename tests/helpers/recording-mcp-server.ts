/**
 * Minimal MCP server stand-in at the SDK boundary: captures `registerTool`
 * handlers so tests can invoke tools without spinning up transport.
 *
 * This is not a mock of the contract service; callers wire a real
 * `OpenApiContractService` instance.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Handler shape stored by the recording server for later `call` invocation.
 */
type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

/**
 * Recording MCP server used by tool-registration specs.
 */
export type RecordingMcpServer = {
  /** Stub cast as {@link McpServer} for `register*Tools` APIs. */
  server: McpServer;
  /**
   * Invokes a previously registered tool handler.
   *
   * @param name - Tool name
   * @param args - Tool arguments
   * @returns Handler result (JSON or error payload)
   */
  call: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  /**
   * Lists registered tool names.
   *
   * @returns Tool names in registration order of Map iteration
   */
  toolNames: () => string[];
};

/**
 * Creates a recording server that stores registered tool handlers by name.
 *
 * @returns Server stub cast as McpServer plus a `call` helper
 */
export function createRecordingMcpServer(): RecordingMcpServer {
  const handlers = new Map<string, ToolHandler>();

  const server = {
    registerTool(name: string, _config: unknown, handler: ToolHandler) {
      handlers.set(name, handler);
    },
  };

  const call = (name: string, args: Record<string, unknown> = {}) => {
    const handler = handlers.get(name);
    if (!handler) {
      throw new Error(`Tool "${name}" was not registered`);
    }
    return handler(args);
  };

  return {
    server: server as unknown as McpServer,
    call,
    toolNames: () => [...handlers.keys()],
  };
}
