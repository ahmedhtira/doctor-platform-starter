import { DateTime, Interval } from "luxon";

/**
 * Pure, DB-free mirror of the SQL function
 * `public.compute_available_slots` (supabase/migrations/
 * 20260101000012_compute_available_slots.sql). Every branch here has a
 * one-to-one counterpart there — see tests/availability/sql-consistency.test.ts,
 * which asserts the two actually agree rather than just resembling each
 * other. If you change one, change both and re-run that test.
 *
 * This function does no I/O and knows nothing about Supabase; the caller
 * (fetch-availability-data.ts) is responsible for resolving doctor_id/
 * clinic_id/appointment_type_id into the plain data below — including
 * pre-filtering blocked_periods to this clinic (clinic_id IS NULL OR
 * clinic_id = this clinic) and appointments to status = 'confirmed',
 * exactly like the SQL function's own queries do.
 */

export type WorkingHoursRule = {
  /** Postgres `extract(dow from date)` convention: 0 = Sunday ... 6 = Saturday. */
  dayOfWeek: number;
  /** "HH:MM" or "HH:MM:SS" wall-clock time in the clinic's timezone. */
  startTime: string;
  endTime: string;
};

export type BreakRule = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

export type ScheduleException = {
  /** "YYYY-MM-DD" */
  date: string;
  isClosed: boolean;
  startTime: string | null;
  endTime: string | null;
};

export type TimeRange = {
  /** ISO 8601 instant (must carry an explicit offset/Z — these are timestamptz values). */
  startsAt: string;
  endsAt: string;
};

export type ComputeAvailableSlotsInput = {
  /** IANA zone name, e.g. "Africa/Tunis". */
  clinicTimezone: string;
  appointmentDurationMinutes: number;
  minBookingNoticeMinutes: number;
  /** "YYYY-MM-DD", interpreted as a calendar date in clinicTimezone. */
  localDate: string;
  /** ISO 8601 instant used for the minimum-notice cutoff — a parameter, not `Date.now()`, so callers (and tests) get deterministic results. */
  now: string;
  /** All of this doctor+clinic's recurring rules, any day of week — the function picks the one matching localDate. */
  workingHours: WorkingHoursRule[];
  breaks: BreakRule[];
  /** Already scoped to this clinic by the caller. */
  blockedPeriods: TimeRange[];
  /** At most one entry is expected to match localDate; extras are ignored. */
  scheduleExceptions: ScheduleException[];
  /** Already filtered to status = 'confirmed' by the caller. */
  existingAppointments: TimeRange[];
};

export type AvailableSlot = {
  /** ISO 8601 instant, UTC. */
  slotStart: string;
  slotEnd: string;
};

/** Postgres `extract(dow from date)`: Sunday=0 ... Saturday=6. Luxon `.weekday`: Monday=1 ... Sunday=7. */
function toPostgresDayOfWeek(luxonWeekday: number): number {
  return luxonWeekday % 7;
}

function combineDateAndTime(localDate: string, time: string, zone: string): DateTime {
  const [year, month, day] = localDate.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return DateTime.fromObject({ year, month, day, hour, minute }, { zone });
}

export function computeAvailableSlots(input: ComputeAvailableSlotsInput): AvailableSlot[] {
  const localDate = DateTime.fromISO(input.localDate, { zone: input.clinicTimezone });
  if (!localDate.isValid) {
    return [];
  }

  const dayOfWeek = toPostgresDayOfWeek(localDate.weekday);

  const exception = input.scheduleExceptions.find((candidate) => candidate.date === input.localDate);

  let windowStart: string | null;
  let windowEnd: string | null;

  if (exception) {
    if (exception.isClosed) {
      return [];
    }
    windowStart = exception.startTime;
    windowEnd = exception.endTime;
  } else {
    const rule = input.workingHours.find((candidate) => candidate.dayOfWeek === dayOfWeek);
    if (!rule) {
      return [];
    }
    windowStart = rule.startTime;
    windowEnd = rule.endTime;
  }

  if (!windowStart || !windowEnd) {
    return [];
  }

  const rangeStart = combineDateAndTime(input.localDate, windowStart, input.clinicTimezone);
  const rangeEnd = combineDateAndTime(input.localDate, windowEnd, input.clinicTimezone);
  if (!rangeStart.isValid || !rangeEnd.isValid) {
    return [];
  }

  const now = DateTime.fromISO(input.now);
  const noticeThreshold = now.plus({ minutes: input.minBookingNoticeMinutes });

  const dayBreakIntervals = input.breaks
    .filter((candidate) => candidate.dayOfWeek === dayOfWeek)
    .map((rule) =>
      Interval.fromDateTimes(
        combineDateAndTime(input.localDate, rule.startTime, input.clinicTimezone),
        combineDateAndTime(input.localDate, rule.endTime, input.clinicTimezone),
      ),
    );

  const blockedIntervals = input.blockedPeriods.map((range) =>
    Interval.fromDateTimes(DateTime.fromISO(range.startsAt), DateTime.fromISO(range.endsAt)),
  );

  const confirmedIntervals = input.existingAppointments.map((range) =>
    Interval.fromDateTimes(DateTime.fromISO(range.startsAt), DateTime.fromISO(range.endsAt)),
  );

  const slots: AvailableSlot[] = [];
  let candidateStart = rangeStart;

  while (candidateStart.plus({ minutes: input.appointmentDurationMinutes }) <= rangeEnd) {
    const candidateEnd = candidateStart.plus({ minutes: input.appointmentDurationMinutes });
    const candidateInterval = Interval.fromDateTimes(candidateStart, candidateEnd);

    const meetsNotice = candidateStart >= noticeThreshold;
    const overlapsBreak = dayBreakIntervals.some((interval) => interval.overlaps(candidateInterval));
    const overlapsBlocked = blockedIntervals.some((interval) => interval.overlaps(candidateInterval));
    const overlapsConfirmed = confirmedIntervals.some((interval) => interval.overlaps(candidateInterval));

    if (meetsNotice && !overlapsBreak && !overlapsBlocked && !overlapsConfirmed) {
      slots.push({
        slotStart: candidateStart.toUTC().toISO({ suppressMilliseconds: true }) ?? candidateStart.toISO()!,
        slotEnd: candidateEnd.toUTC().toISO({ suppressMilliseconds: true }) ?? candidateEnd.toISO()!,
      });
    }

    candidateStart = candidateEnd;
  }

  return slots;
}
