import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupUsers,
  createDoctorFixture,
  createSecretaryFixture,
  createServiceRoleClient,
  type DoctorFixture,
} from "./fixtures";

// Composite ownership FKs guarantee clinic_id/appointment_type_id/
// created_by_secretary_id on an appointment all actually belong to
// doctor_id — not just to *some* clinic/type/secretary. Exercised via
// direct inserts as service_role, since appointments has no INSERT RLS
// policy at all (service_role is the only client that reaches the table
// directly — see PROJECT_SPEC.md).
describe("composite foreign keys", () => {
  const admin = createServiceRoleClient();
  const userIds: string[] = [];

  let doctorA: DoctorFixture;
  let doctorB: DoctorFixture;
  let secretaryA: Awaited<ReturnType<typeof createSecretaryFixture>>;

  const baseAppointment = (overrides: Record<string, unknown>) => ({
    patient_name: "Patient Test",
    patient_phone: "+21600000000",
    starts_at: "2030-02-01T09:00:00Z",
    ends_at: "2030-02-01T09:30:00Z",
    status: "confirmed",
    ...overrides,
  });

  beforeAll(async () => {
    doctorA = await createDoctorFixture(admin);
    doctorB = await createDoctorFixture(admin);
    secretaryA = await createSecretaryFixture(admin, doctorA.doctorId);
    userIds.push(doctorA.user.id, doctorB.user.id, secretaryA.user.id);
  });

  afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

  it("rejects a clinic_id that belongs to a different doctor", async () => {
    const { error } = await admin.from("appointments").insert(
      baseAppointment({
        doctor_id: doctorA.doctorId,
        clinic_id: doctorB.clinicId,
        appointment_type_id: doctorA.appointmentTypeId,
      }),
    );
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23503");
  });

  it("rejects an appointment_type_id that belongs to a different doctor", async () => {
    const { error } = await admin.from("appointments").insert(
      baseAppointment({
        doctor_id: doctorA.doctorId,
        clinic_id: doctorA.clinicId,
        appointment_type_id: doctorB.appointmentTypeId,
      }),
    );
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23503");
  });

  it("rejects a created_by_secretary_id that belongs to a different doctor", async () => {
    const { error } = await admin.from("appointments").insert(
      baseAppointment({
        doctor_id: doctorB.doctorId,
        clinic_id: doctorB.clinicId,
        appointment_type_id: doctorB.appointmentTypeId,
        created_by_secretary_id: secretaryA.user.id,
      }),
    );
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23503");
  });

  it("accepts a clinic/type/secretary combo that all belong to the same doctor", async () => {
    const { error } = await admin.from("appointments").insert(
      baseAppointment({
        doctor_id: doctorA.doctorId,
        clinic_id: doctorA.clinicId,
        appointment_type_id: doctorA.appointmentTypeId,
        created_by_secretary_id: secretaryA.user.id,
        starts_at: "2030-02-01T10:00:00Z",
        ends_at: "2030-02-01T10:30:00Z",
      }),
    );
    expect(error).toBeNull();
  });

  it("accepts a null created_by_secretary_id (patient-initiated booking)", async () => {
    const { error } = await admin.from("appointments").insert(
      baseAppointment({
        doctor_id: doctorA.doctorId,
        clinic_id: doctorA.clinicId,
        appointment_type_id: doctorA.appointmentTypeId,
        created_by_secretary_id: null,
        starts_at: "2030-02-01T11:00:00Z",
        ends_at: "2030-02-01T11:30:00Z",
      }),
    );
    expect(error).toBeNull();
  });
});
