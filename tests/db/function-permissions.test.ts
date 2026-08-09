import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupUsers,
  createAnonClient,
  createDoctorFixture,
  createSecretaryFixture,
  createServiceRoleClient,
  type DoctorFixture,
} from "./fixtures";

function sha256(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

describe("function permissions", () => {
  const admin = createServiceRoleClient();
  const userIds: string[] = [];

  let doctorA: DoctorFixture;
  let doctorB: DoctorFixture;
  let secretaryA: Awaited<ReturnType<typeof createSecretaryFixture>>;

  const bookingArgs = (doctor: DoctorFixture, startsAt: string) => ({
    p_doctor_id: doctor.doctorId,
    p_clinic_id: doctor.clinicId,
    p_appointment_type_id: doctor.appointmentTypeId,
    p_starts_at: startsAt,
    p_patient_name: "Patient Test",
    p_patient_phone: "+21600000000",
    p_patient_email: null,
  });

  beforeAll(async () => {
    doctorA = await createDoctorFixture(admin);
    doctorB = await createDoctorFixture(admin);
    secretaryA = await createSecretaryFixture(admin, doctorA.doctorId);
    userIds.push(doctorA.user.id, doctorB.user.id, secretaryA.user.id);

    // book_appointment validates the requested time against working_hours —
    // cover the whole day so every fixed test time below is in-hours.
    await admin.from("working_hours").insert({
      doctor_id: doctorA.doctorId,
      clinic_id: doctorA.clinicId,
      day_of_week: new Date("2030-01-07T00:00:00Z").getUTCDay(),
      start_time: "00:00",
      end_time: "23:59",
    });
  });

  afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

  it("denies anon execute on book_appointment", async () => {
    const anon = createAnonClient();
    const { error } = await anon.rpc(
      "book_appointment",
      bookingArgs(doctorA, "2030-01-07T10:00:00Z"),
    );
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("denies an authenticated doctor direct execute on book_appointment", async () => {
    const { error } = await doctorA.client.rpc(
      "book_appointment",
      bookingArgs(doctorA, "2030-01-07T10:00:00Z"),
    );
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("lets service_role book an appointment", async () => {
    const { data, error } = await admin.rpc(
      "book_appointment",
      bookingArgs(doctorA, "2030-01-07T10:00:00Z"),
    );
    expect(error).toBeNull();
    expect(data.status).toBe("confirmed");
    expect(data.doctor_id).toBe(doctorA.doctorId);
  });

  it("rejects a created_by_secretary_id that isn't actually a secretary for that doctor", async () => {
    const { error } = await admin.rpc("book_appointment", {
      ...bookingArgs(doctorA, "2030-01-07T11:00:00Z"),
      p_created_by_secretary_id: doctorB.user.id,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("accepts a created_by_secretary_id that is a secretary for that doctor", async () => {
    const { data, error } = await admin.rpc("book_appointment", {
      ...bookingArgs(doctorA, "2030-01-07T12:00:00Z"),
      p_created_by_secretary_id: secretaryA.user.id,
    });
    expect(error).toBeNull();
    expect(data.created_by_secretary_id).toBe(secretaryA.user.id);
  });

  it("denies anon/authenticated execute on cancel_appointment", async () => {
    const { data: booked } = await admin.rpc(
      "book_appointment",
      bookingArgs(doctorA, "2030-01-07T13:00:00Z"),
    );

    const anon = createAnonClient();
    const anonAttempt = await anon.rpc("cancel_appointment", {
      p_appointment_id: booked.id,
      p_actor_user_id: doctorA.user.id,
    });
    expect(anonAttempt.error?.code).toBe("42501");

    const authAttempt = await doctorA.client.rpc("cancel_appointment", {
      p_appointment_id: booked.id,
      p_actor_user_id: doctorA.user.id,
    });
    expect(authAttempt.error?.code).toBe("42501");
  });

  it("lets service_role cancel on behalf of the owning doctor", async () => {
    const { data: booked } = await admin.rpc(
      "book_appointment",
      bookingArgs(doctorA, "2030-01-07T14:00:00Z"),
    );

    const { data, error } = await admin.rpc("cancel_appointment", {
      p_appointment_id: booked.id,
      p_actor_user_id: doctorA.user.id,
    });
    expect(error).toBeNull();
    expect(data.status).toBe("cancelled");
  });

  it("rejects cancellation by an actor who isn't staff for that appointment's doctor", async () => {
    const { data: booked } = await admin.rpc(
      "book_appointment",
      bookingArgs(doctorA, "2030-01-07T15:00:00Z"),
    );

    const { error } = await admin.rpc("cancel_appointment", {
      p_appointment_id: booked.id,
      p_actor_user_id: doctorB.user.id,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("denies anon/authenticated execute on redeem_management_token", async () => {
    const redeemArgs = {
      p_token_hash: sha256("never-issued"),
      p_session_secret_hash: sha256(randomBytes(32).toString("hex")),
    };

    const anon = createAnonClient();
    const anonAttempt = await anon.rpc("redeem_management_token", redeemArgs);
    expect(anonAttempt.error?.code).toBe("42501");

    const authAttempt = await doctorA.client.rpc("redeem_management_token", redeemArgs);
    expect(authAttempt.error?.code).toBe("42501");
  });
});
