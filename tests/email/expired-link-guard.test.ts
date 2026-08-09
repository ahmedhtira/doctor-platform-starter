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
import { cancelStaffAppointment } from "@/lib/dashboard/cancel-staff-appointment";

// Proves the "refuse to send an already-dead link" guard
// (PROJECT_SPEC.md's M7 section): payload.starts_at is manipulated
// directly to simulate a badly-backlogged worker reaching a row long
// after the appointment's own 24h link lifetime has passed — booking
// itself always uses a future LOCAL_DATE, so this can't happen naturally
// within a test run.

async function setPayloadStartsAt(
  admin: ReturnType<typeof createTypedServiceRoleClient>,
  outboxRowId: string,
  startsAtIso: string,
) {
  const { data: row, error: readError } = await admin
    .from("email_outbox")
    .select("payload")
    .eq("id", outboxRowId)
    .single();
  if (readError) throw new Error(readError.message);

  const payload = { ...(row.payload as Record<string, unknown>), starts_at: startsAtIso };
  const { error: writeError } = await admin.from("email_outbox").update({ payload }).eq("id", outboxRowId);
  if (writeError) throw new Error(writeError.message);
}

describe("expired-link guard (M7)", () => {
  const admin = createTypedServiceRoleClient();
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

  it("a link-bearing row whose 24h window has already passed is finalized failed without sending", async () => {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    const booked = await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T09:00:00Z`);
    const [outboxRow] = await getOutboxRowsForAppointment(admin, booked.appointment.id);

    // 25 hours in the past — the 24h link window is already over.
    const longAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await setPayloadStartsAt(admin, outboxRow.id, longAgo);

    const { sender, calls } = createFakeEmailSender();
    await processEmailOutbox(admin, sender, { limit: 100, maxAttempts: 5 });

    expect(calls).toHaveLength(0);

    const [rowAfter] = await getOutboxRowsForAppointment(admin, booked.appointment.id);
    expect(rowAfter.status).toBe("failed");
    expect(rowAfter.last_error).toBe("management link would already be expired by send time");

    const { data: tokens, error } = await admin
      .from("appointment_management_tokens")
      .select("id")
      .eq("email_outbox_id", outboxRow.id);
    if (error) throw new Error(error.message);
    expect(tokens).toHaveLength(0);
  });

  it("a row just inside the 24h window still sends normally", async () => {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    const booked = await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T10:00:00Z`);
    const [outboxRow] = await getOutboxRowsForAppointment(admin, booked.appointment.id);

    // 23 hours in the past — 1 hour still left on the 24h link window.
    const almostExpired = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
    await setPayloadStartsAt(admin, outboxRow.id, almostExpired);

    const { sender, calls } = createFakeEmailSender();
    await processEmailOutbox(admin, sender, { limit: 100, maxAttempts: 5 });

    expect(calls).toHaveLength(1);
    const [rowAfter] = await getOutboxRowsForAppointment(admin, booked.appointment.id);
    expect(rowAfter.status).toBe("sent");
  });

  it("a cancellation row past the same nominal window still sends — it carries no link", async () => {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    const booked = await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T11:00:00Z`);
    await cancelStaffAppointment(admin, { appointmentId: booked.appointment.id, actorUserId: doctor.user.id });

    const rows = await getOutboxRowsForAppointment(admin, booked.appointment.id);
    const cancellationRow = rows.find((row) => row.template === "appointment_cancellation")!;
    const longAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await setPayloadStartsAt(admin, cancellationRow.id, longAgo);

    const { sender } = createFakeEmailSender();
    await processEmailOutbox(admin, sender, { limit: 100, maxAttempts: 5 });

    const rowsAfter = await getOutboxRowsForAppointment(admin, booked.appointment.id);
    const cancellationAfter = rowsAfter.find((row) => row.id === cancellationRow.id)!;
    expect(cancellationAfter.status).toBe("sent");
  });
});
