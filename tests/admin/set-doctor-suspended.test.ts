import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getTestSupabaseServiceRoleKey, getTestSupabaseUrl } from "../db/env";
import { cleanupUsers, createDoctorFixture } from "../db/fixtures";
import { setDoctorSuspended } from "@/lib/admin/set-doctor-suspended";
import type { Database } from "@/lib/supabase/database.types";

function createTypedServiceRoleClient(): SupabaseClient<Database> {
  return createClient<Database>(getTestSupabaseUrl(), getTestSupabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describe("setDoctorSuspended (M10)", () => {
  const admin = createTypedServiceRoleClient();
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

  it("suspending forces is_published=false in the same write", async () => {
    const doctor = await createDoctorFixture(admin, { isPublished: true });
    userIds.push(doctor.user.id);

    await setDoctorSuspended(admin, { doctorId: doctor.doctorId, suspended: true });

    const { data } = await admin
      .from("doctors")
      .select("suspended_at, is_published")
      .eq("id", doctor.doctorId)
      .single();
    expect(data!.suspended_at).not.toBeNull();
    expect(data!.is_published).toBe(false);
  });

  it("reactivating clears suspended_at but does not auto-republish", async () => {
    const doctor = await createDoctorFixture(admin, { isPublished: true });
    userIds.push(doctor.user.id);

    await setDoctorSuspended(admin, { doctorId: doctor.doctorId, suspended: true });
    await setDoctorSuspended(admin, { doctorId: doctor.doctorId, suspended: false });

    const { data } = await admin
      .from("doctors")
      .select("suspended_at, is_published")
      .eq("id", doctor.doctorId)
      .single();
    expect(data!.suspended_at).toBeNull();
    expect(data!.is_published).toBe(false);
  });

  it("throws NOT_FOUND for a nonexistent doctor id", async () => {
    await expect(
      setDoctorSuspended(admin, {
        doctorId: "00000000-0000-0000-0000-000000000099",
        suspended: true,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
