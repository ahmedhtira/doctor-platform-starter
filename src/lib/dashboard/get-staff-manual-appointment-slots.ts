import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  computeAvailableSlots,
  type AvailableSlot,
} from "@/lib/availability/compute-available-slots";
import { ManageError } from "@/lib/booking/manage-errors";

export type GetStaffManualAppointmentSlotsInput = {
  doctorId: string;
  clinicId: string;
  appointmentTypeId: string;
  localDate: string;
  actorUserId: string;
  now: string;
};

/**
 * Staff-facing availability for manual bookings.
 *
 * This intentionally differs from public availability in two ways:
 * - unpublished doctors are still usable from their private dashboard;
 * - public minimum-booking notice is ignored for staff-entered bookings.
 *
 * It otherwise mirrors create_staff_appointment's schedule checks: clinic
 * working hours / exceptions, breaks, blocked periods, and confirmed
 * appointment overlaps. Authorization is re-checked here because this
 * function is called with a service-role client.
 */
export async function getStaffManualAppointmentSlots(
  supabase: SupabaseClient<Database>,
  input: GetStaffManualAppointmentSlotsInput,
): Promise<AvailableSlot[]> {
  const doctorResult = await supabase
    .from("doctors")
    .select("user_id, suspended_at, deleted_at")
    .eq("id", input.doctorId)
    .maybeSingle();

  if (doctorResult.error) {
    throw new Error(`Failed to load doctor for manual slots: ${doctorResult.error.message}`);
  }

  const doctor = doctorResult.data;
  if (!doctor) {
    throw new ManageError("SESSION_INVALID", "Doctor is not available.");
  }

  const secretaryResult = await supabase
    .from("doctor_secretaries")
    .select("secretary_user_id")
    .eq("doctor_id", input.doctorId)
    .eq("secretary_user_id", input.actorUserId)
    .maybeSingle();

  if (secretaryResult.error) {
    throw new Error(
      `Failed to verify staff access for manual slots: ${secretaryResult.error.message}`,
    );
  }

  const isAuthorized =
    doctor.user_id === input.actorUserId || secretaryResult.data?.secretary_user_id === input.actorUserId;

  if (!isAuthorized) {
    throw new ManageError("SESSION_INVALID", "Actor is not authorized for this doctor.");
  }

  if (doctor.suspended_at !== null || doctor.deleted_at !== null) {
    return [];
  }

  const [
    clinicResult,
    appointmentTypeResult,
    workingHoursResult,
    breaksResult,
    blockedPeriodsResult,
    scheduleExceptionsResult,
    appointmentsResult,
  ] = await Promise.all([
    supabase
      .from("clinics")
      .select("timezone")
      .eq("id", input.clinicId)
      .eq("doctor_id", input.doctorId)
      .maybeSingle(),
    supabase
      .from("appointment_types")
      .select("duration_minutes")
      .eq("id", input.appointmentTypeId)
      .eq("doctor_id", input.doctorId)
      .maybeSingle(),
    supabase
      .from("working_hours")
      .select("day_of_week, start_time, end_time")
      .eq("doctor_id", input.doctorId)
      .eq("clinic_id", input.clinicId),
    supabase
      .from("breaks")
      .select("day_of_week, start_time, end_time")
      .eq("doctor_id", input.doctorId)
      .eq("clinic_id", input.clinicId),
    supabase
      .from("blocked_periods")
      .select("clinic_id, starts_at, ends_at")
      .eq("doctor_id", input.doctorId),
    supabase
      .from("schedule_exceptions")
      .select("date, is_closed, start_time, end_time")
      .eq("doctor_id", input.doctorId)
      .eq("clinic_id", input.clinicId),
    supabase
      .from("appointments")
      .select("starts_at, ends_at")
      .eq("doctor_id", input.doctorId)
      .eq("status", "confirmed"),
  ]);

  for (const result of [
    clinicResult,
    appointmentTypeResult,
    workingHoursResult,
    breaksResult,
    blockedPeriodsResult,
    scheduleExceptionsResult,
    appointmentsResult,
  ]) {
    if (result.error) {
      throw new Error(`Failed to load manual booking availability: ${result.error.message}`);
    }
  }

  if (!clinicResult.data || !appointmentTypeResult.data) {
    return [];
  }

  const blockedPeriods = (blockedPeriodsResult.data ?? []).filter(
    (period) => period.clinic_id === null || period.clinic_id === input.clinicId,
  );

  return computeAvailableSlots({
    clinicTimezone: clinicResult.data.timezone,
    appointmentDurationMinutes: appointmentTypeResult.data.duration_minutes,
    minBookingNoticeMinutes: 0,
    localDate: input.localDate,
    now: input.now,
    workingHours: (workingHoursResult.data ?? []).map((rule) => ({
      dayOfWeek: rule.day_of_week,
      startTime: rule.start_time,
      endTime: rule.end_time,
    })),
    breaks: (breaksResult.data ?? []).map((rule) => ({
      dayOfWeek: rule.day_of_week,
      startTime: rule.start_time,
      endTime: rule.end_time,
    })),
    blockedPeriods: blockedPeriods.map((period) => ({
      startsAt: period.starts_at,
      endsAt: period.ends_at,
    })),
    scheduleExceptions: (scheduleExceptionsResult.data ?? []).map((exception) => ({
      date: exception.date,
      isClosed: exception.is_closed,
      startTime: exception.start_time,
      endTime: exception.end_time,
    })),
    existingAppointments: (appointmentsResult.data ?? []).map((appointment) => ({
      startsAt: appointment.starts_at,
      endsAt: appointment.ends_at,
    })),
  });
}
