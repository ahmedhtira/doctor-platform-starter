import { z } from "zod";

// Validates the entire booking Server Action payload — not just the three
// patient fields, but the selection state (doctor/clinic/type/slot) too.
// Never trust client input for either half: a tampered doctorId/clinicId/
// appointmentTypeId/startsAt combination should fail validation here
// before it ever reaches the database, even though book_appointment's own
// checks (is_within_working_window, the composite FKs, the exclusion
// constraint) are the real, authoritative gate.
export const bookingSchema = z.object({
  doctorId: z.uuid(),
  clinicId: z.uuid(),
  appointmentTypeId: z.uuid(),
  /** ISO 8601 instant — must be one of the slots the availability engine returned. */
  startsAt: z.iso.datetime({ offset: true }),
  patientName: z.string().trim().min(2).max(100),
  /** Permissive on format (international patients) but rejects obviously invalid input. */
  patientPhone: z
    .string()
    .trim()
    .min(6)
    .max(20)
    .regex(/^[+]?[\d\s().-]+$/),
  patientEmail: z.string().trim().min(1).max(254).pipe(z.email()),
});

export type BookingInput = z.infer<typeof bookingSchema>;
