"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SlotPicker } from "@/components/booking/slot-picker";
import {
  cancelManagedAppointmentAction,
  getManageSlotsAction,
  rescheduleManagedAppointmentAction,
} from "@/app/[locale]/(public)/manage/actions";
import type { AvailableSlot } from "@/lib/availability/compute-available-slots";
import type { ManagedAppointmentView as ManagedAppointmentData } from "@/lib/booking/get-managed-appointment";
import { isoDateInTimeZone } from "@/lib/datetime/local-date";

type Mode = "view" | "confirmingCancel" | "rescheduling" | "rescheduled";

function formatDateTime(iso: string, timezone: string, locale: string): string {
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

export function ManagedAppointmentView({
  appointment,
  locale,
}: {
  appointment: ManagedAppointmentData;
  locale: string;
}) {
  const t = useTranslations("manage");
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("view");
  const [actionPending, startActionTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  const [date, setDate] = useState(() => isoDateInTimeZone(appointment.clinicTimezone));
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slotsLoading, startSlotsTransition] = useTransition();
  const [rawSelectedSlotStart, setRawSelectedSlotStart] = useState<string | null>(null);
  const selectedSlotStart =
    rawSelectedSlotStart !== null && slots.some((slot) => slot.slotStart === rawSelectedSlotStart)
      ? rawSelectedSlotStart
      : null;

  const [rescheduled, setRescheduled] = useState<{
    startsAt: string;
    managementToken: string;
  } | null>(null);

  // Keep the just-rescheduled time authoritative immediately while the
  // Server Component refresh catches up.
  const currentAppointment = rescheduled
    ? { ...appointment, startsAt: rescheduled.startsAt }
    : appointment;

  const [nowMs, setNowMs] = useState(() => Date.now());
  const appointmentStartMs = new Date(currentAppointment.startsAt).getTime();
  const hasStarted = appointmentStartMs <= nowMs;
  const canModify = currentAppointment.status === "confirmed" && !hasStarted;

  // A management page can stay open across the appointment start time.
  // Re-evaluate exactly at that boundary so mutation controls disappear
  // without polling or requiring a manual refresh.
  useEffect(() => {
    if (!Number.isFinite(appointmentStartMs) || appointmentStartMs <= nowMs) return;
    const timer = window.setTimeout(
      () => setNowMs(Date.now()),
      Math.max(0, appointmentStartMs - Date.now() + 100),
    );
    return () => window.clearTimeout(timer);
  }, [appointmentStartMs, nowMs]);

  const refreshSlots = useCallback((forDate: string) => {
    startSlotsTransition(async () => {
      const result = await getManageSlotsAction(forDate);
      setSlots(result.success ? result.slots : []);
    });
  }, []);

  function errorMessageFor(code: string): string {
    switch (code) {
      case "SESSION_INVALID":
        return t("errorSessionExpired");
      case "APPOINTMENT_NOT_FOUND":
        return t("errorAppointmentNotFound");
      case "NOT_MODIFIABLE":
      case "APPOINTMENT_STARTED":
        return t("errorNotModifiable");
      case "SLOT_UNAVAILABLE":
        return t("errorSlotUnavailable");
      case "SCHEDULE_CHANGED":
        return t("errorScheduleChanged");
      default:
        return t("errorUnknown");
    }
  }

  function beginReschedule() {
    if (!canModify) return;
    setActionError(null);
    setMode("rescheduling");
    setRawSelectedSlotStart(null);
    refreshSlots(date);
  }

  function handleDateChange(nextDate: string) {
    setDate(nextDate);
    setRawSelectedSlotStart(null);
    refreshSlots(nextDate);
  }

  function handleCancel() {
    startActionTransition(async () => {
      const result = await cancelManagedAppointmentAction();
      if (result.success) {
        router.refresh();
        return;
      }
      setActionError(errorMessageFor(result.errorCode));
      setMode("view");
    });
  }

  function handleConfirmReschedule() {
    if (!selectedSlotStart) return;
    startActionTransition(async () => {
      const result = await rescheduleManagedAppointmentAction(selectedSlotStart);
      if (result.success) {
        setRescheduled({
          startsAt: result.appointment.starts_at,
          managementToken: result.managementToken,
        });
        setMode("rescheduled");
        return;
      }

      if (result.errorCode === "SLOT_UNAVAILABLE" || result.errorCode === "SCHEDULE_CHANGED") {
        setActionError(errorMessageFor(result.errorCode));
        setRawSelectedSlotStart(null);
        refreshSlots(date);
        return;
      }

      setActionError(errorMessageFor(result.errorCode));
    });
  }

  const managementLink = useMemo(() => {
    if (!rescheduled || typeof window === "undefined") {
      return "";
    }
    return `${window.location.origin}/${locale}/manage#token=${rescheduled.managementToken}`;
  }, [rescheduled, locale]);

  if (mode === "rescheduled" && rescheduled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("rescheduleSuccessTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">{t("rescheduleSuccessMessage")}</p>
          <div>
            <p className="text-muted-foreground text-xs">{t("dateLabel")}</p>
            <p className="font-medium">
              {formatDateTime(rescheduled.startsAt, appointment.clinicTimezone, locale)}
            </p>
          </div>

          <div className="border-border bg-muted/40 rounded-lg border p-3">
            <p className="font-medium">{t("managementLinkTitle")}</p>
            <p className="text-muted-foreground mt-1">{t("managementLinkDescription")}</p>
            {managementLink ? (
              <a href={managementLink} className="mt-2 block font-mono text-xs break-all underline">
                {managementLink}
              </a>
            ) : null}
          </div>

          <Button
            variant="outline"
            onClick={() => {
              setMode("view");
              router.refresh();
            }}
          >
            {t("backToAppointment")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (mode === "rescheduling" && canModify) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("rescheduleAction")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SlotPicker
            date={date}
            onDateChange={handleDateChange}
            minDate={isoDateInTimeZone(appointment.clinicTimezone)}
            slots={slots}
            selectedSlotStart={selectedSlotStart}
            onSelectSlot={setRawSelectedSlotStart}
            clinicTimezone={appointment.clinicTimezone}
            locale={locale}
            loading={slotsLoading}
            dateLabel={t("rescheduleDateLabel")}
            loadingLabel={t("rescheduleSlotsLoading")}
            emptyLabel={t("rescheduleSlotsEmpty")}
          />

          {actionError ? <p className="text-destructive text-sm">{actionError}</p> : null}

          <div className="flex gap-2">
            <Button
              onClick={handleConfirmReschedule}
              disabled={!selectedSlotStart || actionPending}
            >
              {actionPending ? t("rescheduling") : t("rescheduleConfirmAction")}
            </Button>
            <Button
              variant="outline"
              disabled={actionPending}
              onClick={() => {
                setActionError(null);
                setMode("view");
              }}
            >
              {t("rescheduleBackAction")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const statusLabel =
    currentAppointment.status === "confirmed"
      ? t("status.confirmed")
      : currentAppointment.status === "cancelled"
        ? t("status.cancelled")
        : currentAppointment.status === "completed"
          ? t("status.completed")
          : t("status.noShow");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <dl className="space-y-2.5">
          <div>
            <dt className="text-muted-foreground text-xs">{t("doctorLabel")}</dt>
            <dd className="font-medium">{currentAppointment.doctorName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t("dateLabel")}</dt>
            <dd className="font-medium">
              {formatDateTime(
                currentAppointment.startsAt,
                currentAppointment.clinicTimezone,
                locale,
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t("clinicLabel")}</dt>
            <dd className="font-medium">
              {currentAppointment.clinicName} — {currentAppointment.clinicAddress}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t("appointmentTypeLabel")}</dt>
            <dd className="font-medium">{currentAppointment.appointmentTypeName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t("patientLabel")}</dt>
            <dd className="font-medium">{currentAppointment.patientName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t("statusLabel")}</dt>
            <dd>
              <Badge variant={currentAppointment.status === "confirmed" ? "default" : "secondary"}>
                {statusLabel}
              </Badge>
            </dd>
          </div>
        </dl>

        {actionError ? <p className="text-destructive text-sm">{actionError}</p> : null}

        {canModify ? (
          mode === "confirmingCancel" ? (
            <div className="space-y-3 border-t pt-4">
              <p>{t("cancelConfirmPrompt")}</p>
              <div className="flex gap-2">
                <Button variant="destructive" onClick={handleCancel} disabled={actionPending}>
                  {actionPending ? t("cancelling") : t("cancelConfirmYes")}
                </Button>
                <Button variant="outline" onClick={() => setMode("view")} disabled={actionPending}>
                  {t("cancelConfirmNo")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 border-t pt-4">
              <Button variant="outline" onClick={beginReschedule}>
                {t("rescheduleAction")}
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setActionError(null);
                  setMode("confirmingCancel");
                }}
              >
                {t("cancelAction")}
              </Button>
            </div>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
