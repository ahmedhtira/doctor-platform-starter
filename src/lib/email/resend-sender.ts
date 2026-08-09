import { Resend } from "resend";
import { getResendApiKey } from "./env";
import type { EmailSender, SendEmailResult } from "./send-email";

/**
 * The real Resend client, wired to EmailSender's contract. Deliberately
 * has NO `import "server-only"` — only scripts/process-email-outbox.ts
 * (plain `tsx`, outside Next's bundler) ever imports this file, the exact
 * context where that guard unconditionally throws (same reason
 * scripts/seed-doctor.ts reimplements createServiceRoleClient() instead
 * of importing the guarded service-role.ts). Nothing in src/app or
 * src/components imports this in M7, so there's no accidental-client-bundle
 * risk the guard would actually be protecting against here.
 */
export function createResendSender(): EmailSender {
  const resend = new Resend(getResendApiKey());

  return async (input): Promise<SendEmailResult> => {
    const { data, error } = await resend.emails.send(
      {
        from: input.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      },
      { idempotencyKey: input.idempotencyKey },
    );

    if (error) {
      return { success: false, error: `${error.name}: ${error.message}` };
    }

    return { success: true, id: data.id };
  };
}
