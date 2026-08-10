import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { ManageError, classifyManageActionError } from "@/lib/booking/manage-errors";

export type AppointmentOutcome = "completed" | "no_show";

export type StaffRecordedOutcomeAppointment =
  Database["public"]["Functions"]["record_appointment_outcome"]["Returns"];

/**
 * DI core of staff-initiated completion/no-show recording. Staff-only —
 * unlike cancel_appointment/reschedule_appointment there is no patient
 * management-session path, so record_appointment_outcome takes
 * p_actor_user_id as a required parameter, not one of two optional,
 * mutually-exclusive actor params.
 */
export async function recordStaffAppointmentOutcome(
  supabase: SupabaseClient<Database>,
  input: { appointmentId: string; actorUserId: string; outcome: AppointmentOutcome },
): Promise<StaffRecordedOutcomeAppointment> {
  const { data, error } = await supabase.rpc("record_appointment_outcome", {
    p_appointment_id: input.appointmentId,
    p_actor_user_id: input.actorUserId,
    p_outcome: input.outcome,
  });

  if (error) {
    throw new ManageError(classifyManageActionError(error.code), error.message);
  }

  return data;
}
