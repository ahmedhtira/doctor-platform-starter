export type SendEmailInput = {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  /**
   * One stable value per email_outbox event (`doctor-platform-email/<id>`,
   * no attempt suffix) — every retry of the same row passes the same
   * key with the same body, which is what makes Resend's idempotency
   * guarantee apply across retries instead of 409ing on a mismatch. See
   * PROJECT_SPEC.md's M7 section.
   */
  idempotencyKey: string;
};

export type SendEmailResult =
  | { success: true; id: string }
  | { success: false; error: string };

/**
 * Contract only — src/lib/email/resend-sender.ts is the real
 * implementation (only ever constructed by scripts/process-email-outbox.ts);
 * tests inject a fake implementation. Keeping the interface here (not
 * co-located with either implementation) is what lets
 * process-email-outbox.ts depend on the shape without depending on
 * either concrete sender.
 */
export type EmailSender = (input: SendEmailInput) => Promise<SendEmailResult>;
