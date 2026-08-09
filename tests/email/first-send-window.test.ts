import { afterAll, describe, expect, it } from "vitest";
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

// Proves the 23h Resend-idempotency retry window (PROJECT_SPEC.md's M7
// section, final correction): first_send_attempt_at is set exactly once,
// never touched by later attempts, and a retry landing after the window
// refuses to call the provider at all.

describe("23h idempotency retry window (M7)", () => {
  const admin = createTypedServiceRoleClient();
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

  it("the first send attempt sets first_send_attempt_at", async () => {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    const booked = await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T09:00:00Z`);
    const [before] = await getOutboxRowsForAppointment(admin, booked.appointment.id);
    expect(before.first_send_attempt_at).toBeNull();

    const { sender } = createFakeEmailSender();
    await processEmailOutbox(admin, sender, { limit: 100, maxAttempts: 5 });

    const [after] = await getOutboxRowsForAppointment(admin, booked.appointment.id);
    expect(after.first_send_attempt_at).not.toBeNull();
  });

  it("a retry over the same (still-pending) row leaves first_send_attempt_at unchanged", async () => {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    const booked = await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T10:00:00Z`);

    const { sender: failingSender } = createFakeEmailSender({ failFirstNCalls: 1000 });
    await processEmailOutbox(admin, failingSender, { limit: 100, maxAttempts: 5 });
    const [afterFirst] = await getOutboxRowsForAppointment(admin, booked.appointment.id);
    expect(afterFirst.first_send_attempt_at).not.toBeNull();

    const { sender: succeedingSender } = createFakeEmailSender();
    await processEmailOutbox(admin, succeedingSender, { limit: 100, maxAttempts: 5 });
    const [afterSecond] = await getOutboxRowsForAppointment(admin, booked.appointment.id);

    expect(afterSecond.first_send_attempt_at).toBe(afterFirst.first_send_attempt_at);
  });

  it("a retry inside the 23h window still produces the same provider payload/idempotency key", async () => {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    const booked = await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T11:00:00Z`);
    const [outboxRow] = await getOutboxRowsForAppointment(admin, booked.appointment.id);

    // Backdate first_send_attempt_at to 20h ago — still inside the 23h window.
    await admin
      .from("email_outbox")
      .update({ first_send_attempt_at: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString() })
      .eq("id", outboxRow.id);

    const { sender, calls } = createFakeEmailSender();
    const summary = await processEmailOutbox(admin, sender, { limit: 100, maxAttempts: 5 });

    expect(summary.sent).toBeGreaterThanOrEqual(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].idempotencyKey).toBe(`doctor-platform-email/${outboxRow.id}`);
  });

  it("a retry after the 23h window never calls the sender and finalizes the row failed", async () => {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    const booked = await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T12:00:00Z`);
    const [outboxRow] = await getOutboxRowsForAppointment(admin, booked.appointment.id);

    // Backdate first_send_attempt_at to 24h ago — past the 23h window.
    await admin
      .from("email_outbox")
      .update({
        status: "pending",
        first_send_attempt_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      })
      .eq("id", outboxRow.id);

    const { sender, calls } = createFakeEmailSender();
    await processEmailOutbox(admin, sender, { limit: 100, maxAttempts: 5 });

    expect(calls).toHaveLength(0);
    const [rowAfter] = await getOutboxRowsForAppointment(admin, booked.appointment.id);
    expect(rowAfter.status).toBe("failed");
    expect(rowAfter.last_error).toBe("provider idempotency retry window expired");
  });
});
