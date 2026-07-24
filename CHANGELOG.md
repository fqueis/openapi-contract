# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-07-23

Optional HTTP execution for registered backends, while keeping the default MCP surface read-only.

### Added

- Tool `call_endpoint` (opt-in): execute an OpenAPI operation against a registered backend
- Env `OPENAPI_MCP_ENABLE_CALLS` (`"1"` / `"true"` / `"yes"`): registers `call_endpoint` only when set
- Env `OPENAPI_MCP_CALL_TIMEOUT_MS` (default `30000`): abort timeout for calls
- Env `OPENAPI_MCP_CALL_MAX_BODY_BYTES` (default `102400`): truncates oversized response bodies
- Auth per call via `headers` and/or `headerEnv` (env wins on conflict; nothing stored in the registry)
- URL assembly from registry `baseUrl` + relative/same-origin OpenAPI `servers[0]` + path template / query

### Changed

- Default behavior remains contract inspection only; HTTP execution is off unless enabled
- PR Checks run `pnpm test:coverage` (thresholds from `vitest.config.ts`)
- Docs (README, ARCHITECT, roadmap) updated for opt-in calls and client-agnostic MCP setup

## 1.0.0 - 2026-07-23

### Added

- Initial public release of `@fqueis/openapi-contract`
- Read-only OpenAPI contract MCP tools (`use_backend`, overview, operations, schemas, security)
- On-demand backend registry with dual TTL (spec cache + disk registry)
- npm publish via Trusted Publishing (OIDC) and `npx -y @fqueis/openapi-contract` install path

[1.1.0]: https://github.com/fqueis/openapi-contract/releases/tag/v1.1.0
