import path from "node:path";
import { defineConfig } from "vitest/config";

// Needs the local Supabase stack running and seeded, same as
// vitest.config.dashboard.ts — exercises the M10 DI-core layer
// (src/lib/admin/*.ts) against real Postgres.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/admin/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
