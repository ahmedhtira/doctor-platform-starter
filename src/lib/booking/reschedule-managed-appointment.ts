import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getManagedAppointment } from "./get-managed-appointment";
import { generateManagementToken } from "./generate-management-token";
import { ManageError, classifyManageActionError } from "./manage-errors";
import type { BookedAppointment } from "./book-appointment";

export type RescheduleManagedAppointmentInput = {
  managementSessionSecretHash: string;
  /** ISO 8601 instant. */
  newStartsAt: string;
};

export type RescheduleManagedAppointmentResult = {
  appointment: BookedAppointment;
  /**
   * Fresh raw management token for the rescheduled appointment. The old
   * token is unconditionally burned by reschedule_appointment (a changed
   * appointment shouldn't stay reachable via a stale link) — without this,
   * a patient who reschedules would be permanently locked out the moment
   * their 30-minute cookie session lapses. Never persisted beyond this
   * return value; only its hash reaches Postgres.
   */
  managementToken: string;
};

/**
 * DI core of patient-initiated rescheduling. Resolves the appointment via
 * getManagedAppointment, then rotates the management token atomically with
 * the reschedule (new starts_at + 24h expiry, same policy as the original
 * booking token) so the patient always has a working link afterward. The
 * browser's cookie-backed session is untouched by this — it's a separate
 * table (appointment_management_sessions) that reschedule_appointment never
 * writes to.
 */
export async function rescheduleManagedAppointment(
  supabase: SupabaseClient<Database>,
  input: RescheduleManagedAppointmentInput,
): Promise<RescheduleManagedAppointmentResult> {
  const view = await getManagedAppointment(supabase, input.managementSessionSecretHash);
  if (!view) {
    throw new ManageError("SESSION_INVALID", "Management session is invalid or expired.");
  }

  const { rawToken, tokenHash } = generateManagementToken();
  // Non-null: input.newStartsAt is already Zod-validated as a well-formed
  // ISO instant before this is called — .toISO() only returns null for an
  // invalid DateTime.
  const newTokenExpiresAt = DateTime.fromISO(input.newStartsAt)
    .plus({ hours: 24 })
    .toUTC()
    .toISO()!;

  const { data, error } = await supabase.rpc("reschedule_appointment", {
    p_appointment_id: view.id,
    p_new_starts_at: input.newStartsAt,
    p_management_session_secret_hash: input.managementSessionSecretHash,
    p_new_management_token_hash: tokenHash,
    p_new_management_token_expires_at: newTokenExpiresAt,
  });

  if (error) {
    throw new ManageError(classifyManageActionError(error.code), error.message);
  }

  return { appointment: data, managementToken: rawToken };
}
