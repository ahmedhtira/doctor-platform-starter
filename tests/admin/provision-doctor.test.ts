import { afterAll, describe, expect, it } from "vitest";
import { getTestSupabaseServiceRoleKey, getTestSupabaseUrl } from "../db/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanupUsers } from "../db/fixtures";
import { buildProvisionInput, createFakeSender, unique } from "./fixtures";
import { provisionDoctor } from "@/lib/admin/provision-doctor";
import type { Database } from "@/lib/supabase/database.types";

// Exercises the M10 provisioning saga end to end against real Postgres +
// local Supabase Auth. See PROJECT_SPEC.md's M10 section: no privileged
// SQL function here (low-frequency, human-supervised, single-trusted-actor
// work) — atomicity is a TypeScript-level compensating rollback instead.

function createTypedServiceRoleClient(): SupabaseClient<Database> {
  return createClient<Database>(getTestSupabaseUrl(), getTestSupabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describe("provisionDoctor (M10)", () => {
  const admin = createTypedServiceRoleClient();
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

  it("creates the doctor, clinic, appointment type, working hours, and audit row, and sends the invite email immediately", async () => {
    const sender = createFakeSender();
    const input = await buildProvisionInput(admin);

    const result = await provisionDoctor(admin, sender.sender, input);
    userIds.push(result.authUserId);

    expect(result.doctor.full_name).toBe(input.fullName);
    expect(result.doctor.slug).toBe(input.slug);
    expect(result.doctor.is_published).toBe(false);
    expect(result.doctor.user_id).toBe(result.authUserId);

    const { data: clinics } = await admin.from("clinics").select("*").eq("doctor_id", result.doctor.id);
    expect(clinics).toHaveLength(1);
    expect(clinics![0].name).toBe(input.clinic.name);

    const { data: types } = await admin
      .from("appointment_types")
      .select("*")
      .eq("doctor_id", result.doctor.id);
    expect(types).toHaveLength(1);

    const { data: hours } = await admin
      .from("working_hours")
      .select("*")
      .eq("doctor_id", result.doctor.id);
    expect(hours).toHaveLength(input.workingDays.length);

    const { data: audit } = await admin
      .from("audit_log")
      .select("*")
      .eq("entity_id", result.doctor.id)
      .eq("action", "admin_create_doctor")
      .maybeSingle();
    expect(audit).not.toBeNull();
    expect((audit!.details as { email: string }).email).toBe(input.email);
    expect(JSON.stringify(audit)).not.toContain("token");
    expect(JSON.stringify(audit)).not.toContain("verify?");

    // Sent synchronously, in this same call — no email_outbox row involved.
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0].to).toBe(input.email);

    const { count: outboxCount } = await admin
      .from("email_outbox")
      .select("id", { count: "exact", head: true })
      .eq("to_email", input.email);
    expect(outboxCount ?? 0).toBe(0);
  });

  it("rejects a duplicate email without creating a doctor row, and never calls the sender", async () => {
    const sender1 = createFakeSender();
    const inputA = await buildProvisionInput(admin);
    const resultA = await provisionDoctor(admin, sender1.sender, inputA);
    userIds.push(resultA.authUserId);

    const sender2 = createFakeSender();
    const inputB = await buildProvisionInput(admin, { email: inputA.email });

    await expect(provisionDoctor(admin, sender2.sender, inputB)).rejects.toMatchObject({
      code: "EMAIL_ALREADY_REGISTERED",
    });
    expect(sender2.calls).toHaveLength(0);

    const { data: doctorB } = await admin.from("doctors").select("id").eq("slug", inputB.slug).maybeSingle();
    expect(doctorB).toBeNull();
  });

  it("rejects a duplicate slug and rolls back the orphaned auth account", async () => {
    const senderA = createFakeSender();
    const inputA = await buildProvisionInput(admin);
    const resultA = await provisionDoctor(admin, senderA.sender, inputA);
    userIds.push(resultA.authUserId);

    const senderB = createFakeSender();
    const emailB = `${unique("rollback-slug")}@example.test`;
    const inputB = await buildProvisionInput(admin, { email: emailB, slug: inputA.slug });

    await expect(provisionDoctor(admin, senderB.sender, inputB)).rejects.toMatchObject({
      code: "SLUG_TAKEN",
    });

    const { data: usersAfterFailure } = await admin.auth.admin.listUsers();
    expect(usersAfterFailure.users.find((u) => u.email === emailB)).toBeUndefined();

    // If the orphaned auth user from the failed attempt had NOT been
    // rolled back, re-provisioning the same email would fail with
    // EMAIL_ALREADY_REGISTERED instead of succeeding here.
    const senderC = createFakeSender();
    const inputC = await buildProvisionInput(admin, { email: emailB });
    const resultC = await provisionDoctor(admin, senderC.sender, inputC);
    userIds.push(resultC.authUserId);
    expect(resultC.doctor.user_id).toBe(resultC.authUserId);
  });

  it("rolls back everything when the invite email fails to send", async () => {
    const sender = createFakeSender();
    sender.fail = true;
    const input = await buildProvisionInput(admin);

    await expect(provisionDoctor(admin, sender.sender, input)).rejects.toMatchObject({
      code: "EMAIL_SEND_FAILED",
    });

    const { data: leftoverDoctor } = await admin
      .from("doctors")
      .select("id")
      .eq("slug", input.slug)
      .maybeSingle();
    expect(leftoverDoctor).toBeNull();

    // Same email, sender now working — proves the auth user + doctors
    // row from the failed attempt were both actually removed.
    const sender2 = createFakeSender();
    const input2 = await buildProvisionInput(admin, { email: input.email });
    const result2 = await provisionDoctor(admin, sender2.sender, input2);
    userIds.push(result2.authUserId);
  });
});
