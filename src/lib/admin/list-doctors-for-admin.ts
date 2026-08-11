import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type AdminDoctorListItem = {
  id: string;
  fullName: string;
  slug: string;
  specialtyNameFr: string;
  specialtyNameAr: string;
  isPublished: boolean;
  isSuspended: boolean;
  isDeleted: boolean;
  pageVariant: string;
};

/**
 * Service-role read (this page is gated by requirePlatformAdmin(), not
 * RLS — doctors_select's own policy wouldn't show the admin every
 * doctor anyway, only ones they happen to staff). Ordered by name;
 * scale here is "however many doctors one admin manages by hand," same
 * reasoning M2.5's in-memory search filtering already established for
 * this codebase.
 */
export async function listDoctorsForAdmin(
  supabase: SupabaseClient<Database>,
): Promise<AdminDoctorListItem[]> {
  const { data, error } = await supabase
    .from("doctors")
    .select("id, full_name, slug, is_published, suspended_at, deleted_at, page_variant, specialties (name_fr, name_ar)")
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error(`Failed to load doctors: ${error.message}`);
  }

  return data.map((doctor) => ({
    id: doctor.id,
    fullName: doctor.full_name,
    slug: doctor.slug,
    specialtyNameFr: doctor.specialties?.name_fr ?? "",
    specialtyNameAr: doctor.specialties?.name_ar ?? "",
    isPublished: doctor.is_published,
    isSuspended: doctor.suspended_at !== null,
    isDeleted: doctor.deleted_at !== null,
    pageVariant: doctor.page_variant,
  }));
}
