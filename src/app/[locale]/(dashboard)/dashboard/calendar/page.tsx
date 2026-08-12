import { DateTime } from "luxon";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireDoctorContext } from "@/lib/dashboard/auth-context";
import { fetchDashboardAppointments } from "@/lib/dashboard/fetch-dashboard-appointments";
import { createClient } from "@/lib/supabase/server";
import { AppointmentList } from "@/components/dashboard/appointment-list";
import { buildDashboardHref } from "@/lib/dashboard/dashboard-links";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ doctorId?: string; week?: string }>;
}) {
  const { locale } = await params;
  const { doctorId: doctorIdParam, week: weekParam } = await searchParams;
  const { selectedDoctor } = await requireDoctorContext(doctorIdParam);

  // The Monday that starts the displayed week, in the doctor's own display
  // timezone (same reasoning as Today). An invalid/missing `week` param
  // falls back to the current week rather than erroring. Computed via
  // `.weekday` (Luxon: Monday=1...Sunday=7, same ISO convention already
  // documented in compute-available-slots.ts) rather than
  // `.startOf("week")`, which is locale-dependent and can resolve to a
  // Sunday-start week under some Intl locale data — this app's week always
  // starts Monday, matching the seed script's Postgres dow convention.
  const requestedWeekStart = weekParam
    ? DateTime.fromISO(weekParam, { zone: selectedDoctor.timezone })
    : null;
  const referenceDay = requestedWeekStart?.isValid
    ? requestedWeekStart
    : DateTime.now().setZone(selectedDoctor.timezone);
  const weekStart = referenceDay.minus({ days: referenceDay.weekday - 1 }).startOf("day");

  // Non-null: weekStart is always a valid DateTime (guarded above), so
  // .toISO()/.toISODate() can't return null here.
  const rangeStart = weekStart.toUTC().toISO()!;
  const rangeEnd = weekStart.plus({ weeks: 1 }).toUTC().toISO()!;
  const previousWeekStart = weekStart.minus({ weeks: 1 }).toISODate()!;
  const nextWeekStart = weekStart.plus({ weeks: 1 }).toISODate()!;
  const currentReference = DateTime.now().setZone(selectedDoctor.timezone);
  const currentWeekStart = currentReference
    .minus({ days: currentReference.weekday - 1 })
    .startOf("day");
  const isCurrentWeek = weekStart.hasSame(currentWeekStart, "day");

  const supabase = await createClient();
  const appointments = await fetchDashboardAppointments(supabase, {
    doctorId: selectedDoctor.id,
    rangeStart,
    rangeEnd,
  });

  const days = Array.from({ length: 7 }, (_, index) => weekStart.plus({ days: index }));
  const intlLocale = locale === "ar" ? "ar-TN-u-nu-latn" : "fr-TN";
  const dayNameFormatter = new Intl.DateTimeFormat(intlLocale, { weekday: "long" });
  const dayNumberFormatter = new Intl.DateTimeFormat(intlLocale, {
    day: "numeric",
    month: "short",
  });
  const rangeFormatter = new Intl.DateTimeFormat(intlLocale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const t = await getTranslations("dashboard.calendar");

  return (
    <div className="max-w-full">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-accent text-xs font-semibold tracking-[0.14em] uppercase">
            {selectedDoctor.fullName}
          </p>
          <h1 className="font-heading mt-1 text-3xl font-medium">{t("title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {rangeFormatter.format(weekStart.toJSDate())} –{" "}
            {rangeFormatter.format(weekStart.plus({ days: 6 }).toJSDate())}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={buildDashboardHref("/dashboard/calendar", {
              doctorId: selectedDoctor.id,
              week: previousWeekStart,
            })}
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-10 gap-1.5")}
          >
            <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
            {t("previousWeek")}
          </Link>
          {!isCurrentWeek ? (
            <Link
              href={buildDashboardHref("/dashboard/calendar", {
                doctorId: selectedDoctor.id,
                week: currentWeekStart.toISODate()!,
              })}
              className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "h-10")}
            >
              {t("currentWeek")}
            </Link>
          ) : null}
          <Link
            href={buildDashboardHref("/dashboard/calendar", {
              doctorId: selectedDoctor.id,
              week: nextWeekStart,
            })}
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-10 gap-1.5")}
          >
            {t("nextWeek")}
            <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
          </Link>
        </div>
      </div>

      <div className="mt-6 lg:overflow-x-auto lg:pb-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[84rem] lg:grid-cols-7">
          {days.map((day) => {
            const dayAppointments = appointments.filter((appointment) =>
              DateTime.fromISO(appointment.startsAt, { zone: selectedDoctor.timezone }).hasSame(
                day,
                "day",
              ),
            );
            const isToday = day.hasSame(currentReference, "day");
            return (
              <section
                key={day.toISODate()}
                className={cn(
                  "rounded-2xl border p-3",
                  isToday ? "border-primary/30 bg-primary/5" : "bg-muted/20",
                )}
              >
                <div className="flex items-center justify-between gap-2 border-b pb-3">
                  <div>
                    <h2 className="font-heading text-base font-medium capitalize">
                      {dayNameFormatter.format(day.toJSDate())}
                    </h2>
                    <p className="text-muted-foreground text-xs capitalize">
                      {dayNumberFormatter.format(day.toJSDate())}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                      isToday ? "bg-primary text-primary-foreground" : "bg-muted",
                    )}
                  >
                    {dayAppointments.length}
                  </span>
                </div>
                <div className="mt-3">
                  <AppointmentList appointments={dayAppointments} locale={locale} variant="cards" />
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
