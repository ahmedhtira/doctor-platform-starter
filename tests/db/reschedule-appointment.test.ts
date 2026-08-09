import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupUsers,
  createDoctorFixture,
  createServiceRoleClient,
  type DoctorFixture,
} from "./fixtures";

const LOCAL_DATE = "2030-04-01";
const DAY_OF_WEEK = new Date(`${LOCAL_DATE}T00:00:00Z`).getUTCDay();

function sha256(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

describe("reschedule_appointment", () => {
  const admin = createServiceRoleClient();
  const userIds: string[] = [];
  let otherDoctor: DoctorFixture;

  beforeAll(async () => {
    otherDoctor = await createDoctorFixture(admin);
    userIds.push(otherDoctor.user.id);
  });

  afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

  // Each scenario gets its own doctor so appointments/schedules from one
  // test can never collide with another.
  async function setupDoctorWithHours(): Promise<DoctorFixture> {
    const doctor = await createDoctorFixture(admin);
    userIds.push(doctor.user.id);
    const { error } = await admin.from("working_hours").insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      day_of_week: DAY_OF_WEEK,
      start_time: "09:00",
      end_time: "17:00",
    });
    if (error) throw new Error(`failed to insert working_hours: ${error.message}`);
    return doctor;
  }

  async function bookAppointment(
    doctor: DoctorFixture,
    startsAt: string,
    extra: Record<string, unknown> = {},
  ) {
    const { data, error } = await admin.rpc("book_appointment", {
      p_doctor_id: doctor.doctorId,
      p_clinic_id: doctor.clinicId,
      p_appointment_type_id: doctor.appointmentTypeId,
      p_starts_at: startsAt,
      p_patient_name: "Patient Test",
      p_patient_phone: "+21600000000",
      p_patient_email: null,
      ...extra,
    });
    if (error) throw new Error(`book_appointment failed: ${error.message}`);
    return data;
  }

  it("succeeds for a valid, non-overlapping, in-hours reschedule", async () => {
    const doctor = await setupDoctorWithHours();
    const appt = await bookAppointment(doctor, `${LOCAL_DATE}T09:00:00Z`); // 10:00 Tunis

    const { data, error } = await admin.rpc("reschedule_appointment", {
      p_appointment_id: appt.id,
      p_new_starts_at: `${LOCAL_DATE}T10:00:00Z`,
      p_actor_user_id: doctor.user.id,
    });

    expect(error).toBeNull();
    expect(new Date(data.starts_at).toISOString()).toBe(`${LOCAL_DATE}T10:00:00.000Z`);
  });

  it("rejects a reschedule that overlaps another confirmed appointment", async () => {
    const doctor = await setupDoctorWithHours();
    const apptA = await bookAppointment(doctor, `${LOCAL_DATE}T09:00:00Z`);
    await bookAppointment(doctor, `${LOCAL_DATE}T10:00:00Z`);

    const { error } = await admin.rpc("reschedule_appointment", {
      p_appointment_id: apptA.id,
      p_new_starts_at: `${LOCAL_DATE}T10:00:00Z`,
      p_actor_user_id: doctor.user.id,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23P01");
  });

  it("rejects a reschedule to an out-of-hours time", async () => {
    const doctor = await setupDoctorWithHours();
    const appt = await bookAppointment(doctor, `${LOCAL_DATE}T09:00:00Z`);

    const { error } = await admin.rpc("reschedule_appointment", {
      p_appointment_id: appt.id,
      p_new_starts_at: `${LOCAL_DATE}T20:00:00Z`, // 21:00 Tunis, after 17:00 close
      p_actor_user_id: doctor.user.id,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("55001");
  });

  it("rejects a reschedule into a blocked period", async () => {
    const doctor = await setupDoctorWithHours();
    const appt = await bookAppointment(doctor, `${LOCAL_DATE}T09:00:00Z`);
    await admin.from("blocked_periods").insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      starts_at: `${LOCAL_DATE}T12:00:00Z`,
      ends_at: `${LOCAL_DATE}T12:30:00Z`,
      reason: "vacation",
    });

    const { error } = await admin.rpc("reschedule_appointment", {
      p_appointment_id: appt.id,
      p_new_starts_at: `${LOCAL_DATE}T12:00:00Z`,
      p_actor_user_id: doctor.user.id,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("55001");
  });

  it("rejects reschedule by an actor who is not staff for this doctor", async () => {
    const doctor = await setupDoctorWithHours();
    const appt = await bookAppointment(doctor, `${LOCAL_DATE}T09:00:00Z`);

    const { error } = await admin.rpc("reschedule_appointment", {
      p_appointment_id: appt.id,
      p_new_starts_at: `${LOCAL_DATE}T10:00:00Z`,
      p_actor_user_id: otherDoctor.user.id,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("invalidates the old management token on reschedule and supports rotating to a new one", async () => {
    const doctor = await setupDoctorWithHours();
    const oldHash = sha256(randomBytes(32).toString("hex"));
    const appt = await bookAppointment(doctor, `${LOCAL_DATE}T09:00:00Z`, {
      p_management_token_hash: oldHash,
      p_management_token_expires_at: "2031-01-01T00:00:00Z",
    });

    const newHash = sha256(randomBytes(32).toString("hex"));
    const { error: rescheduleError } = await admin.rpc("reschedule_appointment", {
      p_appointment_id: appt.id,
      p_new_starts_at: `${LOCAL_DATE}T11:00:00Z`,
      p_actor_user_id: doctor.user.id,
      p_new_management_token_hash: newHash,
      p_new_management_token_expires_at: "2031-01-01T00:00:00Z",
    });
    expect(rescheduleError).toBeNull();

    const oldRedeem = await admin.rpc("redeem_management_token", {
      p_token_hash: oldHash,
      p_session_secret_hash: sha256(randomBytes(32).toString("hex")),
    });
    expect(oldRedeem.error).not.toBeNull();

    const newRedeem = await admin.rpc("redeem_management_token", {
      p_token_hash: newHash,
      p_session_secret_hash: sha256(randomBytes(32).toString("hex")),
    });
    expect(newRedeem.error).toBeNull();
    expect(newRedeem.data.appointment_id).toBe(appt.id);
  });
});
