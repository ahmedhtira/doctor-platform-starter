import { createHash, randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  cleanupUsers,
  createDoctorFixture,
  createServiceRoleClient,
  type DoctorFixture,
} from "./fixtures";

const LOCAL_DATE = "2030-05-01";
const DAY_OF_WEEK = new Date(`${LOCAL_DATE}T00:00:00Z`).getUTCDay();

function sha256(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function randomSecretHash(): string {
  return sha256(randomBytes(32).toString("hex"));
}

describe("management token redemption and session-based cancellation", () => {
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

  async function bookWithToken(
    doctor: DoctorFixture,
    startsAt: string,
    tokenHash: string,
    expiresAt: string,
  ) {
    const { data, error } = await admin.rpc("book_appointment", {
      p_doctor_id: doctor.doctorId,
      p_clinic_id: doctor.clinicId,
      p_appointment_type_id: doctor.appointmentTypeId,
      p_starts_at: startsAt,
      p_patient_name: "Patient Test",
      p_patient_phone: "+21600000000",
      p_patient_email: null,
      p_management_token_hash: tokenHash,
      p_management_token_expires_at: expiresAt,
    });
    if (error) throw new Error(`book_appointment failed: ${error.message}`);
    return data;
  }

  // Redeeming now requires the caller to supply the hash of an
  // independently-generated session secret (see migration
  // 20260101000019_management_session_secret_hash.sql) — the DB row's own
  // `id` is never the credential. Tests that only care about the token
  // side of redemption still pass a throwaway secret hash to satisfy the
  // (required) parameter.
  async function redeem(tokenHash: string) {
    const secretHash = randomSecretHash();
    const result = await admin.rpc("redeem_management_token", {
      p_token_hash: tokenHash,
      p_session_secret_hash: secretHash,
    });
    return { ...result, secretHash };
  }

  it("redeeming a valid token creates a short-lived session for the right appointment", async () => {
    const doctor = await setupDoctorWithHours();
    const hash = sha256(randomBytes(32).toString("hex"));
    const appt = await bookWithToken(
      doctor,
      `${LOCAL_DATE}T09:00:00Z`,
      hash,
      "2031-01-01T00:00:00Z",
    );

    const { data: session, error } = await redeem(hash);

    expect(error).toBeNull();
    expect(session.appointment_id).toBe(appt.id);
    expect(new Date(session.expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(session.expires_at).getTime()).toBeLessThanOrEqual(Date.now() + 31 * 60 * 1000);
  });

  it("never returns or stores the raw token — only its hash", async () => {
    const doctor = await setupDoctorWithHours();
    const raw = randomBytes(32).toString("hex");
    const hash = sha256(raw);
    await bookWithToken(doctor, `${LOCAL_DATE}T09:30:00Z`, hash, "2031-01-01T00:00:00Z");

    const { data: row, error } = await admin
      .from("appointment_management_tokens")
      .select("token_hash")
      .eq("token_hash", hash)
      .single();

    expect(error).toBeNull();
    expect(row?.token_hash).toBe(hash);
    expect(row?.token_hash).not.toBe(raw);
    expect(row).not.toHaveProperty("raw_token");
  });

  it("rejects redemption of an invalid (unknown) token hash", async () => {
    const { error } = await redeem(sha256("never-issued"));
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
    expect(error?.message).toBe("invalid or expired token");
  });

  it("rejects redemption of an expired token, with the same generic error as an invalid one", async () => {
    const doctor = await setupDoctorWithHours();
    const hash = sha256(randomBytes(32).toString("hex"));
    await bookWithToken(doctor, `${LOCAL_DATE}T10:00:00Z`, hash, "2020-01-01T00:00:00Z"); // already expired

    const { error } = await redeem(hash);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
    expect(error?.message).toBe("invalid or expired token");
  });

  it("rejects redemption of an already-used token, with the same generic error", async () => {
    const doctor = await setupDoctorWithHours();
    const hash = sha256(randomBytes(32).toString("hex"));
    await bookWithToken(doctor, `${LOCAL_DATE}T10:30:00Z`, hash, "2031-01-01T00:00:00Z");

    const first = await redeem(hash);
    expect(first.error).toBeNull();

    const second = await redeem(hash);
    expect(second.error).not.toBeNull();
    expect(second.error?.code).toBe("42501");
    expect(second.error?.message).toBe("invalid or expired token");
  });

  it("rejects redemption of a revoked token (invalidated by a reschedule), with the same generic error", async () => {
    const doctor = await setupDoctorWithHours();
    const hash = sha256(randomBytes(32).toString("hex"));
    const appt = await bookWithToken(
      doctor,
      `${LOCAL_DATE}T11:00:00Z`,
      hash,
      "2031-01-01T00:00:00Z",
    );

    const { error: rescheduleError } = await admin.rpc("reschedule_appointment", {
      p_appointment_id: appt.id,
      p_new_starts_at: `${LOCAL_DATE}T13:00:00Z`,
      p_actor_user_id: doctor.user.id,
    });
    expect(rescheduleError).toBeNull();

    const { error } = await redeem(hash);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
    expect(error?.message).toBe("invalid or expired token");
  });

  it("a session can only cancel its own appointment, not another one", async () => {
    const doctor = await setupDoctorWithHours();
    const hashA = sha256(randomBytes(32).toString("hex"));
    const apptA = await bookWithToken(
      doctor,
      `${LOCAL_DATE}T14:00:00Z`,
      hashA,
      "2031-01-01T00:00:00Z",
    );
    const hashB = sha256(randomBytes(32).toString("hex"));
    const apptB = await bookWithToken(
      doctor,
      `${LOCAL_DATE}T15:00:00Z`,
      hashB,
      "2031-01-01T00:00:00Z",
    );

    const { error: redeemError, secretHash } = await redeem(hashA);
    expect(redeemError).toBeNull();

    const crossAttempt = await admin.rpc("cancel_appointment", {
      p_appointment_id: apptB.id,
      p_management_session_secret_hash: secretHash,
    });
    expect(crossAttempt.error).not.toBeNull();
    expect(crossAttempt.error?.code).toBe("42501");

    const ownAttempt = await admin.rpc("cancel_appointment", {
      p_appointment_id: apptA.id,
      p_management_session_secret_hash: secretHash,
    });
    expect(ownAttempt.error).toBeNull();
    expect(ownAttempt.data.status).toBe("cancelled");
  });

  it("an expired session cannot cancel", async () => {
    const doctor = await setupDoctorWithHours();
    const hash = sha256(randomBytes(32).toString("hex"));
    // 09:00-17:00 Tunis = 08:00-16:00 UTC; a 30-min appointment must start
    // no later than 15:30 UTC to end by close.
    const appt = await bookWithToken(
      doctor,
      `${LOCAL_DATE}T12:00:00Z`,
      hash,
      "2031-01-01T00:00:00Z",
    );

    const { data: session, secretHash } = await redeem(hash);
    await admin
      .from("appointment_management_sessions")
      .update({ expires_at: "2020-01-01T00:00:00Z" })
      .eq("id", session.id);

    const { error } = await admin.rpc("cancel_appointment", {
      p_appointment_id: appt.id,
      p_management_session_secret_hash: secretHash,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("successful cancellation changes status and cannot be repeated", async () => {
    const doctor = await setupDoctorWithHours();
    const hash = sha256(randomBytes(32).toString("hex"));
    const appt = await bookWithToken(
      doctor,
      `${LOCAL_DATE}T09:00:00Z`,
      hash,
      "2031-01-01T00:00:00Z",
    );
    const { secretHash } = await redeem(hash);

    const first = await admin.rpc("cancel_appointment", {
      p_appointment_id: appt.id,
      p_management_session_secret_hash: secretHash,
    });
    expect(first.error).toBeNull();
    expect(first.data.status).toBe("cancelled");

    const second = await admin.rpc("cancel_appointment", {
      p_appointment_id: appt.id,
      p_management_session_secret_hash: secretHash,
    });
    expect(second.error).not.toBeNull();
    expect(second.error?.code).toBe("55000");
  });
});
