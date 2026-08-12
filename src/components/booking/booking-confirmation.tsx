"use client";

import { useMemo } from "react";
import { CalendarPlus, CheckCircle2, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function formatDateTime(iso: string, timezone: string, locale: string): string {
  // dateStyle/timeStyle can't be combined with explicit component options
  // (hour12) in the same formatter — Intl.DateTimeFormat throws a
  // RangeError if you try. Two formatters, joined, instead.
  const intlLocale = locale === "ar" ? "ar-TN-u-nu-latn" : "fr-TN";
  const date = new Date(iso);
  const datePart = new Intl.DateTimeFormat(intlLocale, {
    dateStyle: "full",
    timeZone: timezone,
  }).format(date);
  const timePart = new Intl.DateTimeFormat(intlLocale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(date);
  return `${datePart} — ${timePart}`;
}

export function BookingConfirmation({
  startsAt,
  doctorName,
  clinicName,
  clinicAddress,
  clinicTimezone,
  durationMinutes,
  patientName,
  managementToken,
  locale,
  labels,
}: {
  startsAt: string;
  doctorName: string;
  clinicName: string;
  clinicAddress: string;
  clinicTimezone: string;
  durationMinutes: number;
  patientName: string;
  managementToken: string;
  locale: string;
  labels: {
    confirmationTitle: string;
    confirmationSummaryIntro: string;
    confirmationDoctorLabel: string;
    confirmationDateLabel: string;
    confirmationClinicLabel: string;
    confirmationPatientLabel: string;
    managementLinkTitle: string;
    managementLinkDescription: string;
    addToCalendarAction: string;
    nextStepsTitle: string;
    nextStepsDescription: string;
    manageAppointmentAction: string;
  };
}) {
  // Fragment (#token=...) is never sent to the server — see
  // PROJECT_SPEC.md "Booking flow (M4)". window.location.origin is only
  // available client-side, hence the guard for the (brief) server-render
  // pass of this client component.
  const managementLink = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/${locale}/manage#token=${managementToken}`;
  }, [locale, managementToken]);
  const calendarLink = useMemo(() => {
    const end = new Date(new Date(startsAt).getTime() + durationMinutes * 60 * 1000);
    const calendarDate = (date: Date) =>
      date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const escapeCalendarText = (value: string) =>
      value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,");
    const calendarFile = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Dewini//Appointment//FR",
      "BEGIN:VEVENT",
      `UID:dewini-${new Date(startsAt).getTime()}@appointment`,
      `DTSTAMP:${calendarDate(new Date(startsAt))}`,
      `DTSTART:${calendarDate(new Date(startsAt))}`,
      `DTEND:${calendarDate(end)}`,
      `SUMMARY:${escapeCalendarText(`${doctorName} — ${clinicName}`)}`,
      `LOCATION:${escapeCalendarText(`${clinicName}, ${clinicAddress}`)}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    return `data:text/calendar;charset=utf-8,${encodeURIComponent(calendarFile)}`;
  }, [clinicAddress, clinicName, doctorName, durationMinutes, startsAt]);

  return (
    <Card className="border-primary/20 overflow-hidden">
      <CardHeader className="bg-primary text-primary-foreground py-6 text-center">
        <CheckCircle2 className="mx-auto size-10" aria-hidden />
        <CardTitle className="mt-2 text-2xl">{labels.confirmationTitle}</CardTitle>
        <p className="text-primary-foreground/80 mt-1 text-sm">{labels.confirmationSummaryIntro}</p>
      </CardHeader>
      <CardContent className="space-y-5 pt-5 text-sm">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="bg-muted/45 rounded-xl p-3">
            <dt className="text-muted-foreground text-xs">{labels.confirmationDoctorLabel}</dt>
            <dd className="mt-1 font-medium">{doctorName}</dd>
          </div>
          <div className="bg-muted/45 rounded-xl p-3">
            <dt className="text-muted-foreground text-xs">{labels.confirmationDateLabel}</dt>
            <dd className="mt-1 font-medium">{formatDateTime(startsAt, clinicTimezone, locale)}</dd>
          </div>
          <div className="bg-muted/45 rounded-xl p-3">
            <dt className="text-muted-foreground text-xs">{labels.confirmationClinicLabel}</dt>
            <dd className="mt-1 font-medium">
              {clinicName} — {clinicAddress}
            </dd>
          </div>
          <div className="bg-muted/45 rounded-xl p-3">
            <dt className="text-muted-foreground text-xs">{labels.confirmationPatientLabel}</dt>
            <dd className="mt-1 font-medium">{patientName}</dd>
          </div>
        </dl>

        <a
          href={calendarLink}
          download={`dewini-rendez-vous-${startsAt.slice(0, 10)}.ics`}
          className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 w-full gap-2")}
        >
          <CalendarPlus className="size-4" aria-hidden />
          {labels.addToCalendarAction}
        </a>

        <div className="border-border rounded-lg border p-4">
          <p className="font-heading text-lg font-medium">{labels.nextStepsTitle}</p>
          <p className="text-muted-foreground mt-1">{labels.nextStepsDescription}</p>
        </div>

        <div className="border-border bg-muted/40 rounded-lg border p-3">
          <p className="font-medium">{labels.managementLinkTitle}</p>
          <p className="text-muted-foreground mt-1">{labels.managementLinkDescription}</p>
          {managementLink ? (
            <a
              href={managementLink}
              className="text-primary mt-3 inline-flex min-h-10 items-center gap-2 font-semibold underline-offset-4 hover:underline"
            >
              {labels.manageAppointmentAction}
              <ExternalLink className="size-4" aria-hidden />
            </a>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
