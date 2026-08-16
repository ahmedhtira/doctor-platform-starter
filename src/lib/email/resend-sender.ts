import { Resend } from "resend";
import { getResendApiKey } from "./env";
import type { EmailSender, SendEmailResult } from "./send-email";

/**
 * The real Resend client, wired to EmailSender's contract. Deliberately
 * has NO `import "server-only"`. Two call sites, as of M9:
 * scripts/process-email-outbox.ts (plain `tsx`, outside Next's bundler —
 * the guard unconditionally throws there, same reason
 * scripts/seed-doctor.ts reimplements createServiceRoleClient() instead
 * of importing the guarded service-role.ts) and
 * src/app/api/cron/process-email-outbox/route.ts (a Route Handler, which
 * never bundles into client code regardless of the guard — Next.js's own
 * architecture already prevents that). Neither needs the guard; nothing
 * in src/components imports this file.
 */
export function createResendSender(): EmailSender {
  const resend = new Resend(getResendApiKey());

  return async (input): Promise<SendEmailResult> => {
    const { data, error } = await resend.emails.send(
      {
        from: input.from,
        replyTo: input.replyTo,
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
