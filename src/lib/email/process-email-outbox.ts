import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { emailOutboxPayloadSchema } from "./outbox-payload";
import { deriveEmailManagementToken } from "./derive-management-token";
import { renderOutboxEmail, templateHasManagementLink } from "./render-outbox-email";
import { getAppUrl, getAppointmentEmailFromAddress } from "./env";
import type { EmailSender } from "./send-email";

type EmailOutboxRow = Database["public"]["Functions"]["claim_email_outbox_batch"]["Returns"][number];

export type ProcessEmailOutboxOptions = {
  limit?: number;
  maxAttempts?: number;
  staleAfterMinutes?: number;
};

export type ProcessEmailOutboxSummary = {
  claimed: number;
  sent: number;
  /** Did not end this pass as `sent` — includes rows left `pending` for a
   * future retry, not only ones that just became permanently `failed`. */
  failed: number;
};

const FINALIZE_WRITE_ATTEMPTS = 3;
const FINALIZE_WRITE_BACKOFF_MS = 50;
const LINK_LIFETIME_HOURS = 24;
const IDEMPOTENCY_WINDOW_HOURS = 23;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * DI core of the email worker (PROJECT_SPEC.md's M7 section covers the
 * full design). Takes the supabase client and an EmailSender as
 * parameters — same testability pattern as every other DI-core module in
 * this codebase — so it's callable from Vitest with a locally-built
 * service-role client and a fake sender, without pulling in
 * resend-sender.ts or service-role.ts's `import "server-only"` guards.
 *
 * Claims a batch (pending, or stale processing — lease recovery), then
 * processes each row: expired-link guard -> 23h idempotency-window guard
 * -> derive/mint the management token if the template needs one -> render
 * -> mark first-send-attempt -> send -> finalize.
 */
export async function processEmailOutbox(
  supabase: SupabaseClient<Database>,
  sender: EmailSender,
  options: ProcessEmailOutboxOptions = {},
): Promise<ProcessEmailOutboxSummary> {
  const limit = options.limit ?? 20;
  const maxAttempts = options.maxAttempts ?? 5;
  const staleAfterMinutes = options.staleAfterMinutes ?? 10;

  const claimToken = randomUUID();
  const { data: claimed, error: claimError } = await supabase.rpc("claim_email_outbox_batch", {
    p_limit: limit,
    p_max_attempts: maxAttempts,
    p_claim_token: claimToken,
    p_stale_after_minutes: staleAfterMinutes,
  });

  if (claimError) {
    throw new Error(`Failed to claim email_outbox rows: ${claimError.message}`);
  }

  const summary: ProcessEmailOutboxSummary = { claimed: claimed.length, sent: 0, failed: 0 };

  for (const row of claimed) {
    const outcome = await processRow(supabase, sender, row, maxAttempts);
    if (outcome === "sent") {
      summary.sent += 1;
    } else {
      summary.failed += 1;
    }
  }

  return summary;
}

