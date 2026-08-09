import { afterAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanupUsers } from "../db/fixtures";
import {
  createTypedServiceRoleClient,
  setupDoctorWithHours,
  bookForEmailTest,
  getOutboxRowsForAppointment,
  createFakeEmailSender,
  LOCAL_DATE,
} from "./fixtures";
import { processEmailOutbox } from "@/lib/email/process-email-outbox";
import { redeemManagementToken } from "@/lib/booking/redeem-management-token";
import { cancelStaffAppointment } from "@/lib/dashboard/cancel-staff-appointment";
import type { Database } from "@/lib/supabase/database.types";

// The worker end-to-end (PROJECT_SPEC.md's M7 section). A fake EmailSender
// that models Resend's real idempotency semantics stands in for the real
// API — createFakeEmailSender's `modelIdempotency` option dedupes by key
// exactly the way Resend's docs describe (verified while designing this
// milestone), which is what lets "distinct sends stayed at 1" mean
// something rather than just "the function was called once."

describe("processEmailOutbox (M7)", () => {
  const admin = createTypedServiceRoleClient();
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

  it("sends a confirmation email and the rendered link redeems for real", async () => {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    const booked = await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T09:00:00Z`);
    const { sender, calls } = createFakeEmailSender();

    const summary = await processEmailOutbox(admin, sender, { limit: 100, maxAttempts: 5 });
    expect(summary.sent).toBeGreaterThanOrEqual(1);

    const [row] = await getOutboxRowsForAppointment(admin, booked.appointment.id);
    expect(row.status).toBe("sent");
    expect(row.sent_at).not.toBeNull();

    const call = calls.find((c) => c.to === "email-test-patient@example.test");
    expect(call).toBeDefined();
    const linkMatch = call!.html.match(/token=([0-9a-f]{64})/);
    expect(linkMatch).not.toBeNull();

    const { session } = await redeemManagementToken(admin, linkMatch![1]);
    expect(session.appointment_id).toBe(booked.appointment.id);
  });

  it("a clean send failure leaves the row pending, then a retry succeeds with exactly one valid token", async () => {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    const booked = await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T10:00:00Z`);
    const { sender: failingSender } = createFakeEmailSender({ failFirstNCalls: 1000 });

    const firstPass = await processEmailOutbox(admin, failingSender, { limit: 100, maxAttempts: 5 });
    expect(firstPass.failed).toBeGreaterThanOrEqual(1);

    const [rowAfterFailure] = await getOutboxRowsForAppointment(admin, booked.appointment.id);
    expect(rowAfterFailure.status).toBe("pending");
    expect(rowAfterFailure.last_error).not.toBeNull();

    const { sender: succeedingSender } = createFakeEmailSender();
    const secondPass = await processEmailOutbox(admin, succeedingSender, { limit: 100, maxAttempts: 5 });
    expect(secondPass.sent).toBeGreaterThanOrEqual(1);

    const { data: tokens, error } = await admin
      .from("appointment_management_tokens")
      .select("*")
      .eq("email_outbox_id", rowAfterFailure.id);
    if (error) throw new Error(error.message);
    expect(tokens).toHaveLength(1);
    expect(tokens![0].used_at).toBeNull();
  });

  it("two passes over the same row (retry) derive the same token/link/content and the fake sender counts exactly one distinct send", async () => {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    const booked = await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T11:00:00Z`);

    // Pass 1: sender fails cleanly (simulating a transient send failure —
    // the row goes back to `pending`, but first_send_attempt_at and the
    // minted token both persist, exactly as they would after a genuine
    // crash-before-confirmation).
    const { sender: firstSender, calls: firstCalls } = createFakeEmailSender({
      failFirstNCalls: 1000,
      modelIdempotency: true,
    });
    await processEmailOutbox(admin, firstSender, { limit: 100, maxAttempts: 5 });

    // Pass 2: a fresh "worker" (fresh fake sender instance, as a separate
    // process would be) retries the same still-pending row.
    const { sender: secondSender, calls: secondCalls } = createFakeEmailSender({ modelIdempotency: true });
    await processEmailOutbox(admin, secondSender, { limit: 100, maxAttempts: 5 });

    expect(firstCalls).toHaveLength(1);
    expect(secondCalls).toHaveLength(1);

    // Same idempotency key, same rendered content, both attempts.
    expect(secondCalls[0].idempotencyKey).toBe(firstCalls[0].idempotencyKey);
    expect(secondCalls[0].subject).toBe(firstCalls[0].subject);
    expect(secondCalls[0].html).toBe(firstCalls[0].html);
    expect(secondCalls[0].text).toBe(firstCalls[0].text);
    expect(secondCalls[0].to).toBe(firstCalls[0].to);
    expect(secondCalls[0].from).toBe(firstCalls[0].from);

    const [row] = await getOutboxRowsForAppointment(admin, booked.appointment.id);
    expect(row.status).toBe("sent");

    const { data: tokens, error } = await admin
      .from("appointment_management_tokens")
      .select("*")
      .eq("email_outbox_id", row.id);
    if (error) throw new Error(error.message);
    expect(tokens).toHaveLength(1);
  });

  it("a successful send followed by a local finalize-write failure retries the write, not the send", async () => {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    const booked = await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T12:00:00Z`);
    const { sender, calls } = createFakeEmailSender();

    // Wraps the real client so the *first* "status: sent" finalize write
    // fails, simulating a transient local DB write failure right after a
    // successful send — everything else (claim RPC, token-mint RPC, other
    // reads/writes) passes through untouched.
    const flakyClient = wrapClientFailingFirstSentFinalize(admin, 1);

    const summary = await processEmailOutbox(flakyClient, sender, { limit: 100, maxAttempts: 5 });
    expect(summary.sent).toBeGreaterThanOrEqual(1);

    const [row] = await getOutboxRowsForAppointment(admin, booked.appointment.id);
    expect(row.status).toBe("sent");

    // The send itself only happened once — finalizeSent's own short retry
    // loop closed the local write failure without falling through to a
    // whole new claim (which would have called the sender a second time).
    const callsForThisAppointment = calls.filter((call) => call.to === "email-test-patient@example.test");
    expect(callsForThisAppointment).toHaveLength(1);
  });

  it("maxAttempts moves the row to failed", async () => {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    const booked = await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T13:00:00Z`);
    const { sender } = createFakeEmailSender({ failFirstNCalls: 1000 });

    await processEmailOutbox(admin, sender, { limit: 100, maxAttempts: 1 });

    const [row] = await getOutboxRowsForAppointment(admin, booked.appointment.id);
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(1);
  });

  it("cancellation emails carry no link or token", async () => {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    const booked = await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T14:00:00Z`);
    await cancelStaffAppointment(admin, { appointmentId: booked.appointment.id, actorUserId: doctor.user.id });

    const { sender, calls } = createFakeEmailSender();
    await processEmailOutbox(admin, sender, { limit: 100, maxAttempts: 5 });

    const rows = await getOutboxRowsForAppointment(admin, booked.appointment.id);
    const cancellationRow = rows.find((row) => row.template === "appointment_cancellation");
    expect(cancellationRow?.status).toBe("sent");

    const { data: tokens, error } = await admin
      .from("appointment_management_tokens")
      .select("id")
      .eq("email_outbox_id", cancellationRow!.id);
    if (error) throw new Error(error.message);
    expect(tokens).toHaveLength(0);

    const call = calls.find((c) => c.subject.includes("annulé") || c.subject.includes("ألغي") || c.subject.includes("إلغاء"));
    expect(call).toBeDefined();
    expect(call!.html).not.toContain("/manage#token=");
  });

  it("unrelated on-screen (email_outbox_id: null) tokens are untouched by the worker", async () => {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    const booked = await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T15:00:00Z`);

    const { data: before } = await admin
      .from("appointment_management_tokens")
      .select("token_hash, used_at")
      .eq("appointment_id", booked.appointment.id)
      .is("email_outbox_id", null)
      .single();

    const { sender } = createFakeEmailSender();
    await processEmailOutbox(admin, sender, { limit: 100, maxAttempts: 5 });

    const { data: after } = await admin
      .from("appointment_management_tokens")
      .select("token_hash, used_at")
      .eq("appointment_id", booked.appointment.id)
      .is("email_outbox_id", null)
      .single();

    expect(after?.token_hash).toBe(before?.token_hash);
    expect(after?.used_at).toBe(before?.used_at);
  });

  it("the raw derived token never appears in email_outbox.payload or appointment_management_tokens", async () => {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    const booked = await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T13:30:00Z`);
    const { sender, calls } = createFakeEmailSender();

    await processEmailOutbox(admin, sender, { limit: 100, maxAttempts: 5 });

    const call = calls.find((c) => c.to === "email-test-patient@example.test");
    const rawToken = call!.html.match(/token=([0-9a-f]{64})/)![1];

    const [row] = await getOutboxRowsForAppointment(admin, booked.appointment.id);
    expect(JSON.stringify(row.payload)).not.toContain(rawToken);

    const { data: tokenRow } = await admin
      .from("appointment_management_tokens")
      .select("*")
      .eq("email_outbox_id", row.id)
      .single();
    expect(JSON.stringify(tokenRow)).not.toContain(rawToken);
  });
});

