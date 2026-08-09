import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type ManagedAppointmentView = {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
  patientName: string;
  patientPhone: string;
  patientEmail: string | null;
  doctorId: string;
  doctorName: string;
  clinicId: string;
  clinicName: string;
  clinicAddress: string;
  clinicTimezone: string;
  appointmentTypeId: string;
  appointmentTypeName: string;
  appointmentDurationMinutes: number;
};

/**
 * The single point every /manage Server Action resolves a session through.
 * Takes a pre-hashed session secret (managementSessionSecretHash) — hashing
 * happens once, in the Server Action right after reading the raw secret out
 * of the cookie (see manage-session-cookie.ts) — never the raw secret
 * itself.
 *
 * Two direct service-role reads rather than a new SQL function, mirroring
 * fetch-availability-data.ts's existing precedent: appointment_management_sessions
 * and appointments have no anon/authenticated grant at all, so a
 * service-role client bypassing RLS is exactly the access level
 * public.compute_available_slots/book_appointment already assume.
 *
 * Doubles as the freshness check every write path needs before it can call
 * its RPC — cancel/reschedule/slot-fetch all need the resolved appointment
 * id first, so calling this isn't duplicated authorization, it's how that
 * id gets resolved. The RPCs' own inline `expires_at > now()` check remains
 * the actual authority.
 */
export async function getManagedAppointment(
  supabase: SupabaseClient<Database>,
  managementSessionSecretHash: string,
): Promise<ManagedAppointmentView | null> {
  const { data: session, error: sessionError } = await supabase
    .from("appointment_management_sessions")
    .select("appointment_id, expires_at")
    .eq("session_secret_hash", managementSessionSecretHash)
    .maybeSingle();

  if (sessionError) {
    throw new Error(`Failed to resolve management session: ${sessionError.message}`);
  }

  if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
    return null;
  }

  const { data: appointment, error: appointmentError } = await supabase
    .from("appointments")
    .select(
      "id, status, starts_at, ends_at, patient_name, patient_phone, patient_email, doctor_id, clinic_id, appointment_type_id",
    )
    .eq("id", session.appointment_id)
    .maybeSingle();

  if (appointmentError) {
    throw new Error(`Failed to load managed appointment: ${appointmentError.message}`);
  }

  if (!appointment) {
    return null;
  }

  const [doctorResult, clinicResult, appointmentTypeResult] = await Promise.all([
    supabase.from("doctors").select("full_name").eq("id", appointment.doctor_id).maybeSingle(),
    supabase
      .from("clinics")
      .select("name, address, timezone")
      .eq("id", appointment.clinic_id)
      .maybeSingle(),
    supabase
      .from("appointment_types")
      .select("name, duration_minutes")
      .eq("id", appointment.appointment_type_id)
      .maybeSingle(),
  ]);

  for (const result of [doctorResult, clinicResult, appointmentTypeResult]) {
    if (result.error) {
      throw new Error(`Failed to load managed appointment details: ${result.error.message}`);
    }
  }

  if (!doctorResult.data || !clinicResult.data || !appointmentTypeResult.data) {
    throw new Error(
      "Managed appointment references a missing doctor, clinic, or appointment type.",
    );
  }

  return {
    id: appointment.id,
    status: appointment.status,
    startsAt: appointment.starts_at,
    endsAt: appointment.ends_at,
    patientName: appointment.patient_name,
    patientPhone: appointment.patient_phone,
    patientEmail: appointment.patient_email,
    doctorId: appointment.doctor_id,
    doctorName: doctorResult.data.full_name,
    clinicId: appointment.clinic_id,
    clinicName: clinicResult.data.name,
    clinicAddress: clinicResult.data.address,
    clinicTimezone: clinicResult.data.timezone,
    appointmentTypeId: appointment.appointment_type_id,
    appointmentTypeName: appointmentTypeResult.data.name,
    appointmentDurationMinutes: appointmentTypeResult.data.duration_minutes,
  };
}
