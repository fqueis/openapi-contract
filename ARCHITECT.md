# Architecture

This document describes the communication flow between an MCP client and OpenAPI-capable backends when using `openapi-contract`.

## Overview

`openapi-contract` is a **native MCP server** built with [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk). There is no child process or NDJSON proxy; the MCP protocol is handled directly over stdio.

This release is **read-only**: the server fetches, caches, and queries OpenAPI documents so agents can build against the real API shape. It does **not** execute HTTP calls against API operations.

| Responsibility                        | Where                                                                                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Env → TTLs / registry path            | [`src/config.ts`](src/config.ts)                                                                                                                           |
| Boot + tool registration + stdio      | [`src/index.ts`](src/index.ts)                                                                                                                             |
| Thin MCP tool adapters (Zod)          | [`src/tools/*`](src/tools)                                                                                                                                 |
| Orchestration façade                  | [`src/service.ts`](src/service.ts)                                                                                                                         |
| Disk backend registry (metadata only) | [`src/registry.ts`](src/registry.ts)                                                                                                                       |
| In-memory OpenAPI cache               | [`src/openapi/cache.ts`](src/openapi/cache.ts)                                                                                                             |
| Spec fetch / discovery / parse        | [`src/openapi/fetch.ts`](src/openapi/fetch.ts)                                                                                                             |
| Index, deref, request examples        | [`src/openapi/index-ops.ts`](src/openapi/index-ops.ts), [`src/openapi/deref.ts`](src/openapi/deref.ts), [`src/openapi/example.ts`](src/openapi/example.ts) |

---

## Component layout

```mermaid
flowchart TB
  Client[Cursor MCP client]
  Stdio[Stdio transport]
  Index[Entrypoint and bootstrap]
  Tools[MCP tool adapters]
  Service[Contract orchestration service]
  Registry[Backend registry]
  Cache[In-memory OpenAPI cache]
  Fetch[Spec discovery and fetch]
  OpenAPI[Index deref and examples]
  Disk[(On-disk registry store)]
  Backend[(Backend OpenAPI endpoint)]

  Client --> Stdio --> Index --> Tools --> Service
  Service --> Registry --> Disk
  Service --> Cache
  Service --> Fetch --> Backend
  Service --> OpenAPI
  Fetch --> Cache
```

---

## Communication flow

Typical agent path: register a backend, then inspect a single operation (with cache hit/miss).

```mermaid
sequenceDiagram
  participant C as MCP client
  participant T as Tool adapters
  participant S as Contract service
  participant R as Backend registry
  participant Cache as Spec cache
  participant F as Spec fetcher
  participant B as OpenAPI backend

  Note over C,B: Boot: load config, create service, register tools, connect stdio

  C->>T: use_backend baseUrl id? specPath?
  T->>S: register or renew backend
  S->>R: persist and renew lastUsedAt
  S->>Cache: invalidate backend
  S->>F: fetch forced
  F->>B: GET candidates and fallbacks
  B-->>F: OpenAPI JSON or YAML
  F-->>S: document plus resolvedUrl
  S->>Cache: store document
  S-->>T: backend plus resolvedUrl
  T-->>C: JSON result

  C->>T: get_operation backendId method path or operationId
  T->>S: resolve operation
  S->>Cache: lookup backend
  alt cache miss
    S->>R: require registered backend
    S->>F: fetch
    F->>B: GET OpenAPI
    S->>Cache: store document
  end
  S->>S: index find deref and build example
  S-->>T: enriched operation
  T-->>C: JSON result
```

API HTTP **execution** (calling an operation against the live backend) is out of scope. The server only reads the contract.

---

## Key design decisions

### 1. Native MCP server

The server uses `@modelcontextprotocol/sdk`'s `McpServer` with `StdioServerTransport`. There is no child process or NDJSON proxy. Errors go to stderr; stdout is reserved for MCP framing.

### 2. Read-only (contract inspection only)

Tools fetch, parse, index, dereference, and summarize OpenAPI documents. They do not invoke API endpoints on the registered backend. That keeps the surface safe and focused on shape discovery for frontend/mobile agents.

### 3. On-demand backends

There is no env list of backends. Agents call `use_backend` with a `baseUrl` (and optional `id` / `specPath`). The registry persists metadata on disk and renews `lastUsedAt` on each successful use.

### 4. Dual TTL

- **Spec cache** (in-memory, default 60s via `OPENAPI_MCP_CACHE_TTL_MS`): holds the OpenAPI document; invalidated on `use` / `refresh` / `forget`.
- **Backend registry** (on disk, default 1 day via `OPENAPI_MCP_REGISTRY_TTL_MS`): stores `{ id, baseUrl, specPath?, lastUsedAt }` only; expired entries are pruned on load.

OpenAPI documents are never written to the registry file.

### 5. Thin tools, fat service

Tool modules under `src/tools/` validate inputs with Zod and wrap results as JSON text / `isError`. `OpenApiContractService` owns orchestration across registry, cache, fetch, index, deref, and examples.

### 6. Spec discovery

Default path is `/docs-json` (Nest Swagger). Ordered fallbacks: `/docs-yaml` → `/openapi.json` → `/v3/api-docs`. Absolute document URLs are accepted and split into origin + `specPath`.

### 7. Local `$ref` dereference only

`deref` resolves local `#/` references. Cycles are annotated with `x-circular-ref`; external refs become `x-unresolved-ref` and are not fetched.

### 8. Agent-friendly errors

If a tool needs a backend that is missing or expired, the service returns a clear message telling the agent to call `use_backend` first (and similarly for missing operations).

### 9. Injectable seams for tests

`fetch` and clock/`now` dependencies can be injected so unit tests exercise registry TTL, cache behavior, and fetch discovery without a live network.
