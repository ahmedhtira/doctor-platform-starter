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

export type PublicBookingConsent = {
  privacyConsent: true;
  adultConfirmation: true;
  privacyPolicyVersion: string;
};

type PublicBookingRpcResult = {
  data: BookedAppointment | null;
  error: { code: string; message: string } | null;
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
 *
 * Public patient bookings pass `publicConsent`. Those go through the
 * service-role-only book_public_appointment wrapper so the appointment and
 * its consent trace are committed atomically. Existing test/staff callers
 * that omit publicConsent keep using the proven book_appointment RPC.
 */
export async function bookAppointment(
  supabase: SupabaseClient<Database>,
  input: BookingInput,
  publicConsent?: PublicBookingConsent,
): Promise<BookAppointmentResult> {
  const { rawToken, tokenHash } = generateManagementToken();
  // Non-null: input.startsAt is already Zod-validated as a well-formed
  // ISO instant (bookingSchema), so DateTime.fromISO can't fail here —
  // .toISO() only returns null for an invalid DateTime.
  const tokenExpiresAt = DateTime.fromISO(input.startsAt).plus({ hours: 24 }).toUTC().toISO()!;

  let data: BookedAppointment | null;
  let error: { code: string; message: string } | null;

  if (publicConsent) {
    // Keep the Supabase client bound as `this`. SupabaseClient.rpc() reads
    // `this.rest`, so extracting the method and calling it unbound crashes
    // at runtime even though the cast itself type-checks.
    const publicBookingRpc = supabase.rpc.bind(supabase) as unknown as (
      fn: "book_public_appointment",
      args: {
        p_doctor_id: string;
        p_clinic_id: string;
        p_appointment_type_id: string;
        p_starts_at: string;
        p_patient_name: string;
        p_patient_phone: string;
        p_patient_email: string;
        p_management_token_hash: string;
        p_management_token_expires_at: string;
        p_privacy_consent: boolean;
        p_adult_confirmation: boolean;
        p_privacy_policy_version: string;
      },
    ) => Promise<PublicBookingRpcResult>;

    ({ data, error } = await publicBookingRpc("book_public_appointment", {
      p_doctor_id: input.doctorId,
      p_clinic_id: input.clinicId,
      p_appointment_type_id: input.appointmentTypeId,
      p_starts_at: input.startsAt,
      p_patient_name: input.patientName,
      p_patient_phone: input.patientPhone,
      p_patient_email: input.patientEmail,
      p_management_token_hash: tokenHash,
      p_management_token_expires_at: tokenExpiresAt,
      p_privacy_consent: publicConsent.privacyConsent,
      p_adult_confirmation: publicConsent.adultConfirmation,
      p_privacy_policy_version: publicConsent.privacyPolicyVersion,
    }));
  } else {
    const result = await supabase.rpc("book_appointment", {
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
    data = result.data;
    error = result.error;
  }

  if (error) {
    throw new BookingError(classifyBookingError(error.code), error.message);
  }

  if (!data) {
    throw new BookingError("UNKNOWN", "Booking did not return an appointment.");
  }

  return { appointment: data, managementToken: rawToken };
}
