import { randomUUID } from "node:crypto";
import {
  getNotificationEmailFromAddress,
  getNoReplyEmailFromAddress,
} from "./env";
import { renderAccountEmail, type AccountEmailTemplate } from "./render-account-email";
import type { EmailSender, SendEmailResult } from "./send-email";

export type SendAccountEmailInput = {
  template: AccountEmailTemplate;
  locale: string;
  to: string;
  /**
   * The raw Supabase action link — a bearer credential. Lives only as a
   * function argument for the duration of this one call; the caller must
   * never write it to a table or a log line. See PROJECT_SPEC.md's M10
   * section.
   */
  actionLink: string;
};

/**
 * DI-core: takes the EmailSender as a parameter (same pattern as
 * process-email-outbox.ts) so it's testable with a fake sender. Unlike
 * appointment mail, this is never enqueued/retried from a stored row —
 * the caller (provision-doctor.ts / the forgot-password action) awaits
 * this directly, in the same request that generated the link, and
 * treats a failure as a failure of that request (see each caller's own
 * rollback/non-enumeration handling).
 */
export async function sendAccountEmail(
  sender: EmailSender,
  input: SendAccountEmailInput,
): Promise<SendEmailResult> {
  const rendered = await renderAccountEmail({
    template: input.template,
    locale: input.locale,
    actionLink: input.actionLink,
  });

  return sender({
    to: input.to,
    from:
      input.template === "password_reset"
        ? getNoReplyEmailFromAddress()
        : getNotificationEmailFromAddress(),
    replyTo:
      input.template === "password_reset"
        ? undefined
        : "support@dewini.net",
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey: `doctor-platform-account/${randomUUID()}`,
});
}
