"use client";

import { useMemo } from "react";
import { CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function formatDateTime(iso: string, timezone: string, locale: string): string {
  // dateStyle/timeStyle can't be combined with explicit component options
  // (hour12) in the same formatter — Intl.DateTimeFormat throws a
  // RangeError if you try. Two formatters, joined, instead.
  const intlLocale = locale === "ar" ? "ar-TN-u-nu-latn" : "fr-TN";
  const date = new Date(iso);
  const datePart = new Intl.DateTimeFormat(intlLocale, { dateStyle: "full", timeZone: timezone }).format(
    date,
  );
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="text-primary size-5" aria-hidden />
          <CardTitle>{labels.confirmationTitle}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">{labels.confirmationSummaryIntro}</p>

        <dl className="space-y-2.5">
          <div>
            <dt className="text-muted-foreground text-xs">{labels.confirmationDoctorLabel}</dt>
            <dd className="font-medium">{doctorName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{labels.confirmationDateLabel}</dt>
            <dd className="font-medium">{formatDateTime(startsAt, clinicTimezone, locale)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{labels.confirmationClinicLabel}</dt>
            <dd className="font-medium">
              {clinicName} — {clinicAddress}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{labels.confirmationPatientLabel}</dt>
            <dd className="font-medium">{patientName}</dd>
          </div>
        </dl>

        <div className="border-border bg-muted/40 rounded-lg border p-3">
          <p className="font-medium">{labels.managementLinkTitle}</p>
          <p className="text-muted-foreground mt-1">{labels.managementLinkDescription}</p>
          {managementLink ? (
            <a href={managementLink} className="mt-2 block font-mono text-xs break-all underline">
              {managementLink}
            </a>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
