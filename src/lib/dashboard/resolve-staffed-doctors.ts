import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type StaffDoctorSummary = {
  id: string;
  fullName: string;
  slug: string;
  timezone: string;
};

/**
 * DI core of getStaffedDoctors (auth-context.ts) — takes the Supabase
 * client as a parameter, same testability pattern as the M3/M4/M5 DI-core
 * modules (fetch-availability-data.ts, book-appointment.ts, etc.), so it's
 * callable from Vitest with a locally-built client without pulling in
 * server.ts's `import "server-only"` guard or a real Next.js request's
 * cookies.
 *
 * Deliberately does NOT do a bare `select * from doctors` — the
 * `doctors_select` RLS policy also allows `is_published`, so an unfiltered
 * select would return every published doctor platform-wide, not just this
 * user's own. Instead: the owner path (`doctors.user_id = userId`) and the
 * secretary path (`doctor_secretaries.secretary_user_id = userId` -> those
 * doctors) are each queried directly, both still under RLS when called
 * with an RLS-bound client.
 */
export async function resolveStaffedDoctors(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<StaffDoctorSummary[]> {
  const [ownedResult, secretaryLinksResult] = await Promise.all([
    supabase.from("doctors").select("id, full_name, slug, timezone").eq("user_id", userId),
    supabase.from("doctor_secretaries").select("doctor_id").eq("secretary_user_id", userId),
  ]);

  if (ownedResult.error) {
    throw new Error(`Failed to resolve owned doctors: ${ownedResult.error.message}`);
  }
  if (secretaryLinksResult.error) {
    throw new Error(
      `Failed to resolve secretary doctor links: ${secretaryLinksResult.error.message}`,
    );
  }

  const secretaryDoctorIds = secretaryLinksResult.data.map((link) => link.doctor_id);

  let secretaryDoctors: typeof ownedResult.data = [];
  if (secretaryDoctorIds.length > 0) {
    const { data, error } = await supabase
      .from("doctors")
      .select("id, full_name, slug, timezone")
      .in("id", secretaryDoctorIds);
    if (error) {
      throw new Error(`Failed to resolve secretary doctors: ${error.message}`);
    }
    secretaryDoctors = data;
  }

  const byId = new Map<string, StaffDoctorSummary>();
  for (const doctor of [...ownedResult.data, ...secretaryDoctors]) {
    byId.set(doctor.id, {
      id: doctor.id,
      fullName: doctor.full_name,
      slug: doctor.slug,
      timezone: doctor.timezone,
    });
  }

  return [...byId.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}
