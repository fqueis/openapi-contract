# OpenAPI Contract MCP

MCP server that reads **OpenAPI contracts** from local (or remote) backends so agents can build frontends and mobile apps against the real API shape. This release is **read-only**: it inspects the OpenAPI document and never executes HTTP calls against your API. Backends are registered on demand; there is no env list of backends.

[![PR Checks](https://github.com/fqueis/openapi-contract/actions/workflows/pr-checks.yml/badge.svg)](https://github.com/fqueis/openapi-contract/actions/workflows/pr-checks.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE.md)

---

## What it does

Most LLMs build against APIs by guessing: inventing paths, request bodies, and response fields that may not match the backend. OpenAPI Contract MCP gives the agent a **structured interface** to the real OpenAPI document before any UI or client code is written.

Built with [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk), it provides:

- **On-demand backend registration**: call `use_backend` with a `baseUrl`; nothing sensitive needs to live in a static backend list
- **Contract browsing**: overview, tags, operations, security schemes, and component schemas from the live spec
- **Dereferenced operations**: `get_operation` returns local `$ref` resolution plus a request example when possible
- **Read-only**: the server never executes API calls; it only reads and explains the OpenAPI shape

---

## Requirements

- Node.js >= 18
- [pnpm](https://pnpm.io/)
- A backend that exposes OpenAPI (Nest Swagger: `/docs-json`, etc.)

---

## Setup

```bash
cd /path/to/openapi-contract
pnpm install
pnpm build
pnpm test
```

---

## Usage in Cursor (`mcp.json`)

Add to your Cursor MCP config (`~/.cursor/mcp.json` or Cursor Settings → MCP).

**Recommended (built JS):**

```json
{
  "mcpServers": {
    "openapi-contract": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/openapi-contract/dist/index.js"]
    }
  }
}
```

**Dev (TypeScript via tsx):**

```json
{
  "mcpServers": {
    "openapi-contract": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "/path/to/openapi-contract/src/index.ts"]
    }
  }
}
```

---

## Typical agent flow

1. `use_backend` with `baseUrl` (e.g. `http://localhost:3000`) and optional `id` / `specPath`
2. `get_api_overview` / `list_tags` / `list_operations` / `search_operations`
3. `get_operation` for dereferenced schemas + request example
4. `get_schema` / `get_security` as needed
5. `forget_backend` or `clear_backends` to drop the on-disk registry; `refresh_backend` to refetch OpenAPI

If `baseUrl` is missing, tools return a clear error so the agent can ask you in the chat.

---

## Tools

| Tool                | Purpose                                                    |
| ------------------- | ---------------------------------------------------------- |
| `use_backend`       | Register/renew backend (disk, 1-day TTL) and fetch OpenAPI |
| `list_backends`     | List non-expired backends                                  |
| `forget_backend`    | Remove one backend                                         |
| `clear_backends`    | Clear registry                                             |
| `refresh_backend`   | Refetch OpenAPI (bypass 60s cache)                         |
| `get_api_overview`  | Info, servers, counts, global security                     |
| `list_tags`         | Tags                                                       |
| `get_security`      | Schemes + requirements (optional per operation)            |
| `list_operations`   | Filter by tag/method/path                                  |
| `search_operations` | Free-text search                                           |
| `get_operation`     | Full operation (dereferenced + example)                    |
| `get_schema`        | Component schema by name or `$ref`                         |

---

## Spec discovery

Default path: `/docs-json`. Fallbacks: `/docs-yaml` → `/openapi.json` → `/v3/api-docs`. Absolute document URLs are accepted.

---

## Optional env

| Variable                      | Default                                             | Meaning                              |
| ----------------------------- | --------------------------------------------------- | ------------------------------------ |
| `OPENAPI_MCP_CACHE_TTL_MS`    | `60000`                                             | In-memory OpenAPI document TTL       |
| `OPENAPI_MCP_REGISTRY_TTL_MS` | `86400000`                                          | On-disk backend registry TTL (1 day) |
| `OPENAPI_MCP_REGISTRY_PATH`   | `%USERPROFILE%\.openapi-contract-mcp\backends.json` | Registry file path                   |

---

## Architecture

For the communication flow between the MCP client, the service layer, the registry/cache, and the OpenAPI backend (including Mermaid diagrams), see [ARCHITECT.md](ARCHITECT.md).

---

## License

MIT © [fqueis](https://github.com/fqueis). See [LICENSE.md](LICENSE.md).
