import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { fetchAvailableSlots } from "@/lib/availability/fetch-availability-data";
import type { AvailableSlot } from "@/lib/availability/compute-available-slots";
import { generateManagementToken } from "@/lib/booking/generate-management-token";
import { ManageError, classifyManageActionError } from "@/lib/booking/manage-errors";

export type StaffRescheduledAppointment =
  Database["public"]["Functions"]["reschedule_appointment"]["Returns"];

export type RescheduleStaffAppointmentResult = {
  appointment: StaffRescheduledAppointment;
  /**
   * Fresh raw management token for the rescheduled appointment — never
   * persisted (only its hash reaches Postgres) and never logged. Exists
   * only in this function's return value and the Server Action's response,
   * so the dashboard can show it to staff exactly once.
   *
   * Required, not optional: reschedule_appointment unconditionally burns
   * the patient's existing management token on any reschedule regardless
   * of who triggers it. Without a replacement here, a staff-initiated
   * reschedule would leave the patient locked out with no way back in —
   * M6 still has no email-sending mechanism, so this token is handed to
   * staff directly (copy-link UI) rather than silently dropped.
   */
  managementToken: string;
};

/**
 * Resolves the appointment's own doctor/clinic/appointment-type
 * server-side — never trust a client-supplied id here, same rule
 * getManageSlotsAction documents — then delegates to
 * fetch-availability-data.ts's DI core directly (not the guarded
 * get-available-slots.ts thin wrapper the public booking flow uses):
 * reusing the same `supabase` client this function already received keeps
 * this whole module free of the `import "server-only"` guard, which is
 * what makes it callable from Vitest (the Server Action in
 * dashboard/actions.ts is the one place that constructs the real
 * service-role client and is itself guarded).
 */
export async function getStaffRescheduleSlots(
  supabase: SupabaseClient<Database>,
  input: { appointmentId: string; localDate: string },
): Promise<AvailableSlot[]> {
  const { data: appointment, error } = await supabase
    .from("appointments")
    .select("doctor_id, clinic_id, appointment_type_id")
    .eq("id", input.appointmentId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve appointment for reschedule: ${error.message}`);
  }
  if (!appointment) {
    throw new ManageError("APPOINTMENT_NOT_FOUND", "Appointment not found.");
  }

  return fetchAvailableSlots(supabase, {
    doctorId: appointment.doctor_id,
    clinicId: appointment.clinic_id,
    appointmentTypeId: appointment.appointment_type_id,
    localDate: input.localDate,
    now: new Date().toISOString(),
  });
}

/**
 * DI core of staff-initiated rescheduling. Mirrors
 * reschedule-managed-appointment.ts exactly, but authorizes via
 * p_actor_user_id instead of a management session, and always rotates the
 * management token (see RescheduleStaffAppointmentResult above for why
 * that isn't optional here).
 */
export async function rescheduleStaffAppointment(
  supabase: SupabaseClient<Database>,
  input: { appointmentId: string; actorUserId: string; newStartsAt: string },
): Promise<RescheduleStaffAppointmentResult> {
  const { rawToken, tokenHash } = generateManagementToken();
  // Non-null: input.newStartsAt is already Zod-validated as a well-formed
  // ISO instant before this is called — .toISO() only returns null for an
  // invalid DateTime.
  const newTokenExpiresAt = DateTime.fromISO(input.newStartsAt)
    .plus({ hours: 24 })
    .toUTC()
    .toISO()!;

  const { data, error } = await supabase.rpc("reschedule_appointment", {
    p_appointment_id: input.appointmentId,
    p_new_starts_at: input.newStartsAt,
    p_actor_user_id: input.actorUserId,
    p_new_management_token_hash: tokenHash,
    p_new_management_token_expires_at: newTokenExpiresAt,
  });

  if (error) {
    throw new ManageError(classifyManageActionError(error.code), error.message);
  }

  return { appointment: data, managementToken: rawToken };
}
