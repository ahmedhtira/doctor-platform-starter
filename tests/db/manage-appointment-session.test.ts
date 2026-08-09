import { createHash, randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  cleanupUsers,
  createDoctorFixture,
  createServiceRoleClient,
  type DoctorFixture,
} from "./fixtures";

// 09:00-17:00 Tunis = 08:00-16:00 UTC; a 30-min appointment must start no
// later than 15:30 UTC to end by close (same constraint as
// reschedule-appointment.test.ts / management-tokens.test.ts).
const LOCAL_DATE = "2030-06-03";
const DAY_OF_WEEK = new Date(`${LOCAL_DATE}T00:00:00Z`).getUTCDay();

function sha256(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function randomHex(): string {
  return randomBytes(32).toString("hex");
}

describe("management sessions are secret-hash-based, not row-id-based", () => {
  const admin = createServiceRoleClient();
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

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

  async function bookWithToken(doctor: DoctorFixture, startsAt: string) {
    const tokenHash = sha256(randomHex());
    const { data, error } = await admin.rpc("book_appointment", {
      p_doctor_id: doctor.doctorId,
      p_clinic_id: doctor.clinicId,
      p_appointment_type_id: doctor.appointmentTypeId,
      p_starts_at: startsAt,
      p_patient_name: "Patient Test",
      p_patient_phone: "+21600000000",
      p_patient_email: null,
      p_management_token_hash: tokenHash,
      p_management_token_expires_at: "2031-01-01T00:00:00Z",
    });
    if (error) throw new Error(`book_appointment failed: ${error.message}`);
    return { appointment: data, tokenHash };
  }

  async function redeem(tokenHash: string) {
    const rawSecret = randomHex();
    const secretHash = sha256(rawSecret);
    const { data: session, error } = await admin.rpc("redeem_management_token", {
      p_token_hash: tokenHash,
      p_session_secret_hash: secretHash,
    });
    if (error) throw new Error(`redeem_management_token failed: ${error.message}`);
    return { session, rawSecret, secretHash };
  }

  it("reschedules successfully via a session secret hash, distinct from the session row's own id", async () => {
    const doctor = await setupDoctorWithHours();
    const { appointment, tokenHash } = await bookWithToken(doctor, `${LOCAL_DATE}T09:00:00Z`);
    const { session, secretHash } = await redeem(tokenHash);

    expect(secretHash).not.toBe(session.id);

    const { data, error } = await admin.rpc("reschedule_appointment", {
      p_appointment_id: appointment.id,
      p_new_starts_at: `${LOCAL_DATE}T10:00:00Z`,
      p_management_session_secret_hash: secretHash,
    });

    expect(error).toBeNull();
    expect(new Date(data.starts_at).toISOString()).toBe(`${LOCAL_DATE}T10:00:00.000Z`);
  });

  it("rejects a session-secret reschedule scoped to a different appointment", async () => {
    const doctor = await setupDoctorWithHours();
    const { appointment: apptA } = await bookWithToken(doctor, `${LOCAL_DATE}T09:00:00Z`);
    const { tokenHash: tokenHashB } = await bookWithToken(doctor, `${LOCAL_DATE}T11:00:00Z`);
    const { secretHash } = await redeem(tokenHashB);

    const { error } = await admin.rpc("reschedule_appointment", {
      p_appointment_id: apptA.id,
      p_new_starts_at: `${LOCAL_DATE}T13:00:00Z`,
      p_management_session_secret_hash: secretHash,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("rejects a reschedule via an expired session", async () => {
    const doctor = await setupDoctorWithHours();
    const { appointment, tokenHash } = await bookWithToken(doctor, `${LOCAL_DATE}T14:00:00Z`);
    const { session, secretHash } = await redeem(tokenHash);
    await admin
      .from("appointment_management_sessions")
      .update({ expires_at: "2020-01-01T00:00:00Z" })
      .eq("id", session.id);

    const { error } = await admin.rpc("reschedule_appointment", {
      p_appointment_id: appointment.id,
      p_new_starts_at: `${LOCAL_DATE}T15:00:00Z`,
      p_management_session_secret_hash: secretHash,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("rejects a reschedule of an appointment that is no longer confirmed", async () => {
    const doctor = await setupDoctorWithHours();
    const { appointment, tokenHash } = await bookWithToken(doctor, `${LOCAL_DATE}T09:30:00Z`);
    const { secretHash } = await redeem(tokenHash);

    const { error: cancelError } = await admin.rpc("cancel_appointment", {
      p_appointment_id: appointment.id,
      p_management_session_secret_hash: secretHash,
    });
    expect(cancelError).toBeNull();

    const { error } = await admin.rpc("reschedule_appointment", {
      p_appointment_id: appointment.id,
      p_new_starts_at: `${LOCAL_DATE}T10:30:00Z`,
      p_management_session_secret_hash: secretHash,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("55000");
  });

  it("rotates the management token on a session-secret reschedule: old token burned, exactly one new valid token issued", async () => {
    const doctor = await setupDoctorWithHours();
    const { appointment, tokenHash: oldTokenHash } = await bookWithToken(
      doctor,
      `${LOCAL_DATE}T11:30:00Z`,
    );
    const { secretHash } = await redeem(oldTokenHash);

    const newTokenHash = sha256(randomHex());
    const { error: rescheduleError } = await admin.rpc("reschedule_appointment", {
      p_appointment_id: appointment.id,
      p_new_starts_at: `${LOCAL_DATE}T13:30:00Z`,
      p_management_session_secret_hash: secretHash,
      p_new_management_token_hash: newTokenHash,
      p_new_management_token_expires_at: "2031-01-01T00:00:00Z",
    });
    expect(rescheduleError).toBeNull();

    const { data: tokens, error: tokensError } = await admin
      .from("appointment_management_tokens")
      .select("token_hash, used_at")
      .eq("appointment_id", appointment.id);
    expect(tokensError).toBeNull();

    const validTokens = (tokens ?? []).filter((row) => row.used_at === null);
    expect(validTokens).toHaveLength(1);
    expect(validTokens[0]?.token_hash).toBe(newTokenHash);

    const oldRow = tokens?.find((row) => row.token_hash === oldTokenHash);
    expect(oldRow?.used_at).not.toBeNull();
  });

  it("never stores the raw session secret anywhere in Postgres — only its hash", async () => {
    const doctor = await setupDoctorWithHours();
    const { tokenHash } = await bookWithToken(doctor, `${LOCAL_DATE}T15:00:00Z`);
    const { session, rawSecret, secretHash } = await redeem(tokenHash);

    const { data: row, error } = await admin
      .from("appointment_management_sessions")
      .select("*")
      .eq("id", session.id)
      .single();

    expect(error).toBeNull();
    expect(row?.session_secret_hash).toBe(secretHash);
    expect(row?.session_secret_hash).not.toBe(rawSecret);
    expect(Object.values(row ?? {})).not.toContain(rawSecret);
  });

  it("rejects a forged/modified session secret — a guessed value cannot authorize access", async () => {
    const doctor = await setupDoctorWithHours();
    const { appointment, tokenHash } = await bookWithToken(doctor, `${LOCAL_DATE}T09:00:00Z`);
    const { rawSecret } = await redeem(tokenHash);

    // Flip the last character of a real, currently-valid raw secret and
    // hash *that* — simulates an attacker guessing/tampering with a cookie
    // value rather than possessing the genuine one.
    const forgedRawSecret = rawSecret.slice(0, -1) + (rawSecret.at(-1) === "0" ? "1" : "0");
    const forgedHash = sha256(forgedRawSecret);

    const { error } = await admin.rpc("cancel_appointment", {
      p_appointment_id: appointment.id,
      p_management_session_secret_hash: forgedHash,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });
});
