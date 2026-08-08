import path from "node:path";
import { defineConfig } from "vitest/config";

// tests/booking/booking-schema.test.ts is pure Zod validation (no I/O).
// tests/booking/book-appointment-flow.test.ts needs the local Supabase
// stack running and seeded, same as vitest.config.db.ts /
// vitest.config.availability.ts.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/booking/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
