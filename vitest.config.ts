/**
 * Vitest config: path aliases, unit specs under `tests/`, and v8 coverage.
 *
 * Coverage reporters: `text`, `lcov`, `html` via `pnpm test:coverage`. Entrypoint
 * and MCP tool wiring are excluded (thin wrappers; covered indirectly via the
 * service seam). Thresholds gate regression at the current suite floor.
 *
 * @example
 * ```bash
 * pnpm test
 * pnpm test:coverage
 * ```
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.join(root, 'src'),
      '@openapi': path.join(root, 'src/openapi'),
      '@tools': path.join(root, 'src/tools'),
    },
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,js}'],
      exclude: ['src/**/*.d.ts', 'src/index.ts', 'src/openapi/types.ts'],
      thresholds: {
        statements: 90,
        lines: 90,
        branches: 80,
        functions: 90,
      },
    },
  },
});
