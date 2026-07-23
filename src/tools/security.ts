/**
 * Registers the get_security MCP tool.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { OpenApiContractService } from '@/service.js';
import { errorResult, jsonResult } from '@tools/result.js';

/**
 * Wires security inspection onto the MCP server.
 *
 * @param server - MCP server instance
 * @param service - Contract application service
 */
export function registerSecurityTools(server: McpServer, service: OpenApiContractService): void {
  server.registerTool(
    'get_security',
    {
      title: 'Get security',
      description: 'Return security schemes and global requirements. Optionally include operation-level security.',
      inputSchema: {
        backendId: z.string().describe('Registered backend id'),
        method: z.string().optional().describe('HTTP method when inspecting one operation'),
        path: z.string().optional().describe('OpenAPI path when inspecting one operation'),
        operationId: z.string().optional().describe('operationId when inspecting one operation'),
      },
    },
    async (args) => {
      try {
        const { backendId, method, path, operationId } = args;
        const hasOp = Boolean(operationId || (method && path));
        return jsonResult(await service.getSecurity(backendId, hasOp ? { method, path, operationId } : undefined));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
