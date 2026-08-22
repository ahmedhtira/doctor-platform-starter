import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { AppointmentActions } from "./appointment-actions";
import type { DashboardAppointment } from "@/lib/dashboard/fetch-dashboard-appointments";
import { cn } from "@/lib/utils";

export type DashboardAppointmentTypeOption = {
  id: string;
  name: string;
  durationMinutes: number;
};

function formatTime(iso: string, timezone: string, locale: string): string {
  const intlLocale = locale === "ar" ? "ar-TN-u-nu-latn" : "fr-TN";
  return new Intl.DateTimeFormat(intlLocale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(new Date(iso));
}

function formatDate(iso: string, timezone: string, locale: string): string {
  const intlLocale = locale === "ar" ? "ar-TN-u-nu-latn" : "fr-TN";
  return new Intl.DateTimeFormat(intlLocale, {
    dateStyle: "full",
    timeZone: timezone,
  }).format(new Date(iso));
}

export async function AppointmentList({
  appointments,
  locale,
  appointmentTypes = [],
  showDate = false,
  variant = "list",
  allowDelay = false,
}: {
  appointments: DashboardAppointment[];
  locale: string;
  appointmentTypes?: DashboardAppointmentTypeOption[];
  showDate?: boolean;
  variant?: "list" | "cards";
  allowDelay?: boolean;
}) {
  const t = await getTranslations("dashboard.appointmentList");

  if (appointments.length === 0) {
    return (
      <p
        className={cn(
          "text-muted-foreground text-sm",
          variant === "cards" && "rounded-xl border border-dashed px-3 py-6 text-center",
        )}
      >
        {t("empty")}
      </p>
    );
  }

  const statusVariant: Record<string, "default" | "secondary" | "destructive"> = {
    confirmed: "default",
    cancelled: "destructive",
    completed: "secondary",
    no_show: "secondary",
  };

  const statusBorderClass: Record<string, string> = {
    confirmed: "border-s-primary",
    cancelled: "border-s-destructive",
    completed: "border-s-muted-foreground/40",
    no_show: "border-s-accent",
  };

  const manualLabel = locale === "ar" ? "موعد يدوي" : "Ajout manuel";
  const notesLabel = locale === "ar" ? "ملاحظة" : "Note";

  return (
    <ul className={cn(variant === "list" ? "divide-border divide-y" : "space-y-2")}>
      {appointments.map((appointment) => (
        <li
          key={appointment.id}
          className={cn(
            variant === "list" ? "py-4" : "bg-card rounded-xl border border-s-3 p-3 shadow-xs",
            variant === "cards" &&
              (statusBorderClass[appointment.status] ?? "border-s-muted-foreground/30"),
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium">
                {showDate
                  ? `${formatDate(appointment.startsAt, appointment.clinicTimezone, locale)} — ${formatTime(appointment.startsAt, appointment.clinicTimezone, locale)}`
                  : formatTime(appointment.startsAt, appointment.clinicTimezone, locale)}
              </p>
              <p className="text-muted-foreground text-sm">{appointment.patientName}</p>
              <p className="text-muted-foreground text-sm">
                {appointment.clinicName} · {appointment.appointmentTypeName}
              </p>
              <p className="text-muted-foreground text-sm">{appointment.patientPhone}</p>
              {appointment.notes ? (
                <p className="text-muted-foreground mt-1 text-sm">
                  <span className="font-medium text-foreground/80">{notesLabel}:</span>{" "}
                  {appointment.notes}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap justify-end gap-1.5">
              {appointment.source === "manual" ? (
                <Badge variant="secondary">{manualLabel}</Badge>
              ) : null}
              <Badge variant={statusVariant[appointment.status] ?? "secondary"}>
                {t(`status.${appointment.status}`)}
              </Badge>
            </div>
          </div>

          {appointment.status === "confirmed" ? (
            <AppointmentActions
              appointment={appointment}
              locale={locale}
              appointmentTypes={appointmentTypes}
              allowDelay={allowDelay}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