async function processRow(
  supabase: SupabaseClient<Database>,
  sender: EmailSender,
  row: EmailOutboxRow,
  maxAttempts: number,
): Promise<"sent" | "failed"> {
  const parsedPayload = emailOutboxPayloadSchema.safeParse(row.payload);
  if (!parsedPayload.success) {
    await finalizeTerminalFailure(supabase, row, "email_outbox.payload failed validation");
    return "failed";
  }
  const payload = parsedPayload.data;
  const locale = row.locale ?? "fr";
  const needsLink = templateHasManagementLink(row.template);

  // Expired-link guard — never send a management link that would already
  // be dead on arrival. Unconditional on attempts: time only makes this
  // worse.
  if (needsLink) {
    const linkExpiresAt = DateTime.fromISO(payload.starts_at).plus({ hours: LINK_LIFETIME_HOURS });
    if (linkExpiresAt <= DateTime.now()) {
      await finalizeTerminalFailure(
        supabase,
        row,
        "management link would already be expired by send time",
      );
      return "failed";
    }
  }

  // 23h idempotency-window guard — Resend only remembers an idempotency
  // key for 24h; retrying past that would no longer be protected against
  // a real duplicate send. Unconditional on attempts, same reasoning.
  if (row.first_send_attempt_at) {
    const windowEnd = DateTime.fromISO(row.first_send_attempt_at).plus({
      hours: IDEMPOTENCY_WINDOW_HOURS,
    });
    if (DateTime.now() >= windowEnd) {
      await finalizeTerminalFailure(supabase, row, "provider idempotency retry window expired");
      return "failed";
    }
  }

  let managementLink: string | null = null;
  if (needsLink) {
    const { rawToken, tokenHash } = deriveEmailManagementToken(row.id);
    // Non-null: payload.starts_at is already Zod-validated as a
    // well-formed ISO instant, so .toISO() can't return null here.
    const expiresAt = DateTime.fromISO(payload.starts_at)
      .plus({ hours: LINK_LIFETIME_HOURS })
      .toUTC()
      .toISO()!;

    const { error: tokenError } = await supabase.rpc("create_management_token", {
      p_appointment_id: payload.appointment_id,
      p_token_hash: tokenHash,
      p_expires_at: expiresAt,
      p_email_outbox_id: row.id,
    });
    if (tokenError) {
      await finalizeRetryableFailure(
        supabase,
        row,
        `failed to mint management token: ${tokenError.message}`,
        maxAttempts,
      );
      return "failed";
    }

    managementLink = `${getAppUrl()}/${locale}/manage#token=${rawToken}`;
  }

  const rendered = await renderOutboxEmail({
    template: row.template,
    templateVersion: row.template_version,
    payload,
    locale,
    managementLink,
  });

  // Set exactly once, immediately before the first real provider send —
  // never touched again after that (a no-op on every later attempt, via
  // the `is("first_send_attempt_at", null)` guard below).
  await markFirstSendAttempt(supabase, row);

  const result = await sender({
    to: row.to_email,
    from: getAppointmentEmailFromAddress(),
    replyTo: "support@dewini.net",
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    // Stable per outbox event, no attempt suffix — safe because the
    // token/payload/rendering are all deterministic for this row, so the
    // body is byte-identical on every attempt.
    idempotencyKey: `doctor-platform-email/${row.id}`,
  });

  if (result.success) {
    await finalizeSent(supabase, row);
    return "sent";
  }

  await finalizeRetryableFailure(supabase, row, result.error, maxAttempts);
  return "failed";
}

async function markFirstSendAttempt(supabase: SupabaseClient<Database>, row: EmailOutboxRow): Promise<void> {
  if (row.first_send_attempt_at) return;
  await supabase
    .from("email_outbox")
    .update({ first_send_attempt_at: new Date().toISOString() })
    .eq("id", row.id)
    // Non-null: every row returned by claim_email_outbox_batch has just
    // had claim_token set by that same call.
    .eq("claim_token", row.claim_token!)
    .is("first_send_attempt_at", null);
}

/**
 * A transient local DB-write failure right after a successful send is the
 * one sub-case that doesn't need the claim/idempotency machinery at all —
 * `status='sent'` is naturally idempotent to re-apply, so a short
 * in-process retry here closes it without falling through to a whole new
 * claim (which would risk a second, harmless-but-avoidable provider call).
 */
async function finalizeSent(supabase: SupabaseClient<Database>, row: EmailOutboxRow): Promise<void> {
  const sentAt = new Date().toISOString();
  for (let attempt = 1; attempt <= FINALIZE_WRITE_ATTEMPTS; attempt++) {
    const { error } = await supabase
      .from("email_outbox")
      .update({ status: "sent", sent_at: sentAt })
      .eq("id", row.id)
      .eq("claim_token", row.claim_token!);
    if (!error) return;
    if (attempt < FINALIZE_WRITE_ATTEMPTS) {
      await sleep(FINALIZE_WRITE_BACKOFF_MS * attempt);
    }
  }
  // All local retries failed — the send already succeeded, so we do not
  // attempt it again here. The row stays `processing` until lease
  // recovery reclaims it; a future claim will find first_send_attempt_at
  // already set and reuse the same idempotency key, so no duplicate send
  // results even then.
}

/** Guards that are unconditional on attempts (expired link, idempotency window). */
async function finalizeTerminalFailure(
  supabase: SupabaseClient<Database>,
  row: EmailOutboxRow,
  lastError: string,
): Promise<void> {
  await supabase
    .from("email_outbox")
    .update({ status: "failed", last_error: lastError })
    .eq("id", row.id)
    .eq("claim_token", row.claim_token!);
}

/** Send/token-mint failures — retryable until maxAttempts. */
async function finalizeRetryableFailure(
  supabase: SupabaseClient<Database>,
  row: EmailOutboxRow,
  lastError: string,
  maxAttempts: number,
): Promise<void> {
  const status = row.attempts >= maxAttempts ? "failed" : "pending";
  await supabase
    .from("email_outbox")
    .update({ status, last_error: lastError })
    .eq("id", row.id)
    .eq("claim_token", row.claim_token!);
}
