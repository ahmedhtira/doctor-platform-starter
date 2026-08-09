import { getTranslations } from "next-intl/server";
import { requireDoctorContext } from "@/lib/dashboard/auth-context";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createWorkingHoursAction,
  deleteWorkingHoursAction,
  createBreakAction,
  deleteBreakAction,
  createBlockedPeriodAction,
  deleteBlockedPeriodAction,
  upsertScheduleExceptionAction,
  deleteScheduleExceptionAction,
} from "./actions";

export const dynamic = "force-dynamic";

const selectClassName =
  "border-input focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-lg border bg-transparent px-2.5 text-sm shadow-xs transition-all outline-none focus-visible:ring-3";

// January 1 2023 was a Sunday, so `2023-01-(1+dayOfWeek)` lands on the
// weekday matching this schema's Postgres `dow` convention (0=Sunday ...
// 6=Saturday, same as working_hours.day_of_week/breaks.day_of_week) —
// avoids needing a parallel set of day-name translations.
function weekdayName(dayOfWeek: number, locale: string): string {
  const date = new Date(Date.UTC(2023, 0, 1 + dayOfWeek));
  const intlLocale = locale === "ar" ? "ar-TN-u-nu-latn" : "fr-TN";
  return new Intl.DateTimeFormat(intlLocale, { weekday: "long", timeZone: "UTC" }).format(date);
}

function formatInstant(iso: string, timezone: string, locale: string): string {
  const intlLocale = locale === "ar" ? "ar-TN-u-nu-latn" : "fr-TN";
  return new Intl.DateTimeFormat(intlLocale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(iso));
}

