import { afterAll, describe, expect, it } from "vitest";
import { cleanupUsers } from "../db/fixtures";
import {
  createTypedServiceRoleClient,
  setupDoctorWithHours,
  bookForEmailTest,
  getOutboxRowsForAppointment,
  LOCAL_DATE,
} from "./fixtures";
import { redeemManagementToken } from "@/lib/booking/redeem-management-token";
import { rescheduleManagedAppointment } from "@/lib/booking/reschedule-managed-appointment";
import { hashSecret } from "@/lib/booking/crypto-secret";
import { cancelStaffAppointment } from "@/lib/dashboard/cancel-staff-appointment";
import { rescheduleStaffAppointment } from "@/lib/dashboard/reschedule-staff-appointment";

// Proves book_appointment/cancel_appointment/reschedule_appointment each
// enqueue exactly one correctly-shaped email_outbox row with the full
// snapshot payload (PROJECT_SPEC.md's M7 section) — and that a null
// patient_email suppresses the enqueue entirely, for all four paths.

const EXPECTED_PAYLOAD_KEYS = [
  "appointment_id",
  "doctor_name",
  "clinic_name",
  "clinic_address",
  "clinic_timezone",
  "appointment_type_name",
  "patient_name",
  "starts_at",
  "ends_at",
].sort();

describe("email_outbox enqueue (M7)", () => {
  const admin = createTypedServiceRoleClient();
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

  it("book_appointment enqueues appointment_confirmation with the full snapshot payload", async () => {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    const booked = await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T09:00:00Z`);

    const rows = await getOutboxRowsForAppointment(admin, booked.appointment.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].template).toBe("appointment_confirmation");
    expect(rows[0].status).toBe("pending");
    expect(Object.keys(rows[0].payload as object).sort()).toEqual(EXPECTED_PAYLOAD_KEYS);
    expect((rows[0].payload as Record<string, unknown>).appointment_id).toBe(booked.appointment.id);
  });

  it("book_appointment does not enqueue anything when patient_email is null", async () => {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    const booked = await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T09:30:00Z`, null);

    const rows = await getOutboxRowsForAppointment(admin, booked.appointment.id);
    expect(rows).toHaveLength(0);
  });

  it("cancel_appointment enqueues appointment_cancellation with the full snapshot payload", async () => {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    const booked = await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T10:00:00Z`);

    await cancelStaffAppointment(admin, {
      appointmentId: booked.appointment.id,
      actorUserId: doctor.user.id,
    });

    const rows = await getOutboxRowsForAppointment(admin, booked.appointment.id);
    expect(rows).toHaveLength(2); // confirmation + cancellation
    const cancellationRow = rows.find((row) => row.template === "appointment_cancellation");
    expect(cancellationRow).toBeDefined();
    expect(Object.keys(cancellationRow!.payload as object).sort()).toEqual(EXPECTED_PAYLOAD_KEYS);
  });

  it("cancel_appointment does not enqueue anything when patient_email is null", async () => {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    const booked = await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T10:30:00Z`, null);

    await cancelStaffAppointment(admin, {
      appointmentId: booked.appointment.id,
      actorUserId: doctor.user.id,
    });

    const rows = await getOutboxRowsForAppointment(admin, booked.appointment.id);
    expect(rows).toHaveLength(0);
  });

  it("reschedule_appointment (patient-initiated) enqueues appointment_reschedule_patient", async () => {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    const booked = await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T11:00:00Z`);
    const { sessionSecret } = await redeemManagementToken(admin, booked.managementToken);

    await rescheduleManagedAppointment(admin, {
      managementSessionSecretHash: hashSecret(sessionSecret),
      newStartsAt: `${LOCAL_DATE}T12:00:00Z`,
    });

    const rows = await getOutboxRowsForAppointment(admin, booked.appointment.id);
    const rescheduleRow = rows.find((row) => row.template === "appointment_reschedule_patient");
    expect(rescheduleRow).toBeDefined();
    expect(Object.keys(rescheduleRow!.payload as object).sort()).toEqual(EXPECTED_PAYLOAD_KEYS);
    expect((rescheduleRow!.payload as Record<string, unknown>).starts_at).toContain(`${LOCAL_DATE}T12:00:00`);
  });

  it("reschedule_appointment (staff-initiated) enqueues appointment_reschedule_staff", async () => {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    const booked = await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T13:00:00Z`);

    await rescheduleStaffAppointment(admin, {
      appointmentId: booked.appointment.id,
      actorUserId: doctor.user.id,
      newStartsAt: `${LOCAL_DATE}T14:00:00Z`,
    });

    const rows = await getOutboxRowsForAppointment(admin, booked.appointment.id);
    const rescheduleRow = rows.find((row) => row.template === "appointment_reschedule_staff");
    expect(rescheduleRow).toBeDefined();
    expect(Object.keys(rescheduleRow!.payload as object).sort()).toEqual(EXPECTED_PAYLOAD_KEYS);
  });

  it("reschedule_appointment does not enqueue anything when patient_email is null", async () => {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    const booked = await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T15:00:00Z`, null);

    await rescheduleStaffAppointment(admin, {
      appointmentId: booked.appointment.id,
      actorUserId: doctor.user.id,
      newStartsAt: `${LOCAL_DATE}T13:00:00Z`,
    });

    const rows = await getOutboxRowsForAppointment(admin, booked.appointment.id);
    expect(rows).toHaveLength(0);
  });
});
