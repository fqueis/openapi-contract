/**
 * Registers overview and tags MCP tools.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { OpenApiContractService } from '@/service.js';
import { errorResult, jsonResult } from '@tools/result.js';

/**
 * Wires API overview and tag tools onto the MCP server.
 *
 * @param server - MCP server instance
 * @param service - Contract application service
 */
export function registerOverviewTools(server: McpServer, service: OpenApiContractService): void {
  server.registerTool(
    'get_api_overview',
    {
      title: 'API overview',
      description: 'Return OpenAPI info, servers, operation/schema counts, and global security for a backend.',
      inputSchema: {
        backendId: z.string().describe('Registered backend id'),
      },
    },
    async (args) => {
      try {
        return jsonResult(await service.getApiOverview(args.backendId));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'list_tags',
    {
      title: 'List tags',
      description: 'List OpenAPI tags (declared and discovered on operations) for a backend.',
      inputSchema: {
        backendId: z.string().describe('Registered backend id'),
      },
    },
    async (args) => {
      try {
        return jsonResult({ tags: await service.listTags(args.backendId) });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
