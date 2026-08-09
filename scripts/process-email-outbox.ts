import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "../src/lib/supabase/env";
import { createResendSender } from "../src/lib/email/resend-sender";
import { processEmailOutbox } from "../src/lib/email/process-email-outbox";
import type { Database } from "../src/lib/supabase/database.types";

// Not importing service-role.ts directly: it starts with `import
// "server-only"`, which unconditionally throws outside Next's bundler —
// same reason scripts/seed-doctor.ts reimplements this instead of
// importing it. resend-sender.ts has no such guard (see that file for
// why), so it's imported directly — this is the one place in M7 that
// touches the real Resend API.
function createServiceRoleClient() {
  return createSupabaseClient<Database>(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Minimal .env.local loader — this script runs via `tsx`, outside Next.js,
// so nothing loads .env.local for us automatically.
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

loadEnvFile(path.resolve(process.cwd(), ".env.local"));

async function main() {
  const supabase = createServiceRoleClient();
  const sender = createResendSender();

  const summary = await processEmailOutbox(supabase, sender);

  console.log(
    `Processed ${summary.claimed} email_outbox row(s): ${summary.sent} sent, ${summary.failed} not sent this pass.`,
  );
}

// process.exitCode (not process.exit()) lets Node drain pending handles
// naturally — same reasoning as scripts/seed-doctor.ts.
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
