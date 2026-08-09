import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createServiceRoleClient,
  createDoctorFixture,
  createSecretaryFixture,
  cleanupUsers,
  TEST_PASSWORD,
  type DoctorFixture,
} from "../db/fixtures";

export { TEST_PASSWORD };
export { createServiceRoleClient };

export type TodayAppointmentFixture = {
  doctor: DoctorFixture;
  appointmentId: string;
  cleanup: () => Promise<void>;
};

// createDoctorFixture's own default when no `timezone` option is passed
// (tests/db/fixtures.ts) — DoctorFixture doesn't expose the timezone it
// picked, so this mirrors that default explicitly rather than guessing.
const FIXTURE_DOCTOR_TIMEZONE = "Africa/Tunis";

/**
 * Builds on the existing tests/db/fixtures.ts service-role infrastructure
 * rather than the permanent dev seed (scripts/seed-doctor.ts stays scoped
 * to dev-seed data only — see PROJECT_SPEC.md's M6 section). A fresh
 * doctor is created with real credentials (createDoctorFixture's shared
 * TEST_PASSWORD), so dashboard.spec.ts logs in through the real /login
 * form rather than a bypassed session. One `confirmed` appointment is
 * inserted directly (service-role, bypassing book_appointment's
 * slot-validity checks on purpose — the exclusion constraint is the only
 * invariant that has to hold) at a fixed "today at 09:15" local time in
 * the doctor's own timezone, so it's deterministic regardless of what day
 * of the week or time of day the suite happens to run. Created
 * unpublished (`isPublished: false`) — a dashboard/login fixture has no
 * reason to be publicly listed, and Playwright runs every spec file
 * concurrently (`fullyParallel`), so a published fixture doctor would
 * transiently appear in doctor-search.spec.ts's homepage/search-result
 * assertions depending on timing.
 */
export async function createTodayAppointmentFixture(
  admin: SupabaseClient,
): Promise<TodayAppointmentFixture> {
  const doctor = await createDoctorFixture(admin, { isPublished: false });

  const startsAt = DateTime.now()
    .setZone(FIXTURE_DOCTOR_TIMEZONE)
    .set({ hour: 9, minute: 15, second: 0, millisecond: 0 })
    .toUTC();
  const endsAt = startsAt.plus({ minutes: 30 });

  // Non-null: startsAt/endsAt are always valid DateTimes here, so .toISO()
  // can't return null (same reasoning as book-appointment.ts).
  const { data, error } = await admin
    .from("appointments")
    .insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      appointment_type_id: doctor.appointmentTypeId,
      starts_at: startsAt.toISO()!,
      ends_at: endsAt.toISO()!,
      patient_name: "Dashboard E2E Patient",
      patient_phone: "+216 98 000 100",
    })
    .select()
    .single();
  if (error) throw new Error(`failed to insert appointment fixture: ${error.message}`);

  return {
    doctor,
    appointmentId: data.id,
    cleanup: async () => {
      // Cascades to appointment_management_tokens/_sessions (both
      // `on delete cascade` on appointment_id) — covers any token the
      // reschedule flow produced during the test.
      await admin.from("appointments").delete().eq("id", data.id);
      await cleanupUsers(admin, [doctor.user.id]);
    },
  };
}

export type MultiDoctorSecretaryFixture = {
  doctorA: DoctorFixture;
  doctorB: DoctorFixture;
  secretaryEmail: string;
  cleanup: () => Promise<void>;
};

/**
 * Two independent doctors plus one secretary linked to both — for proving
 * the dashboard keeps the selected doctor across navigation (§3 of the
 * M6 plan's doctor-context-preservation correction). Self-contained: does
 * not depend on the seeded amira-ben-salah doctor at all. Both doctors are
 * unpublished for the same reason as createTodayAppointmentFixture above.
 */
export async function createMultiDoctorSecretaryFixture(
  admin: SupabaseClient,
): Promise<MultiDoctorSecretaryFixture> {
  const doctorA = await createDoctorFixture(admin, { isPublished: false });
  const doctorB = await createDoctorFixture(admin, { isPublished: false });
  const secretary = await createSecretaryFixture(admin, doctorA.doctorId);

  const { error } = await admin
    .from("doctor_secretaries")
    .insert({ doctor_id: doctorB.doctorId, secretary_user_id: secretary.user.id });
  if (error) throw new Error(`failed to link secretary to second doctor: ${error.message}`);

  return {
    doctorA,
    doctorB,
    secretaryEmail: secretary.user.email,
    cleanup: async () => {
      await cleanupUsers(admin, [doctorA.user.id, doctorB.user.id, secretary.user.id]);
    },
  };
}
