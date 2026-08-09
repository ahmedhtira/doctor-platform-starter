import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Minimal .env.test.local loader — same shape as scripts/seed-doctor.ts's
// own loader. Needed here specifically (unlike vitest.config.db.ts/
// vitest.config.booking.ts/vitest.config.dashboard.ts) because
// EMAIL_TOKEN_DERIVATION_KEY doesn't reliably reach process.env via
// whatever implicit .env loading those other suites' TEST_SUPABASE_* vars
// benefit from — loading it explicitly here removes the dependency on
// that behavior entirely rather than relying on it working out.
function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
loadEnvFile(path.resolve(__dirname, ".env.test.local"));

// Needs the local Supabase stack running (npm run db:start) — exercises
// the M7 DI-core layer (src/lib/email/*.ts) against real Postgres.
// Includes the React plugin (unlike the other vitest.config.*.ts files)
// because this suite transitively renders the .tsx templates under
// src/emails/v1/ via render-outbox-email.ts.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["tests/email/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Every file in this suite shares one live local Postgres instance,
    // and several tests claim from email_outbox with generous limits
    // (p_limit: 100) that would otherwise sweep up pending rows enqueued
    // by a different, concurrently-running test file — file-level
    // parallelism (Vitest's default) makes that a real race, not a
    // hypothetical one.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
