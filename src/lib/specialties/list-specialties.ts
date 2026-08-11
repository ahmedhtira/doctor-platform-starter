import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type Specialty = Database["public"]["Tables"]["specialties"]["Row"];

/**
 * The one place every specialty dropdown (admin create/edit forms, the
 * public search filter) reads from — public.specialties is anon-readable
 * (RLS `specialties_public_read`), so this works identically whether
 * called with a service-role client (admin pages) or the cookie-bound
 * RLS client (public page). Ordered by name_fr for a stable, alphabetic
 * dropdown; callers needing name_ar order can re-sort client-side.
 */
export async function listSpecialties(supabase: SupabaseClient<Database>): Promise<Specialty[]> {
  const { data, error } = await supabase.from("specialties").select("*").order("name_fr");
  if (error) {
    throw new Error(`Failed to load specialties: ${error.message}`);
  }
  return data;
}