/**
 * Wraps a real service-role client so the first N "status: sent" finalize
 * updates on email_outbox fail — everything else (the claim RPC, the
 * token-mint RPC, other table reads/writes) passes through to the real
 * client untouched. Explicitly binds/delegates rather than using
 * Object.create/prototypal tricks, which risk breaking on supabase-js
 * internals that rely on the exact client instance (e.g. private class
 * fields).
 */
function wrapClientFailingFirstSentFinalize(
  client: SupabaseClient<Database>,
  failCount: number,
): SupabaseClient<Database> {
  let remaining = failCount;
  const boundRpc = client.rpc.bind(client);
  const realFrom = client.from.bind(client);

  function fakeFrom(table: "email_outbox") {
    const builder = realFrom(table);
    // Test-only double: intentionally untyped so it can intercept
    // .update() on the real PostgrestQueryBuilder without fighting its
    // generic row typing.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalUpdate = (builder as any).update.bind(builder);

    return Object.assign(Object.create(builder), {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update(values: any) {
        if (values?.status === "sent" && remaining > 0) {
          remaining -= 1;
          const failingBuilder: {
            eq: () => typeof failingBuilder;
            then: (resolve: (value: { data: null; error: { message: string } }) => void) => void;
          } = {
            eq: () => failingBuilder,
            then: (resolve) => resolve({ data: null, error: { message: "simulated local write failure" } }),
          };
          return failingBuilder;
        }
        return originalUpdate(values);
      },
    });
  }

  const fake = {
    rpc: boundRpc,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: fakeFrom as any,
  };

  return fake as unknown as SupabaseClient<Database>;
}
