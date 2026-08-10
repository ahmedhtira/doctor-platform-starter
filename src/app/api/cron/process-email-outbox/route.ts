import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createResendSender } from "@/lib/email/resend-sender";
import { processEmailOutbox } from "@/lib/email/process-email-outbox";

// M9: the production trigger for the M7 email worker. Mirrors
// scripts/process-email-outbox.ts exactly — same service-role client,
// same real Resend sender, same processEmailOutbox() DI-core, zero
// changes to that already-tested logic. This is a thin invocation
// wrapper, not a reimplementation.
//
// Auth check matches Vercel's own documented cron-security pattern
// verbatim (vercel.com/docs/cron-jobs/manage-cron-jobs, verified live
// while designing this): set CRON_SECRET as a Vercel env var, Vercel
// automatically sends it back as `Authorization: Bearer <secret>` on
// every invocation.
//
// Concurrency/duplicate-invocation safety: Vercel documents cron
// delivery as "best effort" and can occasionally invoke the same
// schedule more than once, or overlap a slow-running invocation with
// the next one. This is deliberately NOT guarded with an additional
// lock here (no Redis, no distributed lock) — the M7 claim/lease design
// processEmailOutbox() already delegates to (pending -> processing via
// `for update skip locked`, claim_token ownership, stale-lease recovery,
// stable per-row Resend idempotency keys) already makes concurrent or
// duplicate calls to this endpoint safe at the database level. See
// PROJECT_SPEC.md's "Launch readiness (M9)" and "Transactional email
// delivery (M7)" sections.
export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const summary = await processEmailOutbox(createServiceRoleClient(), createResendSender());
  return Response.json(summary);
}
