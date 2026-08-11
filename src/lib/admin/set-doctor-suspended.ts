import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { AdminError } from "./admin-errors";

/**
 * Suspending always forces is_published=false in the same write, so
 * there is never a window where a doctor is suspended but still
 * publicly visible/bookable (the RLS/is_staff_for_doctor hardening in
 * migration 20260101000022 is what makes suspension actually block
 * everything immediately — this function just sets the flag it keys
 * off). Reactivating deliberately does NOT restore is_published — that
 * stays a separate, deliberate re-publish action.
 */
export async function setDoctorSuspended(
  supabase: SupabaseClient<Database>,
  input: { doctorId: string; suspended: boolean },
): Promise<void> {
  const patch = input.suspended
    ? { suspended_at: new Date().toISOString(), is_published: false }
    : { suspended_at: null };

  const { data, error } = await supabase
    .from("doctors")
    .update(patch)
    .eq("id", input.doctorId)
    .select("id")
    .maybeSingle();

  if (error) throw new AdminError("UNKNOWN", error.message);
  if (!data) throw new AdminError("NOT_FOUND", "Doctor not found.");
}