export default async function DashboardAvailabilityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ doctorId?: string }>;
}) {
  const { locale } = await params;
  const { doctorId: doctorIdParam } = await searchParams;
  const { selectedDoctor } = await requireDoctorContext(doctorIdParam);

  const supabase = await createClient();
  const [clinicsResult, workingHoursResult, breaksResult, blockedPeriodsResult, exceptionsResult] =
    await Promise.all([
      supabase
        .from("clinics")
        .select("id, name, timezone")
        .eq("doctor_id", selectedDoctor.id)
        .order("name"),
      supabase
        .from("working_hours")
        .select("id, clinic_id, day_of_week, start_time, end_time")
        .eq("doctor_id", selectedDoctor.id)
        .order("day_of_week"),
      supabase
        .from("breaks")
        .select("id, clinic_id, day_of_week, start_time, end_time")
        .eq("doctor_id", selectedDoctor.id)
        .order("day_of_week"),
      supabase
        .from("blocked_periods")
        .select("id, clinic_id, starts_at, ends_at, reason")
        .eq("doctor_id", selectedDoctor.id)
        .order("starts_at"),
      supabase
        .from("schedule_exceptions")
        .select("id, clinic_id, date, is_closed, start_time, end_time")
        .eq("doctor_id", selectedDoctor.id)
        .order("date"),
    ]);

  if (clinicsResult.error) {
    throw new Error(`Failed to load clinics: ${clinicsResult.error.message}`);
  }
  if (workingHoursResult.error) {
    throw new Error(`Failed to load working hours: ${workingHoursResult.error.message}`);
  }
  if (breaksResult.error) {
    throw new Error(`Failed to load breaks: ${breaksResult.error.message}`);
  }
  if (blockedPeriodsResult.error) {
    throw new Error(`Failed to load blocked periods: ${blockedPeriodsResult.error.message}`);
  }
  if (exceptionsResult.error) {
    throw new Error(`Failed to load schedule exceptions: ${exceptionsResult.error.message}`);
  }

  const clinics = clinicsResult.data;
  const clinicNameById = new Map(clinics.map((clinic) => [clinic.id, clinic.name]));
  const clinicTimezoneById = new Map(clinics.map((clinic) => [clinic.id, clinic.timezone]));

  const t = await getTranslations("dashboard.availability");

  if (clinics.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground mt-4">{t("noClinics")}</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-10">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      {/* Working hours */}
      <section>
        <h2 className="font-heading text-lg font-medium">{t("workingHoursTitle")}</h2>
        <ul className="divide-border mt-3 divide-y">
          {workingHoursResult.data.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span>
                {clinicNameById.get(row.clinic_id)} — {weekdayName(row.day_of_week, locale)} —{" "}
                {row.start_time.slice(0, 5)}–{row.end_time.slice(0, 5)}
              </span>
              <form action={deleteWorkingHoursAction}>
                <input type="hidden" name="doctorId" value={selectedDoctor.id} />
                <input type="hidden" name="id" value={row.id} />
                <Button type="submit" size="sm" variant="outline">
                  {t("deleteAction")}
                </Button>
              </form>
            </li>
          ))}
        </ul>

        <form action={createWorkingHoursAction} className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="doctorId" value={selectedDoctor.id} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wh-clinic">{t("clinicLabel")}</Label>
            <select id="wh-clinic" name="clinicId" required className={selectClassName}>
              {clinics.map((clinic) => (
                <option key={clinic.id} value={clinic.id}>
                  {clinic.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wh-day">{t("dayOfWeekLabel")}</Label>
            <select id="wh-day" name="dayOfWeek" required className={selectClassName}>
              {Array.from({ length: 7 }, (_, day) => (
                <option key={day} value={day}>
                  {weekdayName(day, locale)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wh-start">{t("startTimeLabel")}</Label>
            <Input id="wh-start" type="time" name="startTime" required className="w-32" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wh-end">{t("endTimeLabel")}</Label>
            <Input id="wh-end" type="time" name="endTime" required className="w-32" />
          </div>
          <Button type="submit" size="sm">
            {t("addAction")}
          </Button>
        </form>
      </section>

      {/* Breaks */}
      <section>
        <h2 className="font-heading text-lg font-medium">{t("breaksTitle")}</h2>
        <ul className="divide-border mt-3 divide-y">
          {breaksResult.data.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span>
                {clinicNameById.get(row.clinic_id)} — {weekdayName(row.day_of_week, locale)} —{" "}
                {row.start_time.slice(0, 5)}–{row.end_time.slice(0, 5)}
              </span>
              <form action={deleteBreakAction}>
                <input type="hidden" name="doctorId" value={selectedDoctor.id} />
                <input type="hidden" name="id" value={row.id} />
                <Button type="submit" size="sm" variant="outline">
                  {t("deleteAction")}
                </Button>
              </form>
            </li>
          ))}
        </ul>

        <form action={createBreakAction} className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="doctorId" value={selectedDoctor.id} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="br-clinic">{t("clinicLabel")}</Label>
            <select id="br-clinic" name="clinicId" required className={selectClassName}>
              {clinics.map((clinic) => (
                <option key={clinic.id} value={clinic.id}>
                  {clinic.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="br-day">{t("dayOfWeekLabel")}</Label>
            <select id="br-day" name="dayOfWeek" required className={selectClassName}>
              {Array.from({ length: 7 }, (_, day) => (
                <option key={day} value={day}>
                  {weekdayName(day, locale)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="br-start">{t("startTimeLabel")}</Label>
            <Input id="br-start" type="time" name="startTime" required className="w-32" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="br-end">{t("endTimeLabel")}</Label>
            <Input id="br-end" type="time" name="endTime" required className="w-32" />
          </div>
          <Button type="submit" size="sm">
            {t("addAction")}
          </Button>
        </form>
      </section>

      {/* Blocked periods */}
      <section>
        <h2 className="font-heading text-lg font-medium">{t("blockedPeriodsTitle")}</h2>
        <ul className="divide-border mt-3 divide-y">
          {blockedPeriodsResult.data.map((row) => {
            const timezone = (row.clinic_id && clinicTimezoneById.get(row.clinic_id)) || "UTC";
            return (
              <li key={row.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>
                  {row.clinic_id ? clinicNameById.get(row.clinic_id) : t("allClinics")} —{" "}
                  {formatInstant(row.starts_at, timezone, locale)} –{" "}
                  {formatInstant(row.ends_at, timezone, locale)}
                  {row.reason ? ` — ${row.reason}` : ""}
                </span>
                <form action={deleteBlockedPeriodAction}>
                  <input type="hidden" name="doctorId" value={selectedDoctor.id} />
                  <input type="hidden" name="id" value={row.id} />
                  <Button type="submit" size="sm" variant="outline">
                    {t("deleteAction")}
                  </Button>
                </form>
              </li>
            );
          })}
        </ul>

        <form action={createBlockedPeriodAction} className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="doctorId" value={selectedDoctor.id} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bp-clinic">{t("clinicLabel")}</Label>
            <select id="bp-clinic" name="clinicId" required className={selectClassName}>
              {clinics.map((clinic) => (
                <option key={clinic.id} value={clinic.id}>
                  {clinic.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bp-start">{t("startLabel")}</Label>
            <Input id="bp-start" type="datetime-local" name="startsAtLocal" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bp-end">{t("endLabel")}</Label>
            <Input id="bp-end" type="datetime-local" name="endsAtLocal" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bp-reason">{t("reasonLabel")}</Label>
            <Input id="bp-reason" type="text" name="reason" className="w-48" />
          </div>
          <Button type="submit" size="sm">
            {t("addAction")}
          </Button>
        </form>
      </section>

      {/* Schedule exceptions */}
      <section>
        <h2 className="font-heading text-lg font-medium">{t("exceptionsTitle")}</h2>
        <ul className="divide-border mt-3 divide-y">
          {exceptionsResult.data.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span>
                {clinicNameById.get(row.clinic_id)} — {row.date} —{" "}
                {row.is_closed
                  ? t("closedLabel")
                  : `${row.start_time?.slice(0, 5)}–${row.end_time?.slice(0, 5)}`}
              </span>
              <form action={deleteScheduleExceptionAction}>
                <input type="hidden" name="doctorId" value={selectedDoctor.id} />
                <input type="hidden" name="id" value={row.id} />
                <Button type="submit" size="sm" variant="outline">
                  {t("deleteAction")}
                </Button>
              </form>
            </li>
          ))}
        </ul>

        <form
          action={upsertScheduleExceptionAction}
          className="mt-4 flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="doctorId" value={selectedDoctor.id} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ex-clinic">{t("clinicLabel")}</Label>
            <select id="ex-clinic" name="clinicId" required className={selectClassName}>
              {clinics.map((clinic) => (
                <option key={clinic.id} value={clinic.id}>
                  {clinic.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ex-date">{t("dateLabel")}</Label>
            <Input id="ex-date" type="date" name="date" required className="w-40" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ex-start">{t("startTimeLabel")}</Label>
            <Input id="ex-start" type="time" name="startTime" className="w-32" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ex-end">{t("endTimeLabel")}</Label>
            <Input id="ex-end" type="time" name="endTime" className="w-32" />
          </div>
          <div className="flex items-center gap-1.5">
            <input id="ex-closed" type="checkbox" name="isClosed" className="size-4" />
            <Label htmlFor="ex-closed">{t("closedLabel")}</Label>
          </div>
          <Button type="submit" size="sm">
            {t("addAction")}
          </Button>
        </form>
      </section>
    </div>
  );
}
