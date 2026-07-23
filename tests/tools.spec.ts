/**
 * Seam under test: MCP tool registration + handlers (agent-facing tools).
 *
 * Covers:
 * 1. Backend lifecycle tools register and renew backends through a real service
 * 2. Contract tools return overview, tags, security, operations, and schemas
 * 3. Tool handlers map service failures into isError results for agents
 * 4. get_operation rejects incomplete lookups before hitting the service
 * 5. get_security accepts global, operationId, or method+path selectors
 *
 * Boundary stub only: recording McpServer captures handlers. HTTP fetch is
 * injected at the network boundary. Service / registry / OpenAPI code run real.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { registerBackendTools } from '@tools/backends.js';
import { registerOperationTools } from '@tools/operations.js';
import { registerOverviewTools } from '@tools/overview.js';
import { errorResult, jsonResult } from '@tools/result.js';
import { registerSchemaTools } from '@tools/schemas.js';
import { registerSecurityTools } from '@tools/security.js';

import { createService } from './helpers/create-service.js';
import { createRecordingMcpServer } from './helpers/recording-mcp-server.js';

describe('MCP tools', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((fn) => fn()));
  });

  it('jsonResult serializes a successful tool payload as indented JSON text', () => {
    expect(jsonResult({ ok: true })).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ ok: true }, null, 2) }],
    });
  });

  it('errorResult maps Error and non-Error values to isError text content', () => {
    expect(errorResult(new Error('boom'))).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'boom' }],
    });
    expect(errorResult('plain')).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'plain' }],
    });
  });

  it('use_backend registers a backend and resolves an OpenAPI path', async () => {
    const { call } = await wireAll();

    const used = await call('use_backend', {
      baseUrl: 'http://localhost:3000',
      id: 'demo',
    });

    expect(parsePayload(used)).toMatchObject({
      resolvedPath: '/docs-yaml',
      backend: { id: 'demo' },
    });
  });

  it('list_backends returns backends still present in the registry', async () => {
    const { call } = await wireAll();
    await call('use_backend', { baseUrl: 'http://localhost:3000', id: 'demo' });

    const listed = await call('list_backends');

    expect(parsePayload(listed).backends).toEqual([expect.objectContaining({ id: 'demo' })]);
  });

  it('refresh_backend returns a freshly resolved OpenAPI path', async () => {
    const { call } = await wireAll();
    await call('use_backend', { baseUrl: 'http://localhost:3000', id: 'demo' });

    const refreshed = await call('refresh_backend', { backendId: 'demo' });

    expect(parsePayload(refreshed)).toMatchObject({
      backendId: 'demo',
      resolvedPath: '/docs-yaml',
    });
  });

  it('forget_backend removes one registered backend id', async () => {
    const { call } = await wireAll();
    await call('use_backend', { baseUrl: 'http://localhost:3000', id: 'demo' });

    const forgotten = await call('forget_backend', { backendId: 'demo' });

    expect(parsePayload(forgotten)).toEqual({ backendId: 'demo', removed: true });
    expect(parsePayload(await call('list_backends')).backends).toEqual([]);
  });

  it('clear_backends removes every registered backend', async () => {
    const { call } = await wireAll();
    await call('use_backend', { baseUrl: 'http://localhost:3000', id: 'x' });

    const cleared = await call('clear_backends');

    expect(parsePayload(cleared)).toEqual({ removed: 1 });
    expect(parsePayload(await call('list_backends')).backends).toEqual([]);
  });

  it('get_api_overview returns the registered API title', async () => {
    const { call } = await wireRegistered();

    const overview = parsePayload<{ info: { title: string } }>(await call('get_api_overview', { backendId: 'demo' }));

    expect(overview.info.title).toBe('Sample API');
  });

  it('list_tags returns declared and operation-discovered tags', async () => {
    const { call } = await wireRegistered();

    const tags = parsePayload<{ tags: Array<{ name: string }> }>(await call('list_tags', { backendId: 'demo' }));

    expect(tags.tags.map((t) => t.name)).toEqual(['auth', 'users']);
  });

  it('get_security returns global schemes when no operation is selected', async () => {
    const { call } = await wireRegistered();

    const security = parsePayload<{ globalSecurity: unknown; operationSecurity?: unknown }>(
      await call('get_security', { backendId: 'demo' }),
    );

    expect(security.globalSecurity).toEqual([{ bearerAuth: [] }]);
    expect(security.operationSecurity).toBeUndefined();
  });

  it('get_security includes operation security when operationId is provided', async () => {
    const { call } = await wireRegistered();

    const security = parsePayload<{ operationSecurity: unknown }>(
      await call('get_security', { backendId: 'demo', operationId: 'login' }),
    );

    expect(security.operationSecurity).toEqual([]);
  });

  it('get_security includes operation security when method and path are provided', async () => {
    const { call } = await wireRegistered();

    const security = parsePayload<{ operation?: { method: string; path: string } }>(
      await call('get_security', {
        backendId: 'demo',
        method: 'GET',
        path: '/v1/users/{id}',
      }),
    );

    expect(security.operation).toEqual({
      method: 'GET',
      path: '/v1/users/{id}',
      operationId: 'getUser',
    });
  });

  it('list_operations filters by tag through the tool', async () => {
    const { call } = await wireRegistered();

    const listed = parsePayload<{ operations: unknown[] }>(
      await call('list_operations', { backendId: 'demo', tag: 'auth' }),
    );

    expect(listed.operations).toEqual([expect.objectContaining({ operationId: 'login' })]);
  });

  it('search_operations finds operations by free text', async () => {
    const { call } = await wireRegistered();

    const searched = parsePayload<{ operations: Array<{ operationId: string }> }>(
      await call('search_operations', { backendId: 'demo', query: 'user' }),
    );

    expect(searched.operations.map((o) => o.operationId)).toContain('getUser');
  });

  it('get_operation returns a request example for method and path', async () => {
    const { call } = await wireRegistered();

    const operation = parsePayload<{ requestExample: { body: unknown } }>(
      await call('get_operation', {
        backendId: 'demo',
        method: 'POST',
        path: '/v1/auth/login',
      }),
    );

    expect(operation.requestExample.body).toEqual({
      email: 'user@example.com',
      password: 'string',
    });
  });

  it('get_schema returns a component schema by name', async () => {
    const { call } = await wireRegistered();

    const schema = parsePayload<{ name: string }>(await call('get_schema', { backendId: 'demo', nameOrRef: 'User' }));

    expect(schema.name).toBe('User');
  });

  it('use_backend returns isError for an invalid baseUrl', async () => {
    const { call } = await wireAll();

    const result = await call('use_backend', { baseUrl: 'localhost:3000' });

    expect(result).toMatchObject({ isError: true });
    expect(errorText(result)).toMatch(/Invalid baseUrl/);
  });

  it('list_backends returns isError when the registry file is corrupt', async () => {
    const { call, registryPath } = await wireAll();
    await writeCorruptRegistry(registryPath);

    const result = await call('list_backends');

    expect(result).toMatchObject({ isError: true });
  });

  it('forget_backend returns isError when the registry file is corrupt', async () => {
    const { call, registryPath } = await wireAll();
    await writeCorruptRegistry(registryPath);

    const result = await call('forget_backend', { backendId: 'demo' });

    expect(result).toMatchObject({ isError: true });
  });

  it('clear_backends returns isError when the registry file is corrupt', async () => {
    const { call, registryPath } = await wireAll();
    await writeCorruptRegistry(registryPath);

    const result = await call('clear_backends');

    expect(result).toMatchObject({ isError: true });
  });

  it('refresh_backend returns isError for an unknown backend id', async () => {
    const { call } = await wireAll();

    const result = await call('refresh_backend', { backendId: 'missing' });

    expect(result).toMatchObject({ isError: true });
    expect(errorText(result)).toMatch(/not registered/);
  });

  it('get_api_overview returns isError for an unknown backend id', async () => {
    const { call } = await wireAll();

    const result = await call('get_api_overview', { backendId: 'missing' });

    expect(result).toMatchObject({ isError: true });
    expect(errorText(result)).toMatch(/use_backend/);
  });

  it('list_tags returns isError for an unknown backend id', async () => {
    const { call } = await wireAll();

    const result = await call('list_tags', { backendId: 'missing' });

    expect(result).toMatchObject({ isError: true });
  });

  it('get_security returns isError for an unknown backend id', async () => {
    const { call } = await wireAll();

    const result = await call('get_security', { backendId: 'missing' });

    expect(result).toMatchObject({ isError: true });
  });

  it('list_operations returns isError for an unknown backend id', async () => {
    const { call } = await wireAll();

    const result = await call('list_operations', { backendId: 'missing' });

    expect(result).toMatchObject({ isError: true });
  });

  it('search_operations returns isError for an unknown backend id', async () => {
    const { call } = await wireAll();

    const result = await call('search_operations', { backendId: 'missing', query: 'x' });

    expect(result).toMatchObject({ isError: true });
  });

  it('get_operation returns isError when the operation does not exist', async () => {
    const { call } = await wireRegistered();

    const result = await call('get_operation', { backendId: 'demo', operationId: 'nope' });

    expect(result).toMatchObject({ isError: true });
  });

  it('get_schema returns isError when the schema name is missing', async () => {
    const { call } = await wireRegistered();

    const result = await call('get_schema', { backendId: 'demo', nameOrRef: 'MissingDto' });

    expect(result).toMatchObject({ isError: true });
    expect(errorText(result)).toMatch(/Schema "MissingDto" not found/);
  });

  it('get_operation requires operationId or both method and path', async () => {
    const { call } = await wireRegistered();

    const result = await call('get_operation', { backendId: 'demo', method: 'GET' });

    expect(result).toMatchObject({
      isError: true,
      content: [{ text: 'Provide operationId and/or both method and path.' }],
    });
  });

  /**
   * Registers every MCP tool family against a real service and recording server.
   *
   * @returns Recording server, registry path, and `call` helper
   */
  async function wireAll() {
    const created = await createService();
    cleanups.push(created.cleanup);
    const recording = createRecordingMcpServer();

    registerBackendTools(recording.server, created.service);
    registerOverviewTools(recording.server, created.service);
    registerSecurityTools(recording.server, created.service);
    registerOperationTools(recording.server, created.service);
    registerSchemaTools(recording.server, created.service);

    return {
      ...recording,
      registryPath: created.service.config.registryPath,
    };
  }

  /**
   * Wires tools and registers the sample `demo` backend once.
   *
   * @returns Recording server already primed with `demo`
   */
  async function wireRegistered() {
    const wired = await wireAll();
    await wired.call('use_backend', { baseUrl: 'http://localhost:3000', id: 'demo' });
    return wired;
  }

  /**
   * Writes invalid JSON to the registry path so the next load fails.
   *
   * @param registryPath - Absolute registry file path
   */
  async function writeCorruptRegistry(registryPath: string) {
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(registryPath, '{not-json');
  }

  /**
   * Parses the JSON text content from a successful MCP tool result.
   *
   * @param result - CallToolResult-shaped payload from a tool handler
   * @returns Parsed JSON body
   */
  function parsePayload<T = Record<string, unknown>>(result: unknown): T {
    const payload = result as { content: Array<{ text: string }> };
    const text = payload.content[0]?.text;
    if (!text) {
      return {} as T;
    }
    return JSON.parse(text) as T;
  }

  /**
   * Reads the agent-facing error text from an isError tool result.
   *
   * @param result - Tool handler result
   * @returns Error text content
   */
  function errorText(result: unknown): string {
    return String((result as { content: Array<{ text: string }> }).content[0]?.text);
  }
});
