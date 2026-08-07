import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Minimal .env.test.local loader — deliberately dependency-free. Populate
// this file from `npx supabase status` after `npm run db:start`; it's
// gitignored (.gitignore already excludes all `.env*` except `.env.example`).
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

loadEnvFile(path.resolve(process.cwd(), ".env.test.local"));

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Run "npm run db:start", then populate .env.test.local from "npx supabase status".`,
    );
  }
  return value;
}

export function getTestSupabaseUrl(): string {
  return requireEnv("TEST_SUPABASE_URL");
}

export function getTestSupabaseAnonKey(): string {
  return requireEnv("TEST_SUPABASE_ANON_KEY");
}

export function getTestSupabaseServiceRoleKey(): string {
  return requireEnv("TEST_SUPABASE_SERVICE_ROLE_KEY");
}
