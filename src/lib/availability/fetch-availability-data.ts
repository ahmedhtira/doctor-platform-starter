import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { computeAvailableSlots, type AvailableSlot } from "./compute-available-slots";

export type FetchAvailableSlotsParams = {
  doctorId: string;
  clinicId: string;
  appointmentTypeId: string;
  /** "YYYY-MM-DD" */
  localDate: string;
  /** ISO 8601 instant. */
  now: string;
};

/**
 * Data-fetching + computation layer for the availability engine. Takes the
 * Supabase client as a parameter (dependency injection) rather than
 * constructing its own — that's what makes it callable from a plain Vitest
 * test with a locally-built service-role client, without pulling in
 * service-role.ts's `import "server-only"` guard, which throws outside
 * Next's own bundler (see get-available-slots.ts for the guarded
 * production entry point that real app code should use instead).
 *
 * The tables read here (working_hours, breaks, blocked_periods,
 * schedule_exceptions) have no anon/authenticated grant at all per
 * PROJECT_SPEC.md — the caller must supply a service-role client, the
 * same requirement `public.compute_available_slots` has for its own
 * SECURITY DEFINER access. Passing a lesser-privileged client won't leak
 * anything; the queries will just fail with a permission error.
 */
export async function fetchAvailableSlots(
  supabase: SupabaseClient<Database>,
  params: FetchAvailableSlotsParams,
): Promise<AvailableSlot[]> {
  const { doctorId, clinicId, appointmentTypeId, localDate, now } = params;

  const [
    clinicResult,
    appointmentTypeResult,
    doctorResult,
    workingHoursResult,
    breaksResult,
    blockedPeriodsResult,
    scheduleExceptionsResult,
    appointmentsResult,
  ] = await Promise.all([
    supabase.from("clinics").select("timezone").eq("id", clinicId).eq("doctor_id", doctorId).maybeSingle(),
    supabase
      .from("appointment_types")
      .select("duration_minutes")
      .eq("id", appointmentTypeId)
      .eq("doctor_id", doctorId)
      .maybeSingle(),
    supabase.from("doctors").select("min_booking_notice_minutes").eq("id", doctorId).maybeSingle(),
    supabase
      .from("working_hours")
      .select("day_of_week, start_time, end_time")
      .eq("doctor_id", doctorId)
      .eq("clinic_id", clinicId),
    supabase
      .from("breaks")
      .select("day_of_week, start_time, end_time")
      .eq("doctor_id", doctorId)
      .eq("clinic_id", clinicId),
    supabase.from("blocked_periods").select("clinic_id, starts_at, ends_at").eq("doctor_id", doctorId),
    supabase
      .from("schedule_exceptions")
      .select("date, is_closed, start_time, end_time")
      .eq("doctor_id", doctorId)
      .eq("clinic_id", clinicId),
    supabase
      .from("appointments")
      .select("starts_at, ends_at")
      .eq("doctor_id", doctorId)
      .eq("status", "confirmed"),
  ]);

  for (const result of [
    clinicResult,
    appointmentTypeResult,
    doctorResult,
    workingHoursResult,
    breaksResult,
    blockedPeriodsResult,
    scheduleExceptionsResult,
    appointmentsResult,
  ]) {
    if (result.error) {
      throw new Error(`Failed to load availability data: ${result.error.message}`);
    }
  }

  if (!clinicResult.data || !appointmentTypeResult.data) {
    return [];
  }

  const blockedPeriods = (blockedPeriodsResult.data ?? []).filter(
    (period) => period.clinic_id === null || period.clinic_id === clinicId,
  );

  return computeAvailableSlots({
    clinicTimezone: clinicResult.data.timezone,
    appointmentDurationMinutes: appointmentTypeResult.data.duration_minutes,
    minBookingNoticeMinutes: doctorResult.data?.min_booking_notice_minutes ?? 0,
    localDate,
    now,
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
