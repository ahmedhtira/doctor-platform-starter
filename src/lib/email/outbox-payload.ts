import { z } from "zod";

/**
 * The snapshot book_appointment/cancel_appointment/reschedule_appointment
 * write into email_outbox.payload at enqueue time (PROJECT_SPEC.md's M7
 * section) — display data only, never a raw token. Validated on read
 * (jsonb has no compile-time shape) rather than trusted blindly, same
 * boundary-validation discipline as every Server Action input elsewhere
 * in this codebase.
 */
export const emailOutboxPayloadSchema = z.object({
  appointment_id: z.uuid(),
  doctor_name: z.string(),
  clinic_name: z.string(),
  clinic_address: z.string(),
  clinic_timezone: z.string(),
  appointment_type_name: z.string(),
  patient_name: z.string(),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
});

export type EmailOutboxPayload = z.infer<typeof emailOutboxPayloadSchema>;
