import path from "node:path";
import { defineConfig } from "vitest/config";

// tests/availability/slot-generation.test.ts is pure logic (no I/O, no
// local Supabase needed). tests/availability/sql-consistency.test.ts does
// need the local stack running and seeded, same as vitest.config.db.ts —
// kept in this shared config rather than duplicating one for each, since
// npm scripts target the individual files directly (see package.json
// test:availability / test:availability:consistency).
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/availability/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
