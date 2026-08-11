import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// RLS-bound anon client — relies entirely on the public-visibility
// SELECT policies from PROJECT_SPEC.md (doctors.is_published, and each
// embedded table's own "published doctor" policy). No service-role
// client here: this page has no business bypassing RLS.
//
// .is("suspended_at", null) is a defensive, redundant filter — real
// enforcement comes from the RLS hardening in migration
// 20260101000022 (a suspended doctor's is_published is always forced
// false in the same write that suspends them, so is_published=true
// alone already excludes them). This costs nothing and is one more
// layer against a future code path ever decoupling the two fields. See
// PROJECT_SPEC.md's M10 section.
export const getDoctor = cache(async (slug: string) => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("doctors")
    .select(
      `
      id, full_name, bio, phone, slug, page_variant, custom_template_key,
      specialties ( name_fr, name_ar ),
      clinics ( id, name, address, timezone ),
      appointment_types ( id, name, duration_minutes ),
      doctor_qualifications ( id, title, institution, year_obtained ),
      doctor_publications ( id, title, publication_name, url, published_year ),
      doctor_books ( id, title, publisher, published_year, url ),
      doctor_media_appearances ( id, title, outlet, url, appeared_on )
    `,
    )
    .eq("slug", slug)
    .eq("is_published", true)
    .is("suspended_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load doctor profile: ${error.message}`);
  }

  return data;
});

export type PublicDoctorProfile = NonNullable<Awaited<ReturnType<typeof getDoctor>>>;
