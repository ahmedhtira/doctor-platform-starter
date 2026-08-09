import { DateTime } from "luxon";
import { getTranslations } from "next-intl/server";
import { requireDoctorContext } from "@/lib/dashboard/auth-context";
import { fetchDashboardAppointments } from "@/lib/dashboard/fetch-dashboard-appointments";
import { createClient } from "@/lib/supabase/server";
import { AppointmentList } from "@/components/dashboard/appointment-list";

export const dynamic = "force-dynamic";

export default async function DashboardTodayPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ doctorId?: string }>;
}) {
  const { locale } = await params;
  const { doctorId: doctorIdParam } = await searchParams;
  const { selectedDoctor } = await requireDoctorContext(doctorIdParam);

  // "Today" in the doctor's own display timezone (doctors.timezone) — a
  // doctor with clinics in multiple timezones still has one "today" as far
  // as their own dashboard is concerned; per-appointment display still
  // uses each appointment's own clinic timezone (see appointment-list.tsx).
  // Non-null: DateTime.now() is always a valid DateTime, so .toISO() can't
  // return null here (same reasoning as book-appointment.ts).
  const now = DateTime.now().setZone(selectedDoctor.timezone);
  const rangeStart = now.startOf("day").toUTC().toISO()!;
  const rangeEnd = now.plus({ days: 1 }).startOf("day").toUTC().toISO()!;

  const supabase = await createClient();
  const appointments = await fetchDashboardAppointments(supabase, {
    doctorId: selectedDoctor.id,
    rangeStart,
    rangeEnd,
  });

  const t = await getTranslations("dashboard.today");

  return (
    <div>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-muted-foreground mt-2">{selectedDoctor.fullName}</p>
      <div className="mt-6">
        <AppointmentList appointments={appointments} locale={locale} />
      </div>
    </div>
  );
}
