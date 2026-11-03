import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { AdminError } from "./admin-errors";
import { serviceSettingsPayload, type DoctorServiceSettings } from "./doctor-service-settings";

export type UpdateDoctorInput = {
  doctorId: string;
  services?: DoctorServiceSettings;
  fullName: string;
  specialtyId: string;
  slug: string;
  defaultLocale: string;
  timezone: string;
  minBookingNoticeMinutes: number;
  bio?: string | null;
  phone?: string | null;
  pageVariant: "standard" | "custom";
  customTemplateKey?: string | null;
};

export type UpdatedDoctor = Database["public"]["Tables"]["doctors"]["Row"];

/**
 * Atomic service-role RPC update — no RLS applies (doctors_update_own was
 * dropped in M10 precisely so only this admin-gated path can write these
 * fields; see the migration's own comment). Does not touch clinic/
 * appointment-type/working-hours data — that stays owned by the doctor's
 * own /dashboard/availability page once they've logged in, avoiding a
 * second UI for the same thing.
 */
export async function updateDoctor(
  supabase: SupabaseClient<Database>,
  input: UpdateDoctorInput,
): Promise<UpdatedDoctor> {
  const { data, error } = await supabase.rpc("update_doctor_with_services", {
    p_doctor_id: input.doctorId,
    p_profile: {
      full_name: input.fullName,
      specialty_id: input.specialtyId,
      slug: input.slug,
      default_locale: input.defaultLocale,
      timezone: input.timezone,
      min_booking_notice_minutes: input.minBookingNoticeMinutes,
      bio: input.bio ?? null,
      phone: input.phone ?? null,
      page_variant: input.pageVariant,
      custom_template_key: input.customTemplateKey ?? null,
    },
    ...(input.services ? { p_services: serviceSettingsPayload(input.services) } : {}),
  });

  if (error) {
    if (error.code === "P0002") throw new AdminError("NOT_FOUND", "Doctor not found.");
    if (error.code === "23505") {
      throw new AdminError("SLUG_TAKEN", "This URL slug is already in use.");
    }
    throw new AdminError("UNKNOWN", error.message);
  }
  if (!data) {
    throw new AdminError("NOT_FOUND", "Doctor not found.");
  }
  return data;
}
