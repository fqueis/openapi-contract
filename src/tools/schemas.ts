/**
 * Registers the get_schema MCP tool.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { OpenApiContractService } from '@/service.js';
import { errorResult, jsonResult } from '@tools/result.js';

/**
 * Wires schema lookup onto the MCP server.
 *
 * @param server - MCP server instance
 * @param service - Contract application service
 */
export function registerSchemaTools(server: McpServer, service: OpenApiContractService): void {
  server.registerTool(
    'get_schema',
    {
      title: 'Get schema',
      description:
        'Return a dereferenced component schema by name (e.g. CreateUserDto) or local $ref (#/components/schemas/...).',
      inputSchema: {
        backendId: z.string().describe('Registered backend id'),
        nameOrRef: z.string().describe('Schema name or local $ref starting with #/'),
      },
    },
    async (args) => {
      try {
        return jsonResult(await service.getSchema(args.backendId, args.nameOrRef));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
