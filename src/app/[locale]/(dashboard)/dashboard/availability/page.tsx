import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Ban, CalendarClock, CalendarSync, Coffee, type LucideIcon } from "lucide-react";
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
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-10 rounded-lg border px-2.5 text-sm shadow-xs transition-all outline-none focus-visible:ring-3";

const formClassName = "bg-muted/35 mt-4 flex flex-wrap items-end gap-3 rounded-xl border p-4";

function AvailabilitySection({
  title,
  icon: Icon,
  count,
  children,
}: {
  title: string;
  icon: LucideIcon;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="bg-card rounded-2xl border p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-xl">
            <Icon className="size-5" aria-hidden />
          </span>
          <h2 className="font-heading text-xl font-medium">{title}</h2>
        </div>
        <span className="bg-muted flex size-8 items-center justify-center rounded-full text-sm font-semibold tabular-nums">
          {count}
        </span>
      </div>
      {children}
    </section>
  );
}

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
  const overviewDays = [1, 2, 3, 4, 5, 6, 0];

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
    <div className="max-w-6xl space-y-6">
      <div>
        <p className="text-accent text-xs font-semibold tracking-[0.14em] uppercase">
          {selectedDoctor.fullName}
        </p>
        <h1 className="font-heading mt-1 text-3xl font-medium">{t("title")}</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl">{t("description")}</p>
      </div>

      <section>
        <h2 className="font-heading text-xl font-medium">{t("weeklyOverviewTitle")}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {overviewDays.map((day) => {
            const hoursForDay = workingHoursResult.data.filter((row) => row.day_of_week === day);
            const breaksForDay = breaksResult.data.filter((row) => row.day_of_week === day);

            return (
              <article key={day} className="bg-card min-h-32 rounded-2xl border p-4 shadow-sm">
                <h3 className="font-heading font-medium capitalize">{weekdayName(day, locale)}</h3>
                {hoursForDay.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {hoursForDay.map((row) => (
                      <li key={row.id} className="text-sm">
                        <p className="font-semibold tabular-nums">
                          {row.start_time.slice(0, 5)}–{row.end_time.slice(0, 5)}
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {clinicNameById.get(row.clinic_id)}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground mt-3 text-sm">{t("noHours")}</p>
                )}
                {breaksForDay.length > 0 ? (
                  <p className="text-accent mt-3 text-xs font-medium">
                    {t("breakLabel")}: {breaksForDay.length}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      {/* Working hours */}
      <AvailabilitySection
        title={t("workingHoursTitle")}
        icon={CalendarClock}
        count={workingHoursResult.data.length}
      >
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
                <Button type="submit" size="sm" variant="outline" className="h-9">
                  {t("deleteAction")}
                </Button>
              </form>
            </li>
          ))}
        </ul>

        {workingHoursResult.data.length === 0 ? (
          <p className="text-muted-foreground mt-4 text-sm">{t("emptyConfigured")}</p>
        ) : null}

        <form action={createWorkingHoursAction} className={formClassName}>
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
          <Button type="submit" size="sm" className="h-10">
            {t("addAction")}
          </Button>
        </form>
      </AvailabilitySection>

      {/* Breaks */}
      <AvailabilitySection title={t("breaksTitle")} icon={Coffee} count={breaksResult.data.length}>
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
                <Button type="submit" size="sm" variant="outline" className="h-9">
                  {t("deleteAction")}
                </Button>
              </form>
            </li>
          ))}
        </ul>

        {breaksResult.data.length === 0 ? (
          <p className="text-muted-foreground mt-4 text-sm">{t("emptyConfigured")}</p>
        ) : null}

        <form action={createBreakAction} className={formClassName}>
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
          <Button type="submit" size="sm" className="h-10">
            {t("addAction")}
          </Button>
        </form>
      </AvailabilitySection>

      {/* Blocked periods */}
      <AvailabilitySection
        title={t("blockedPeriodsTitle")}
        icon={Ban}
        count={blockedPeriodsResult.data.length}
      >
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
                  <Button type="submit" size="sm" variant="outline" className="h-9">
                    {t("deleteAction")}
                  </Button>
                </form>
              </li>
            );
          })}
        </ul>

        {blockedPeriodsResult.data.length === 0 ? (
          <p className="text-muted-foreground mt-4 text-sm">{t("emptyConfigured")}</p>
        ) : null}

        <form action={createBlockedPeriodAction} className={formClassName}>
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
          <Button type="submit" size="sm" className="h-10">
            {t("addAction")}
          </Button>
        </form>
      </AvailabilitySection>

      {/* Schedule exceptions */}
      <AvailabilitySection
        title={t("exceptionsTitle")}
        icon={CalendarSync}
        count={exceptionsResult.data.length}
      >
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
                <Button type="submit" size="sm" variant="outline" className="h-9">
                  {t("deleteAction")}
                </Button>
              </form>
            </li>
          ))}
        </ul>

        {exceptionsResult.data.length === 0 ? (
          <p className="text-muted-foreground mt-4 text-sm">{t("emptyConfigured")}</p>
        ) : null}

        <form action={upsertScheduleExceptionAction} className={formClassName}>
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
          <Button type="submit" size="sm" className="h-10">
            {t("addAction")}
          </Button>
        </form>
      </AvailabilitySection>
    </div>
  );
}
