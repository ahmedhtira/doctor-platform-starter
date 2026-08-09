import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getManagedAppointment } from "./get-managed-appointment";
import { ManageError, classifyManageActionError } from "./manage-errors";
import type { BookedAppointment } from "./book-appointment";

/**
 * DI core of patient-initiated cancellation. Resolves the appointment via
 * getManagedAppointment first (so an already-expired/unknown session never
 * reaches the RPC), then calls cancel_appointment with
 * p_management_session_secret_hash only — never p_actor_user_id, which is
 * the staff path.
 */
export async function cancelManagedAppointment(
  supabase: SupabaseClient<Database>,
  managementSessionSecretHash: string,
): Promise<BookedAppointment> {
  const view = await getManagedAppointment(supabase, managementSessionSecretHash);
  if (!view) {
    throw new ManageError("SESSION_INVALID", "Management session is invalid or expired.");
  }

  const { data, error } = await supabase.rpc("cancel_appointment", {
    p_appointment_id: view.id,
    p_management_session_secret_hash: managementSessionSecretHash,
  });

  if (error) {
    throw new ManageError(classifyManageActionError(error.code), error.message);
  }

  return data;
}
