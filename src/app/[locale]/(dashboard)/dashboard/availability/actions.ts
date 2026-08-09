"use server";

import { DateTime } from "luxon";
import { z } from "zod";
import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedUser, getStaffedDoctors } from "@/lib/dashboard/auth-context";

// These four tables (working_hours, breaks, blocked_periods,
// schedule_exceptions) already grant insert/update/delete to `authenticated`
// staff via private.is_staff_for_doctor/is_doctor_owner RLS policies
// (20260101000007_schedule.sql) — unlike appointments, there's no
// privileged-function gap to fill, so these actions use the plain
// RLS-bound createClient(), not service-role. Each action still
// independently re-verifies doctorId is in the caller's own staffed-doctor
// list before writing, as defense in depth alongside RLS.
//
// Forms here are plain (no "use client") — Server Actions bound directly
// to a native <form action={fn}> receive a FormData, not a JSON object
// (contrast with the JSON-argument actions in dashboard/actions.ts, which
// are called programmatically from client components). Validation failures
// here intentionally no-op rather than surfacing inline field errors —
// browser-native input constraints (type="time"/"date", required, fixed
// <select> options) make a malformed submission the rare/defensive case,
// not the primary UX, for this internal scheduling tool.

async function requireStaffDoctorId(formData: FormData): Promise<string | null> {
  const user = await getAuthenticatedUser();
  if (!user) return null;

  const doctorId = formData.get("doctorId");
  if (typeof doctorId !== "string" || doctorId === "") return null;

  const doctors = await getStaffedDoctors(user.id);
  return doctors.some((doctor) => doctor.id === doctorId) ? doctorId : null;
}

const timeSchema = z.string().regex(/^\d{2}:\d{2}$/);
const dayOfWeekSchema = z.coerce.number().int().min(0).max(6);

// --- working hours ---------------------------------------------------

const workingHoursInputSchema = z.object({
  clinicId: z.uuid(),
  dayOfWeek: dayOfWeekSchema,
  startTime: timeSchema,
  endTime: timeSchema,
});

