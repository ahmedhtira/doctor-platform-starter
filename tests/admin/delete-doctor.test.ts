import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getTestSupabaseServiceRoleKey, getTestSupabaseUrl } from "../db/env";
import { cleanupUsers, createDoctorFixture } from "../db/fixtures";
import { bookAppointment } from "@/lib/booking/book-appointment";
import { deleteDoctor } from "@/lib/admin/delete-doctor";
import type { Database } from "@/lib/supabase/database.types";
import { defaultDoctorServiceSettings, serviceSettingsPayload } from "@/lib/admin/doctor-service-settings";

function createTypedServiceRoleClient(): SupabaseClient<Database> {
  return createClient<Database>(getTestSupabaseUrl(), getTestSupabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const LOCAL_DATE = "2031-06-03";
const DAY_OF_WEEK = new Date(`${LOCAL_DATE}T00:00:00Z`).getUTCDay();

describe("deleteDoctor (M10)", () => {
  const admin = createTypedServiceRoleClient();
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

  it("hard-deletes a doctor who has never been booked", async () => {
    const doctor = await createDoctorFixture(admin);
    userIds.push(doctor.user.id);

    const result = await deleteDoctor(admin, { doctorId: doctor.doctorId });
    expect(result.mode).toBe("hard");

    const { data: doctorRow } = await admin.from("doctors").select("id").eq("id", doctor.doctorId).maybeSingle();
    expect(doctorRow).toBeNull();

    const { data: userData, error: userError } = await admin.auth.admin.getUserById(doctor.user.id);
    expect(userData?.user ?? null).toBeNull();
    expect(userError).not.toBeNull();
  });

  it("soft-deletes a doctor with appointment history: preserves the appointment, scrubs PII, removes leaf tables, bans (not deletes) the auth account", async () => {
    const doctor = await createDoctorFixture(admin);
    userIds.push(doctor.user.id);
    const { error: hoursError } = await admin.from("working_hours").insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      day_of_week: DAY_OF_WEEK,
      start_time: "09:00",
      end_time: "17:00",
    });
    if (hoursError) throw new Error(`failed to insert working_hours: ${hoursError.message}`);

    const booked = await bookAppointment(admin, {
      doctorId: doctor.doctorId,
      clinicId: doctor.clinicId,
      appointmentTypeId: doctor.appointmentTypeId,
      startsAt: `${LOCAL_DATE}T09:00:00Z`,
      patientName: "Delete Test Patient",
      patientPhone: "+216 71 000 030",
      patientEmail: "delete-doctor-patient@example.test",
    });

    const configured = await admin.rpc("update_doctor_with_services", {
      p_doctor_id: doctor.doctorId,
      p_services: serviceSettingsPayload({
        ...defaultDoctorServiceSettings,
        sosEnabled: true, sosPhone: "+216 70 123 456", sosArea: "Tunis",
        paymentRequired: true, paymentAmount: "20", paymentTerms: "Test terms",
        accountReference: "private-reference",
      }),
    });
    expect(configured.error).toBeNull();
    const result = await deleteDoctor(admin, { doctorId: doctor.doctorId });
    expect(result.mode).toBe("soft");

    const { data: doctorRow } = await admin
      .from("doctors")
      .select("suspended_at, deleted_at, is_published, bio, phone, full_name, slug, sos_enabled, sos_phone, sos_area, payment_required, payment_amount_millimes, payment_terms")
      .eq("id", doctor.doctorId)
      .single();
    expect(doctorRow!.suspended_at).not.toBeNull();
    expect(doctorRow!.deleted_at).not.toBeNull();
    expect(doctorRow!.is_published).toBe(false);
    expect(doctorRow!.bio).toBeNull();
    expect(doctorRow!.phone).toBeNull();
    expect(doctorRow!.full_name).toBe("Dr. Test");
    expect(doctorRow!.slug).not.toBeNull();
    expect(doctorRow).toMatchObject({
      sos_enabled: false, sos_phone: null, sos_area: null,
      payment_required: false, payment_amount_millimes: null, payment_terms: null,
    });
    const remainingAccount = await admin.from("doctor_payment_accounts")
      .select("doctor_id").eq("doctor_id", doctor.doctorId);
    expect(remainingAccount.error).toBeNull();
    expect(remainingAccount.data).toEqual([]);

    const { data: appointmentRow } = await admin
      .from("appointments")
      .select("id, status")
      .eq("id", booked.appointment.id)
      .single();
    expect(appointmentRow!.id).toBe(booked.appointment.id);

    const { data: remainingHours } = await admin
      .from("working_hours")
      .select("id")
      .eq("doctor_id", doctor.doctorId);
    expect(remainingHours).toHaveLength(0);

    const { data: userData, error: userError } = await admin.auth.admin.getUserById(doctor.user.id);
    expect(userError).toBeNull();
    expect(userData!.user).not.toBeNull();
    expect(userData!.user!.banned_until).toBeTruthy();
    expect(new Date(userData!.user!.banned_until!).getTime()).toBeGreaterThan(Date.now() + 1000 * 60 * 60 * 24 * 365);
  });

  it("throws NOT_FOUND for a nonexistent doctor id", async () => {
    await expect(
      deleteDoctor(admin, { doctorId: "00000000-0000-0000-0000-000000000099" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
