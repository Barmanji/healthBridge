import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Opt-in config for tests that need the local classifier service running.
 *
 * `pnpm test` deliberately uses `vitest.config.ts`, which excludes integration tests so
 * the suite passes on a machine with no Python service. Run this one explicitly:
 *   pnpm vitest run --config vitest.live.config.ts
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["tests/**/*.integration.ts"],
    environment: "node",
    restoreMocks: true,
    testTimeout: 30000,
  },
});
