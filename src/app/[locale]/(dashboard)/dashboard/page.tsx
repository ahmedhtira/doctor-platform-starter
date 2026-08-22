import { DateTime } from "luxon";
import { getTranslations } from "next-intl/server";
import { AlertCircle, CalendarDays, CheckCircle2, Clock3 } from "lucide-react";
import { requireDoctorContext } from "@/lib/dashboard/auth-context";
import { fetchDashboardAppointments } from "@/lib/dashboard/fetch-dashboard-appointments";
import { createClient } from "@/lib/supabase/server";
import { AppointmentList } from "@/components/dashboard/appointment-list";
import { ManualAppointmentForm } from "@/components/dashboard/manual-appointment-form";

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

  const now = DateTime.now().setZone(selectedDoctor.timezone);
  const rangeStart = now.startOf("day").toUTC().toISO()!;
  const rangeEnd = now.plus({ days: 1 }).startOf("day").toUTC().toISO()!;

  const supabase = await createClient();
  const [appointments, clinicsResult, appointmentTypesResult] = await Promise.all([
    fetchDashboardAppointments(supabase, {
      doctorId: selectedDoctor.id,
      rangeStart,
      rangeEnd,
    }),
    supabase
      .from("clinics")
      .select("id, name, timezone")
      .eq("doctor_id", selectedDoctor.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("appointment_types")
      .select("id, name, duration_minutes")
      .eq("doctor_id", selectedDoctor.id)
      .order("created_at", { ascending: true }),
  ]);

  if (clinicsResult.error) {
    throw new Error(`Failed to load clinics for manual booking: ${clinicsResult.error.message}`);
  }
  if (appointmentTypesResult.error) {
    throw new Error(
      `Failed to load appointment types for manual booking: ${appointmentTypesResult.error.message}`,
    );
  }

  const manualClinics = clinicsResult.data.map((clinic) => ({
    id: clinic.id,
    name: clinic.name,
    timezone: clinic.timezone,
  }));
  const manualAppointmentTypes = appointmentTypesResult.data.map((type) => ({
    id: type.id,
    name: type.name,
    durationMinutes: type.duration_minutes,
  }));

  const t = await getTranslations("dashboard.today");
  const intlLocale = locale === "ar" ? "ar-TN-u-nu-latn" : "fr-TN";
  const formattedDate = new Intl.DateTimeFormat(intlLocale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: selectedDoctor.timezone,
  }).format(now.toJSDate());
  const confirmedAppointments = appointments.filter(
    (appointment) => appointment.status === "confirmed",
  );
  const remainingAppointments = confirmedAppointments.filter(
    (appointment) => DateTime.fromISO(appointment.endsAt).toMillis() > now.toUTC().toMillis(),
  );
  const completedAppointments = appointments.filter(
    (appointment) => appointment.status === "completed",
  );
  const attentionAppointments = appointments.filter(
    (appointment) => appointment.status === "cancelled" || appointment.status === "no_show",
  );
  const nextAppointment = confirmedAppointments.find(
    (appointment) => DateTime.fromISO(appointment.startsAt).toMillis() >= now.toUTC().toMillis(),
  );
  const summaryItems = [
    { label: t("summary.total"), value: appointments.length, icon: CalendarDays },
    { label: t("summary.remaining"), value: remainingAppointments.length, icon: Clock3 },
    { label: t("summary.completed"), value: completedAppointments.length, icon: CheckCircle2 },
    { label: t("summary.attention"), value: attentionAppointments.length, icon: AlertCircle },
  ];

  const formatTime = (iso: string, timezone: string) =>
    new Intl.DateTimeFormat(intlLocale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone,
    }).format(new Date(iso));

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-accent text-xs font-semibold tracking-[0.14em] uppercase">
            {selectedDoctor.fullName}
          </p>
          <h1 className="font-heading mt-1 text-3xl font-medium">{t("title")}</h1>
          <p className="text-muted-foreground mt-1 capitalize">{formattedDate}</p>
        </div>
        <ManualAppointmentForm
          doctorId={selectedDoctor.id}
          clinics={manualClinics}
          appointmentTypes={manualAppointmentTypes}
          defaultDate={now.toISODate()!}
        />
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summaryItems.map(({ label, value, icon: Icon }) => (
          <div key={label} className="bg-card rounded-2xl border p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <dt className="text-muted-foreground text-sm">{label}</dt>
                <dd className="font-heading mt-1 text-3xl font-medium tabular-nums">{value}</dd>
              </div>
              <span className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-xl">
                <Icon className="size-4.5" aria-hidden />
              </span>
            </div>
          </div>
        ))}
      </dl>

      {nextAppointment ? (
        <section className="from-primary/12 to-primary/5 border-primary/15 mt-6 rounded-2xl border bg-gradient-to-r p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
          <div>
            <p className="text-primary text-xs font-semibold tracking-[0.12em] uppercase">
              {t("nextAppointment")}
            </p>
            <p className="font-heading mt-1 text-xl font-medium">{nextAppointment.patientName}</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {nextAppointment.clinicName} · {nextAppointment.appointmentTypeName}
            </p>
          </div>
          <p className="font-heading mt-3 text-3xl font-medium tabular-nums sm:mt-0">
            {formatTime(nextAppointment.startsAt, nextAppointment.clinicTimezone)}
          </p>
        </section>
      ) : null}

      <section className="mt-8">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 className="font-heading text-2xl font-medium">{t("scheduleTitle")}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{t("scheduleDescription")}</p>
          </div>
          <span className="bg-muted rounded-full px-3 py-1 text-sm font-medium tabular-nums">
            {appointments.length}
          </span>
        </div>
        <AppointmentList
          appointments={appointments}
          locale={locale}
          appointmentTypes={manualAppointmentTypes}
          allowDelay
        />
      </section>
    </div>
  );
}
