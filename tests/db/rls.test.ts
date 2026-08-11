import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupUsers,
  createAnonClient,
  createDoctorFixture,
  createSecretaryFixture,
  createServiceRoleClient,
  type DoctorFixture,
} from "./fixtures";

describe("RLS", () => {
  const admin = createServiceRoleClient();
  const userIds: string[] = [];

  let doctorA: DoctorFixture;
  let doctorBUnpublished: DoctorFixture;
  let secretaryA: Awaited<ReturnType<typeof createSecretaryFixture>>;

  beforeAll(async () => {
    doctorA = await createDoctorFixture(admin, { isPublished: true });
    doctorBUnpublished = await createDoctorFixture(admin, { isPublished: false });
    secretaryA = await createSecretaryFixture(admin, doctorA.doctorId);

    await admin.from("working_hours").insert({
      doctor_id: doctorA.doctorId,
      clinic_id: doctorA.clinicId,
      day_of_week: 1,
      start_time: "09:00",
      end_time: "17:00",
    });

    userIds.push(doctorA.user.id, doctorBUnpublished.user.id, secretaryA.user.id);
  });

  afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

  it("lets anon read a published doctor's profile", async () => {
    const anon = createAnonClient();
    const { data, error } = await anon.from("doctors").select().eq("id", doctorA.doctorId).maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(doctorA.doctorId);
  });

  it("hides an unpublished doctor's profile from anon", async () => {
    const anon = createAnonClient();
    const { data, error } = await anon
      .from("doctors")
      .select()
      .eq("id", doctorBUnpublished.doctorId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("still lets the unpublished doctor read their own profile", async () => {
    const { data, error } = await doctorBUnpublished.client
      .from("doctors")
      .select()
      .eq("id", doctorBUnpublished.doctorId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(doctorBUnpublished.doctorId);
  });

  it("denies anon any access to working_hours (no grant, not just filtered)", async () => {
    const anon = createAnonClient();
    const { error } = await anon.from("working_hours").select().eq("doctor_id", doctorA.doctorId);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("denies anon any access to appointments", async () => {
    const anon = createAnonClient();
    const { error } = await anon.from("appointments").select().eq("doctor_id", doctorA.doctorId);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("lets the doctor read their own working_hours", async () => {
    const { data, error } = await doctorA.client
      .from("working_hours")
      .select()
      .eq("doctor_id", doctorA.doctorId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("lets the doctor's secretary read the same working_hours", async () => {
    const { data, error } = await secretaryA.client
      .from("working_hours")
      .select()
      .eq("doctor_id", doctorA.doctorId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("RLS-filters another doctor's working_hours to empty for authenticated staff (not a permission error)", async () => {
    const { data, error } = await doctorBUnpublished.client
      .from("working_hours")
      .select()
      .eq("doctor_id", doctorA.doctorId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("hides a suspended doctor's profile from anon, even though it was published (M10)", async () => {
    const suspended = await createDoctorFixture(admin, { isPublished: true });
    userIds.push(suspended.user.id);
    const { error: suspendError } = await admin
      .from("doctors")
      .update({ suspended_at: new Date().toISOString(), is_published: false })
      .eq("id", suspended.doctorId);
    if (suspendError) throw new Error(`failed to suspend doctor: ${suspendError.message}`);

    const anon = createAnonClient();
    const { data, error } = await anon.from("doctors").select().eq("id", suspended.doctorId).maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("no longer lets a suspended doctor read their own row at all -- stronger than merely unpublished (M10)", async () => {
    const suspended = await createDoctorFixture(admin, { isPublished: true });
    userIds.push(suspended.user.id);
    const { error: suspendError } = await admin
      .from("doctors")
      .update({ suspended_at: new Date().toISOString(), is_published: false })
      .eq("id", suspended.doctorId);
    if (suspendError) throw new Error(`failed to suspend doctor: ${suspendError.message}`);

    const { data, error } = await suspended.client
      .from("doctors")
      .select()
      .eq("id", suspended.doctorId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("no longer lets a suspended doctor's secretary read the doctor's working_hours (M10)", async () => {
    const suspended = await createDoctorFixture(admin, { isPublished: true });
    userIds.push(suspended.user.id);
    const secretary = await createSecretaryFixture(admin, suspended.doctorId);
    userIds.push(secretary.user.id);
    await admin.from("working_hours").insert({
      doctor_id: suspended.doctorId,
      clinic_id: suspended.clinicId,
      day_of_week: 1,
      start_time: "09:00",
      end_time: "17:00",
    });
    const { error: suspendError } = await admin
      .from("doctors")
      .update({ suspended_at: new Date().toISOString(), is_published: false })
      .eq("id", suspended.doctorId);
    if (suspendError) throw new Error(`failed to suspend doctor: ${suspendError.message}`);

    const { data, error } = await secretary.client
      .from("working_hours")
      .select()
      .eq("doctor_id", suspended.doctorId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("denies UPDATE on doctors to authenticated entirely -- only the service role (via admin lib) may write (M10)", async () => {
    const { error } = await doctorA.client
      .from("doctors")
      .update({ full_name: "Attempted self-edit" })
      .eq("id", doctorA.doctorId);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("prevents a secretary from adding another secretary (doctor-only write)", async () => {
    const outsider = await createDoctorFixture(admin);
    userIds.push(outsider.user.id);

    const { error } = await secretaryA.client
      .from("doctor_secretaries")
      .insert({ doctor_id: doctorA.doctorId, secretary_user_id: outsider.user.id });

    expect(error).not.toBeNull();
  });

  it("lets the doctor manage their own secretary roster", async () => {
    const newSecretary = await createSecretaryFixture(admin, doctorA.doctorId);
    userIds.push(newSecretary.user.id);

    const { error: deleteError } = await doctorA.client
      .from("doctor_secretaries")
      .delete()
      .eq("doctor_id", doctorA.doctorId)
      .eq("secretary_user_id", newSecretary.user.id);

    expect(deleteError).toBeNull();
  });
});
