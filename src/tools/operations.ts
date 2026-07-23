/**
 * Registers list/search/get operation MCP tools.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { OpenApiContractService } from '@/service.js';
import { errorResult, jsonResult } from '@tools/result.js';

/**
 * Wires operation discovery tools onto the MCP server.
 *
 * @param server - MCP server instance
 * @param service - Contract application service
 */
export function registerOperationTools(server: McpServer, service: OpenApiContractService): void {
  server.registerTool(
    'list_operations',
    {
      title: 'List operations',
      description: 'List OpenAPI operations with optional tag, method, and path substring filters.',
      inputSchema: {
        backendId: z.string().describe('Registered backend id'),
        tag: z.string().optional().describe('Exact tag name filter'),
        method: z.string().optional().describe('HTTP method filter (GET, POST, ...)'),
        path: z.string().optional().describe('Path substring filter'),
      },
    },
    async (args) => {
      try {
        const { backendId, tag, method, path } = args;
        return jsonResult({
          operations: await service.listOperations(backendId, { tag, method, path }),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'search_operations',
    {
      title: 'Search operations',
      description: 'Full-text search across path, method, operationId, summary, description, and tags.',
      inputSchema: {
        backendId: z.string().describe('Registered backend id'),
        query: z.string().describe('Search query'),
      },
    },
    async (args) => {
      try {
        return jsonResult({
          operations: await service.searchOperations(args.backendId, args.query),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_operation',
    {
      title: 'Get operation',
      description:
        'Return one operation with dereferenced parameter/body/response schemas and a request example. ' +
        'Provide operationId and/or method+path.',
      inputSchema: {
        backendId: z.string().describe('Registered backend id'),
        method: z.string().optional().describe('HTTP method'),
        path: z.string().optional().describe('OpenAPI path template'),
        operationId: z.string().optional().describe('OpenAPI operationId'),
      },
    },
    async (args) => {
      try {
        const { backendId, method, path, operationId } = args;
        if (!operationId && !(method && path)) {
          return errorResult(new Error('Provide operationId and/or both method and path.'));
        }
        return jsonResult(await service.getOperation(backendId, { method, path, operationId }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