export async function createWorkingHoursAction(formData: FormData): Promise<void> {
  const doctorId = await requireStaffDoctorId(formData);
  if (!doctorId) return;

  const parsed = workingHoursInputSchema.safeParse({
    clinicId: formData.get("clinicId"),
    dayOfWeek: formData.get("dayOfWeek"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
  });
  if (!parsed.success) return;

  const supabase = await createClient();
  const { error } = await supabase.from("working_hours").insert({
    doctor_id: doctorId,
    clinic_id: parsed.data.clinicId,
    day_of_week: parsed.data.dayOfWeek,
    start_time: parsed.data.startTime,
    end_time: parsed.data.endTime,
  });
  if (error) return;

  refresh();
}

export async function deleteWorkingHoursAction(formData: FormData): Promise<void> {
  const doctorId = await requireStaffDoctorId(formData);
  if (!doctorId) return;
  const id = formData.get("id");
  if (typeof id !== "string") return;

  const supabase = await createClient();
  await supabase.from("working_hours").delete().eq("id", id).eq("doctor_id", doctorId);
  refresh();
}

// --- breaks ------------------------------------------------------------

const breakInputSchema = workingHoursInputSchema;

export async function createBreakAction(formData: FormData): Promise<void> {
  const doctorId = await requireStaffDoctorId(formData);
  if (!doctorId) return;

  const parsed = breakInputSchema.safeParse({
    clinicId: formData.get("clinicId"),
    dayOfWeek: formData.get("dayOfWeek"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
  });
  if (!parsed.success) return;

  const supabase = await createClient();
  const { error } = await supabase.from("breaks").insert({
    doctor_id: doctorId,
    clinic_id: parsed.data.clinicId,
    day_of_week: parsed.data.dayOfWeek,
    start_time: parsed.data.startTime,
    end_time: parsed.data.endTime,
  });
  if (error) return;

  refresh();
}

export async function deleteBreakAction(formData: FormData): Promise<void> {
  const doctorId = await requireStaffDoctorId(formData);
  if (!doctorId) return;
  const id = formData.get("id");
  if (typeof id !== "string") return;

  const supabase = await createClient();
  await supabase.from("breaks").delete().eq("id", id).eq("doctor_id", doctorId);
  refresh();
}

// --- blocked periods -----------------------------------------------------
// Always scoped to one clinic in this UI (the schema allows a null
// clinic_id for a doctor-wide block, but that's not exposed here — keeping
// the wall-clock -> instant conversion below unambiguous: it always
// resolves against one clinic's timezone, never a doctor-wide default).

const blockedPeriodInputSchema = z.object({
  clinicId: z.uuid(),
  startsAtLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  endsAtLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  reason: z.string().trim().optional(),
});

export async function createBlockedPeriodAction(formData: FormData): Promise<void> {
  const doctorId = await requireStaffDoctorId(formData);
  if (!doctorId) return;

  const parsed = blockedPeriodInputSchema.safeParse({
    clinicId: formData.get("clinicId"),
    startsAtLocal: formData.get("startsAtLocal"),
    endsAtLocal: formData.get("endsAtLocal"),
    reason: formData.get("reason") || undefined,
  });
  if (!parsed.success) return;

  const supabase = await createClient();
  const { data: clinic, error: clinicError } = await supabase
    .from("clinics")
    .select("timezone")
    .eq("id", parsed.data.clinicId)
    .eq("doctor_id", doctorId)
    .maybeSingle();
  if (clinicError || !clinic) return;

  const startsAt = DateTime.fromISO(parsed.data.startsAtLocal, { zone: clinic.timezone });
  const endsAt = DateTime.fromISO(parsed.data.endsAtLocal, { zone: clinic.timezone });
  if (!startsAt.isValid || !endsAt.isValid || startsAt >= endsAt) return;

  const { error } = await supabase.from("blocked_periods").insert({
    doctor_id: doctorId,
    clinic_id: parsed.data.clinicId,
    starts_at: startsAt.toUTC().toISO(),
    ends_at: endsAt.toUTC().toISO(),
    reason: parsed.data.reason ?? null,
  });
  if (error) return;

  refresh();
}

export async function deleteBlockedPeriodAction(formData: FormData): Promise<void> {
  const doctorId = await requireStaffDoctorId(formData);
  if (!doctorId) return;
  const id = formData.get("id");
  if (typeof id !== "string") return;

  const supabase = await createClient();
  await supabase.from("blocked_periods").delete().eq("id", id).eq("doctor_id", doctorId);
  refresh();
}

// --- schedule exceptions -------------------------------------------------

const scheduleExceptionInputSchema = z.object({
  clinicId: z.uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isClosed: z.boolean(),
  startTime: timeSchema.optional(),
  endTime: timeSchema.optional(),
});

export async function upsertScheduleExceptionAction(formData: FormData): Promise<void> {
  const doctorId = await requireStaffDoctorId(formData);
  if (!doctorId) return;

  const isClosed = formData.get("isClosed") === "on";
  const parsed = scheduleExceptionInputSchema.safeParse({
    clinicId: formData.get("clinicId"),
    date: formData.get("date"),
    isClosed,
    startTime: formData.get("startTime") || undefined,
    endTime: formData.get("endTime") || undefined,
  });
  if (!parsed.success) return;
  if (!parsed.data.isClosed && (!parsed.data.startTime || !parsed.data.endTime)) return;

  const supabase = await createClient();
  const { error } = await supabase.from("schedule_exceptions").upsert(
    {
      doctor_id: doctorId,
      clinic_id: parsed.data.clinicId,
      date: parsed.data.date,
      is_closed: parsed.data.isClosed,
      start_time: parsed.data.isClosed ? null : (parsed.data.startTime ?? null),
      end_time: parsed.data.isClosed ? null : (parsed.data.endTime ?? null),
    },
    { onConflict: "doctor_id,clinic_id,date" },
  );
  if (error) return;

  refresh();
}

export async function deleteScheduleExceptionAction(formData: FormData): Promise<void> {
  const doctorId = await requireStaffDoctorId(formData);
  if (!doctorId) return;
  const id = formData.get("id");
  if (typeof id !== "string") return;

  const supabase = await createClient();
  await supabase.from("schedule_exceptions").delete().eq("id", id).eq("doctor_id", doctorId);
  refresh();
}
