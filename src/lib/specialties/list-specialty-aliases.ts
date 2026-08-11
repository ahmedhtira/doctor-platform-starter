import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type SpecialtyAlias = Database["public"]["Tables"]["specialty_aliases"]["Row"];

/**
 * public.specialty_aliases is anon-readable (RLS
 * `specialty_aliases_public_read`), same shape as list-specialties.ts —
 * only the public search page calls this today, but it's DI-core for
 * the same testability/reuse reasons the rest of src/lib/specialties/ is.
 */
export async function listSpecialtyAliases(
  supabase: SupabaseClient<Database>,
): Promise<SpecialtyAlias[]> {
  const { data, error } = await supabase.from("specialty_aliases").select("*");
  if (error) {
    throw new Error(`Failed to load specialty aliases: ${error.message}`);
  }
  return data;
}
