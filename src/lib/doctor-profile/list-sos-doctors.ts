import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// Public RLS-bound client. Keep this projection free of private account data.
export async function listSosDoctors(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase
    .from("doctors")
    .select(
      "id, slug, full_name, sos_phone, sos_area, specialties(name_fr, name_ar), clinics(city)",
    )
    .eq("sos_enabled", true)
    .eq("is_published", true)
    .is("suspended_at", null)
    .is("deleted_at", null)
    .order("full_name");
  if (error) throw new Error("Unable to load the SOS directory.");
  return data ?? [];
}

export function phoneHref(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return null;
  return `tel:${phone.trim().startsWith("+") ? "+" : ""}${digits}`;
}
