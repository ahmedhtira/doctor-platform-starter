import { createHmac } from "node:crypto";
import { hashSecret } from "@/lib/booking/crypto-secret";
import { getEmailTokenDerivationKey } from "./env";

/**
 * Domain-separated, versioned prefix — part of the HMAC input, not a
 * secret itself. Bumping this would change every derived token, so it's
 * versioned the same way template rendering is (template_version):
 * changing it is a "v2" decision, not an in-place edit.
 */
const DOMAIN = "doctor-platform/email-management-token/v1/";

export type DerivedManagementToken = {
  rawToken: string;
  tokenHash: string;
};

/**
 * Deterministic, re-derivable counterpart to
 * src/lib/booking/generate-management-token.ts's random one-off tokens —
 * used only for the email-delivery path (src/lib/email/process-email-outbox.ts),
 * never for the on-screen tokens book_appointment/reschedule_appointment
 * mint directly. Deliberately a separate function rather than a shared
 * one with a mode flag: the two have genuinely different reuse semantics
 * (random + single-use vs. deterministic + re-derivable-by-design), and
 * conflating them is exactly the kind of mistake that would undermine
 * both.
 *
 * Given the same `emailOutboxId`, this always returns the identical raw
 * token — on the same process, on a different process after a crash,
 * whenever — because it's a pure function of durable data (the outbox
 * row's own immutable id) and a secret held in server config
 * (EMAIL_TOKEN_DERIVATION_KEY), never of anything that would need to be
 * persisted for the guarantee to hold. See PROJECT_SPEC.md's M7 section
 * for why that's the property that makes retries safe to make idempotent
 * with Resend.
 *
 * Output is 64 lowercase hex characters — the exact shape
 * managementTokenPattern already validates, so /manage,
 * redeem_management_token, and manage-gate.tsx need no changes to accept
 * a token minted this way instead of randomly.
 */
export function deriveEmailManagementToken(emailOutboxId: string): DerivedManagementToken {
  const key = getEmailTokenDerivationKey();
  const rawToken = createHmac("sha256", key).update(DOMAIN + emailOutboxId).digest("hex");
  return { rawToken, tokenHash: hashSecret(rawToken) };
}
