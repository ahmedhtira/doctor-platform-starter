import path from "node:path";
import { defineConfig } from "vitest/config";

// Needs the local Supabase stack running and seeded, same as
// vitest.config.db.ts/vitest.config.booking.ts — exercises the M6 DI-core
// layer (src/lib/dashboard/*.ts) against real Postgres.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/dashboard/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
