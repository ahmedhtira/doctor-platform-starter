import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type DashboardAppointment = {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
  patientName: string;
  patientPhone: string;
  patientEmail: string | null;
  clinicId: string;
  clinicName: string;
  clinicTimezone: string;
  appointmentTypeId: string;
  appointmentTypeName: string;
};

/**
 * DI core for Today/Calendar. Takes the RLS-bound client (not
 * service-role) — reads are already covered by the `appointments_select`
 * staff policy, no privileged function needed. `appointments` has a
 * composite FK to `clinics`/`appointment_types`, so — same precedent as
 * fetch-availability-data.ts/get-managed-appointment.ts — this resolves
 * clinic/appointment-type names with separate doctor-scoped queries and
 * joins in application code, rather than relying on PostgREST embedding
 * across a composite FK.
 */
export async function fetchDashboardAppointments(
  supabase: SupabaseClient<Database>,
  params: { doctorId: string; rangeStart: string; rangeEnd: string },
): Promise<DashboardAppointment[]> {
  const { data: appointments, error } = await supabase
    .from("appointments")
    .select(
      "id, status, starts_at, ends_at, patient_name, patient_phone, patient_email, clinic_id, appointment_type_id",
    )
    .eq("doctor_id", params.doctorId)
    .gte("starts_at", params.rangeStart)
    .lt("starts_at", params.rangeEnd)
    .order("starts_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load dashboard appointments: ${error.message}`);
  }

  if (appointments.length === 0) {
    return [];
  }

  const [clinicsResult, appointmentTypesResult] = await Promise.all([
    supabase.from("clinics").select("id, name, timezone").eq("doctor_id", params.doctorId),
    supabase.from("appointment_types").select("id, name").eq("doctor_id", params.doctorId),
  ]);

  if (clinicsResult.error) {
    throw new Error(`Failed to load clinics: ${clinicsResult.error.message}`);
  }
  if (appointmentTypesResult.error) {
    throw new Error(`Failed to load appointment types: ${appointmentTypesResult.error.message}`);
  }

  const clinicById = new Map(clinicsResult.data.map((clinic) => [clinic.id, clinic]));
  const appointmentTypeNameById = new Map(
    appointmentTypesResult.data.map((type) => [type.id, type.name]),
  );

  return appointments.map((appointment) => ({
    id: appointment.id,
    status: appointment.status,
    startsAt: appointment.starts_at,
    endsAt: appointment.ends_at,
    patientName: appointment.patient_name,
    patientPhone: appointment.patient_phone,
    patientEmail: appointment.patient_email,
    clinicId: appointment.clinic_id,
    clinicName: clinicById.get(appointment.clinic_id)?.name ?? "",
    clinicTimezone: clinicById.get(appointment.clinic_id)?.timezone ?? "UTC",
    appointmentTypeId: appointment.appointment_type_id,
    appointmentTypeName: appointmentTypeNameById.get(appointment.appointment_type_id) ?? "",
  }));
}
