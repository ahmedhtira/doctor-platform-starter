import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { AppointmentActions } from "./appointment-actions";
import type { DashboardAppointment } from "@/lib/dashboard/fetch-dashboard-appointments";
import { cn } from "@/lib/utils";

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

/**
 * Shared between Today and Calendar. `showDate` controls whether each row
 * repeats its full date (Today: false, single day already implied by the
 * page) or just the time (Calendar: rows are already grouped under a
 * per-day heading by the caller).
 */
export async function AppointmentList({
  appointments,
  locale,
  showDate = false,
  variant = "list",
}: {
  appointments: DashboardAppointment[];
  locale: string;
  showDate?: boolean;
  variant?: "list" | "cards";
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
            </div>
            <Badge variant={statusVariant[appointment.status] ?? "secondary"}>
              {t(`status.${appointment.status}`)}
            </Badge>
          </div>

          {appointment.status === "confirmed" ? (
            <AppointmentActions appointment={appointment} locale={locale} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
