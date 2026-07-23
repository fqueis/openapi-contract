/**
 * Registers backend lifecycle MCP tools: use, list, forget, clear, refresh.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { OpenApiContractService } from '@/service.js';
import { errorResult, jsonResult } from '@tools/result.js';

/**
 * Wires backend registry tools onto the MCP server.
 *
 * @param server - MCP server instance
 * @param service - Contract application service
 */
export function registerBackendTools(server: McpServer, service: OpenApiContractService): void {
  server.registerTool(
    'use_backend',
    {
      title: 'Use backend',
      description:
        'Register or renew a backend by baseUrl (e.g. http://localhost:3000). ' +
        'Persists to disk with a 1-day TTL and fetches OpenAPI (/docs-json with fallbacks). ' +
        'Call this before contract tools when the registry is empty.',
      inputSchema: {
        baseUrl: z.string().describe('Absolute backend origin or full OpenAPI URL'),
        id: z.string().optional().describe('Optional stable backend id (defaults from host/port)'),
        specPath: z.string().optional().describe('Optional relative OpenAPI path (default /docs-json)'),
      },
    },
    async (args) => {
      try {
        const result = await service.useBackend(args);
        return jsonResult({
          backend: result.backend,
          resolvedUrl: result.resolvedUrl,
          resolvedPath: result.resolvedPath,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'list_backends',
    {
      title: 'List backends',
      description: 'List backends still present in the on-disk registry (not expired).',
      inputSchema: {},
    },
    async () => {
      try {
        const backends = await service.listBackends();
        return jsonResult({ backends });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'forget_backend',
    {
      title: 'Forget backend',
      description: 'Remove one backend id from the on-disk registry and drop its OpenAPI cache.',
      inputSchema: {
        backendId: z.string().describe('Backend id to remove'),
      },
    },
    async (args) => {
      try {
        const removed = await service.forgetBackend(args.backendId);
        return jsonResult({ backendId: args.backendId, removed });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'clear_backends',
    {
      title: 'Clear backends',
      description: 'Delete every backend from the on-disk registry and clear the OpenAPI cache.',
      inputSchema: {},
    },
    async () => {
      try {
        const removed = await service.clearBackends();
        return jsonResult({ removed });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'refresh_backend',
    {
      title: 'Refresh backend OpenAPI',
      description: 'Invalidate the in-memory OpenAPI cache for a backend and fetch the document again.',
      inputSchema: {
        backendId: z.string().describe('Registered backend id'),
      },
    },
    async (args) => {
      try {
        const result = await service.refreshBackend(args.backendId);
        return jsonResult({ backendId: args.backendId, ...result });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
