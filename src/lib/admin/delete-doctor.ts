import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { AdminError } from "./admin-errors";

export type DeleteDoctorResult = { mode: "hard" | "soft" };

/**
 * "Delete" cannot mean a literal `delete from doctors` in the general
 * case: appointments.doctor_id is `on delete cascade`
 * (20260101000008_appointments.sql), so that statement would silently
 * destroy every past appointment for a doctor who's ever been booked --
 * directly contradicting "preserve historical data." Two paths instead,
 * chosen by checking, not assumed. See PROJECT_SPEC.md's M10 section.
 */
export async function deleteDoctor(
  supabase: SupabaseClient<Database>,
  input: { doctorId: string },
): Promise<DeleteDoctorResult> {
  const { data: doctor, error: doctorError } = await supabase
    .from("doctors")
    .select("id, user_id")
    .eq("id", input.doctorId)
    .maybeSingle();
  if (doctorError) throw new AdminError("UNKNOWN", doctorError.message);
  if (!doctor) throw new AdminError("NOT_FOUND", "Doctor not found.");

  const { count: appointmentCount, error: countError } = await supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("doctor_id", input.doctorId);
  if (countError) throw new AdminError("UNKNOWN", countError.message);

  if (!appointmentCount) {
    // No history to lose -- a genuine hard delete. Cascades cleanly
    // through clinics/appointment_types/working_hours/breaks/
    // blocked_periods/schedule_exceptions/doctor_qualifications/
    // publications/books/media_appearances/doctor_secretaries (all
    // `on delete cascade` from doctors, directly or via clinics).
    const { error: deleteError } = await supabase.from("doctors").delete().eq("id", input.doctorId);
    if (deleteError) throw new AdminError("UNKNOWN", deleteError.message);

    // Safe specifically because there's no history this could ever be
    // found to have destroyed -- unlike the soft path below, where
    // deleting the auth user would cascade-delete the doctors row we're
    // trying to preserve.
    await supabase.auth.admin.deleteUser(doctor.user_id).catch(() => undefined);

    return { mode: "hard" };
  }

  // Has history -- the doctors row is never SQL-deleted. suspended_at +
  // is_published=false gives the full immediate-lockout guarantee
  // suspend already provides; deleted_at is a separate, terminal marker
  // (not offered the casual "reactivate" action a mere suspension is).
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("doctors")
    .update({ suspended_at: now, deleted_at: now, is_published: false, bio: null, phone: null })
    .eq("id", input.doctorId);
  if (updateError) throw new AdminError("UNKNOWN", updateError.message);

  // Genuinely leaf tables -- nothing else references them, so removing
  // them is safe and matches "remove removable dependent records"
  // precisely. clinics/appointment_types are deliberately left alone:
  // Postgres itself would reject deleting them while any appointment
  // still references them (their composite FK from appointments has no
  // ON DELETE clause, i.e. NO ACTION), and they're already fully inert
  // once the doctor is suspended.
  await supabase.from("doctor_qualifications").delete().eq("doctor_id", input.doctorId);
  await supabase.from("doctor_publications").delete().eq("doctor_id", input.doctorId);
  await supabase.from("doctor_books").delete().eq("doctor_id", input.doctorId);
  await supabase.from("doctor_media_appearances").delete().eq("doctor_id", input.doctorId);
  await supabase.from("doctor_secretaries").delete().eq("doctor_id", input.doctorId);
  await supabase.from("working_hours").delete().eq("doctor_id", input.doctorId);
  await supabase.from("breaks").delete().eq("doctor_id", input.doctorId);
  await supabase.from("blocked_periods").delete().eq("doctor_id", input.doctorId);
  await supabase.from("schedule_exceptions").delete().eq("doctor_id", input.doctorId);

  // Banned, not deleted -- admin.auth.admin.deleteUser would cascade-
  // delete the doctors row via the very FK this whole path exists to
  // avoid triggering. ~100 years, matching this being a terminal state
  // with no "un-ban" UI built (consistent with delete having no casual
  // undo).
  await supabase.auth.admin
    .updateUserById(doctor.user_id, { ban_duration: "876000h" })
    .catch(() => undefined);

  return { mode: "soft" };
}
