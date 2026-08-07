import { defineConfig } from "vitest/config";

// Separate from vitest.config.ts on purpose: these tests hit a real local
// Supabase stack over the network and need `node`, not `jsdom`. Kept out of
// the default `npm run test` — opt in via `npm run test:db` once the local
// stack is running (see README "Local database (M1)").
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
