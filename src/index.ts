#!/usr/bin/env node
/**
 * OpenAPI Contract MCP entrypoint (stdio transport).
 *
 * Starts an MCP server that exposes OpenAPI contract tools for agents building
 * frontends and mobile apps. Backends are registered on demand via use_backend.
 * HTTP execution (`call_endpoint`) is registered only when
 * OPENAPI_MCP_ENABLE_CALLS is truthy.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig } from '@/config.js';
import { OpenApiContractService } from '@/service.js';
import { registerBackendTools } from '@tools/backends.js';
import { registerCallToolsIfEnabled } from '@tools/call.js';
import { registerOperationTools } from '@tools/operations.js';
import { registerOverviewTools } from '@tools/overview.js';
import { registerSchemaTools } from '@tools/schemas.js';
import { registerSecurityTools } from '@tools/security.js';

/**
 * Boots the MCP server on stdio.
 *
 * @returns Resolves when the transport is connected
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const service = new OpenApiContractService(config);

  const server = new McpServer({
    name: 'openapi-contract',
    version: '1.0.0',
  });

  registerBackendTools(server, service);
  registerOverviewTools(server, service);
  registerSecurityTools(server, service);
  registerOperationTools(server, service);
  registerSchemaTools(server, service);
  registerCallToolsIfEnabled(server, service, config.enableCalls);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  // stderr only: stdout is reserved for MCP stdio framing.
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
