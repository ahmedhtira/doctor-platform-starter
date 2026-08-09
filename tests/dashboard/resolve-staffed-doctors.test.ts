import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { getTestSupabaseServiceRoleKey, getTestSupabaseUrl } from "../db/env";
import {
  cleanupUsers,
  createDoctorFixture,
  createSecretaryFixture,
  createTestUser,
} from "../db/fixtures";
import { resolveStaffedDoctors } from "@/lib/dashboard/resolve-staffed-doctors";
import type { Database } from "@/lib/supabase/database.types";

// Exercises the M6 DI core the dashboard's auth-context.ts delegates to.

function createTypedServiceRoleClient(): SupabaseClient<Database> {
  return createClient<Database>(getTestSupabaseUrl(), getTestSupabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describe("resolveStaffedDoctors (M6)", () => {
  const admin = createTypedServiceRoleClient();
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

  it("resolves the doctor's own row for the owner path", async () => {
    const doctor = await createDoctorFixture(admin);
    userIds.push(doctor.user.id);

    const result = await resolveStaffedDoctors(admin, doctor.user.id);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(doctor.doctorId);
  });

  it("resolves the linked doctor for the secretary path", async () => {
    const doctor = await createDoctorFixture(admin);
    userIds.push(doctor.user.id);
    const secretary = await createSecretaryFixture(admin, doctor.doctorId);
    userIds.push(secretary.user.id);

    const result = await resolveStaffedDoctors(admin, secretary.user.id);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(doctor.doctorId);
  });

  it("resolves both doctors for a secretary linked to more than one", async () => {
    const doctorA = await createDoctorFixture(admin);
    userIds.push(doctorA.user.id);
    const doctorB = await createDoctorFixture(admin);
    userIds.push(doctorB.user.id);

    const secretary = await createSecretaryFixture(admin, doctorA.doctorId);
    userIds.push(secretary.user.id);
    const { error } = await admin
      .from("doctor_secretaries")
      .insert({ doctor_id: doctorB.doctorId, secretary_user_id: secretary.user.id });
    if (error) throw new Error(`failed to link second doctor: ${error.message}`);

    const result = await resolveStaffedDoctors(admin, secretary.user.id);

    expect(result.map((doctor) => doctor.id).sort()).toEqual(
      [doctorA.doctorId, doctorB.doctorId].sort(),
    );
  });

  it("never returns an unrelated published doctor for a user with no staff relationship", async () => {
    // Regression guard for the exact bug this DI core was written to avoid:
    // a bare `select * from doctors` would also return every published
    // doctor platform-wide under the doctors_select RLS policy.
    const unrelatedDoctor = await createDoctorFixture(admin, { isPublished: true });
    userIds.push(unrelatedDoctor.user.id);

    const bystander = await createTestUser(admin, "bystander");
    userIds.push(bystander.id);

    const result = await resolveStaffedDoctors(admin, bystander.id);

    expect(result).toEqual([]);
  });
});
