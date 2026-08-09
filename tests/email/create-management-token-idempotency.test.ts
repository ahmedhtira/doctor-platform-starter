import { afterAll, describe, expect, it } from "vitest";
import { cleanupUsers } from "../db/fixtures";
import {
  createTypedServiceRoleClient,
  setupDoctorWithHours,
  bookForEmailTest,
  getOutboxRowsForAppointment,
  LOCAL_DATE,
} from "./fixtures";
import { deriveEmailManagementToken } from "@/lib/email/derive-management-token";

// Proves create_management_token's upsert-per-email_outbox_id behavior
// directly against Postgres (PROJECT_SPEC.md's M7 section) — the DB-level
// half of the "no duplicate valid tokens caused by retries" guarantee;
// tests/email/process-email-outbox.test.ts proves the same thing through
// the real worker path.

describe("create_management_token idempotency (M7)", () => {
  const admin = createTypedServiceRoleClient();
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

  async function setupOutboxRow() {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    const booked = await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T09:00:00Z`);
    const rows = await getOutboxRowsForAppointment(admin, booked.appointment.id);
    return { doctor, booked, outboxRow: rows[0] };
  }

  it("two upserts with the same email_outbox_id and the same derived hash leave exactly one row", async () => {
    const { booked, outboxRow } = await setupOutboxRow();
    const { tokenHash } = deriveEmailManagementToken(outboxRow.id);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    for (let i = 0; i < 2; i++) {
      const { error } = await admin.rpc("create_management_token", {
        p_appointment_id: booked.appointment.id,
        p_token_hash: tokenHash,
        p_expires_at: expiresAt,
        p_email_outbox_id: outboxRow.id,
      });
      if (error) throw new Error(error.message);
    }

    const { data: tokens, error } = await admin
      .from("appointment_management_tokens")
      .select("*")
      .eq("email_outbox_id", outboxRow.id);
    if (error) throw new Error(error.message);

    expect(tokens).toHaveLength(1);
    expect(tokens![0].token_hash).toBe(tokenHash);
  });

  it("a token already used_at-set is not resurrected by a subsequent upsert", async () => {
    const { booked, outboxRow } = await setupOutboxRow();
    const { tokenHash } = deriveEmailManagementToken(outboxRow.id);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { data: created, error: createError } = await admin.rpc("create_management_token", {
      p_appointment_id: booked.appointment.id,
      p_token_hash: tokenHash,
      p_expires_at: expiresAt,
      p_email_outbox_id: outboxRow.id,
    });
    if (createError) throw new Error(createError.message);

    const { error: useError } = await admin
      .from("appointment_management_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("id", created.id);
    if (useError) throw new Error(useError.message);

    // Simulated retry: mint "again" for the same outbox row.
    const { error: retryError } = await admin.rpc("create_management_token", {
      p_appointment_id: booked.appointment.id,
      p_token_hash: tokenHash,
      p_expires_at: expiresAt,
      p_email_outbox_id: outboxRow.id,
    });
    if (retryError) throw new Error(retryError.message);

    const { data: token, error } = await admin
      .from("appointment_management_tokens")
      .select("used_at")
      .eq("email_outbox_id", outboxRow.id)
      .single();
    if (error) throw new Error(error.message);

    expect(token.used_at).not.toBeNull();
  });

  it("the unique constraint holds even if a later call passes a different hash for the same outbox id", async () => {
    const { booked, outboxRow } = await setupOutboxRow();
    const { tokenHash: firstHash } = deriveEmailManagementToken(outboxRow.id);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { error: firstError } = await admin.rpc("create_management_token", {
      p_appointment_id: booked.appointment.id,
      p_token_hash: firstHash,
      p_expires_at: expiresAt,
      p_email_outbox_id: outboxRow.id,
    });
    if (firstError) throw new Error(firstError.message);

    // Defends the DB invariant independent of Node-level determinism —
    // even a hypothetically-different hash for the same outbox id still
    // upserts onto the one row rather than creating a second.
    const differentHash = "a".repeat(64);
    const { error: secondError } = await admin.rpc("create_management_token", {
      p_appointment_id: booked.appointment.id,
      p_token_hash: differentHash,
      p_expires_at: expiresAt,
      p_email_outbox_id: outboxRow.id,
    });
    if (secondError) throw new Error(secondError.message);

    const { data: tokens, error } = await admin
      .from("appointment_management_tokens")
      .select("token_hash")
      .eq("email_outbox_id", outboxRow.id);
    if (error) throw new Error(error.message);

    expect(tokens).toHaveLength(1);
    expect(tokens![0].token_hash).toBe(differentHash);
  });

  it("tokens with email_outbox_id null (on-screen tokens) are completely unaffected", async () => {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    // book_appointment mints its own on-screen token directly (email_outbox_id
    // stays null) — this is that token, untouched by anything above.
    const booked = await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T10:00:00Z`);

    const { data: onScreenTokens, error } = await admin
      .from("appointment_management_tokens")
      .select("*")
      .eq("appointment_id", booked.appointment.id)
      .is("email_outbox_id", null);
    if (error) throw new Error(error.message);

    expect(onScreenTokens).toHaveLength(1);
    expect(onScreenTokens![0].used_at).toBeNull();
  });
});
