import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { BookingInput } from "./booking-schema";
import { generateManagementToken } from "./generate-management-token";
import { BookingError, classifyBookingError } from "./booking-errors";

export type BookedAppointment = Database["public"]["Functions"]["book_appointment"]["Returns"];

export type BookAppointmentResult = {
  appointment: BookedAppointment;
  /**
   * Raw management token — exists only transiently, in this return value
   * and whatever the caller does with it (the confirmation UI). Never
   * written to Postgres; only its hash is. Do not log this value or pass
   * it anywhere it could be persisted.
   */
  managementToken: string;
};

/**
 * DI core of the booking write path: takes the Supabase client as a
 * parameter (same testability pattern as the M3 availability engine's
 * fetch-availability-data.ts) rather than constructing its own, so it's
 * callable from Vitest with a locally-built service-role client without
 * pulling in service-role.ts's `import "server-only"` guard.
 *
 * Token expiry policy: appointment starts_at + 24 hours (PROJECT_SPEC.md
 * "Booking flow (M4)"). Delivering this token by email is explicitly out
 * of scope here — see that section for why.
 */
export async function bookAppointment(
  supabase: SupabaseClient<Database>,
  input: BookingInput,
): Promise<BookAppointmentResult> {
  const { rawToken, tokenHash } = generateManagementToken();
  // Non-null: input.startsAt is already Zod-validated as a well-formed
  // ISO instant (bookingSchema), so DateTime.fromISO can't fail here —
  // .toISO() only returns null for an invalid DateTime.
  const tokenExpiresAt = DateTime.fromISO(input.startsAt).plus({ hours: 24 }).toUTC().toISO()!;

  const { data, error } = await supabase.rpc("book_appointment", {
    p_doctor_id: input.doctorId,
    p_clinic_id: input.clinicId,
    p_appointment_type_id: input.appointmentTypeId,
    p_starts_at: input.startsAt,
    p_patient_name: input.patientName,
    p_patient_phone: input.patientPhone,
    p_patient_email: input.patientEmail,
    p_management_token_hash: tokenHash,
    p_management_token_expires_at: tokenExpiresAt,
  });

  if (error) {
    throw new BookingError(classifyBookingError(error.code), error.message);
  }

  return { appointment: data, managementToken: rawToken };
}
