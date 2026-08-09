import { DateTime } from "luxon";
import { getTranslations } from "next-intl/server";
import { requireDoctorContext } from "@/lib/dashboard/auth-context";
import { fetchDashboardAppointments } from "@/lib/dashboard/fetch-dashboard-appointments";
import { createClient } from "@/lib/supabase/server";
import { AppointmentList } from "@/components/dashboard/appointment-list";
import { buildDashboardHref } from "@/lib/dashboard/dashboard-links";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

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

  const supabase = await createClient();
  const appointments = await fetchDashboardAppointments(supabase, {
    doctorId: selectedDoctor.id,
    rangeStart,
    rangeEnd,
  });

  const days = Array.from({ length: 7 }, (_, index) => weekStart.plus({ days: index }));
  const dayFormatter = new Intl.DateTimeFormat(locale === "ar" ? "ar-TN-u-nu-latn" : "fr-TN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const t = await getTranslations("dashboard.calendar");

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <div className="flex gap-2">
          <Link
            href={buildDashboardHref("/dashboard/calendar", {
              doctorId: selectedDoctor.id,
              week: previousWeekStart,
            })}
          >
            <Button type="button" variant="outline" size="sm">
              {t("previousWeek")}
            </Button>
          </Link>
          <Link
            href={buildDashboardHref("/dashboard/calendar", {
              doctorId: selectedDoctor.id,
              week: nextWeekStart,
            })}
          >
            <Button type="button" variant="outline" size="sm">
              {t("nextWeek")}
            </Button>
          </Link>
        </div>
      </div>

      <div className="mt-6 space-y-8">
        {days.map((day) => {
          const dayAppointments = appointments.filter((appointment) =>
            DateTime.fromISO(appointment.startsAt, { zone: selectedDoctor.timezone }).hasSame(
              day,
              "day",
            ),
          );
          return (
            <section key={day.toISODate()}>
              <h2 className="font-heading text-lg font-medium capitalize">
                {dayFormatter.format(day.toJSDate())}
              </h2>
              <div className="mt-3">
                <AppointmentList appointments={dayAppointments} locale={locale} />
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
