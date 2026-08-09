import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { ManageError, classifyManageActionError } from "@/lib/booking/manage-errors";

export type StaffCancelledAppointment =
  Database["public"]["Functions"]["cancel_appointment"]["Returns"];

/**
 * DI core of staff-initiated cancellation. Takes the service-role client
 * (cancel_appointment is service_role-only) and the actor's own user id —
 * resolved server-side by the caller from getAuthenticatedUser(), never
 * accepted as a client-supplied argument. Reuses the existing
 * ManageError/classifyManageActionError as-is: the RPC raises the same
 * Postgres error codes regardless of whether the caller passed
 * p_actor_user_id (staff) or p_management_session_secret_hash (patient).
 */
export async function cancelStaffAppointment(
  supabase: SupabaseClient<Database>,
  input: { appointmentId: string; actorUserId: string },
): Promise<StaffCancelledAppointment> {
  const { data, error } = await supabase.rpc("cancel_appointment", {
    p_appointment_id: input.appointmentId,
    p_actor_user_id: input.actorUserId,
  });

  if (error) {
    throw new ManageError(classifyManageActionError(error.code), error.message);
  }

  return data;
}
