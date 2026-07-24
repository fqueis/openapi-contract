/**
 * Registers the optional call_endpoint MCP tool when HTTP execution is enabled.
 *
 * Opt-in only: callers must gate registration with AppConfig.enableCalls so the
 * default MCP surface stays read-only contract inspection.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { OpenApiContractService } from '@/service.js';
import { errorResult, jsonResult } from '@tools/result.js';

/**
 * Wires `call_endpoint` onto the MCP server.
 *
 * @param server - MCP server instance
 * @param service - Contract application service
 */
export function registerCallTools(server: McpServer, service: OpenApiContractService): void {
  server.registerTool(
    'call_endpoint',
    {
      title: 'Call endpoint',
      description:
        'Execute an HTTP request against a registered backend operation. ' +
        'Provide operationId and/or method+path. Auth via headers and/or headerEnv ' +
        '(env var names resolved in the MCP process; headerEnv wins on conflicts). ' +
        'HTTP 4xx/5xx are returned as normal results; transport failures are errors.',
      inputSchema: {
        backendId: z.string().describe('Registered backend id'),
        method: z.string().optional().describe('HTTP method when selecting by method+path'),
        path: z.string().optional().describe('OpenAPI path template when selecting by method+path'),
        operationId: z.string().optional().describe('OpenAPI operationId'),
        pathParams: z.record(z.string(), z.string()).optional().describe('Path template parameter values'),
        query: z.record(z.string(), z.string()).optional().describe('Query string parameters'),
        body: z.unknown().optional().describe('Request body (object serialized as JSON, or raw string)'),
        headers: z.record(z.string(), z.string()).optional().describe('Literal request headers'),
        headerEnv: z
          .record(z.string(), z.string())
          .optional()
          .describe('Header name → process env var name (overrides headers on conflict)'),
      },
    },
    async (args) => {
      try {
        const { backendId, method, path, operationId } = args;
        if (!operationId && !(method && path)) {
          return errorResult(new Error('Provide operationId and/or both method and path.'));
        }
        return jsonResult(
          await service.callEndpoint({
            backendId,
            method,
            path,
            operationId,
            pathParams: args.pathParams,
            query: args.query,
            body: args.body,
            headers: args.headers,
            headerEnv: args.headerEnv,
          }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

/**
 * Registers call tools only when execution is enabled for this process.
 *
 * @param server - MCP server instance
 * @param service - Contract application service
 * @param enableCalls - From {@link AppConfig.enableCalls}
 */
export function registerCallToolsIfEnabled(
  server: McpServer,
  service: OpenApiContractService,
  enableCalls: boolean,
): void {
  if (enableCalls) {
    registerCallTools(server, service);
  }
}
