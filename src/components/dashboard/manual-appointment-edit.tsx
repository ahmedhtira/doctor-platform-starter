"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { updateStaffAppointmentDetailsAction } from "@/app/[locale]/(dashboard)/dashboard/manual-appointment-update-actions";
import type { DashboardAppointment } from "@/lib/dashboard/fetch-dashboard-appointments";
import type { DashboardAppointmentTypeOption } from "./appointment-list";

const COPY = {
  fr: {
    action: "Modifier les détails",
    title: "Modifier le rendez-vous manuel",
    patientName: "Nom du patient",
    phone: "Téléphone",
    email: "E-mail",
    appointmentType: "Type de consultation",
    notes: "Note interne",
    optional: "Optionnel",
    save: "Enregistrer",
    saving: "Enregistrement…",
    cancel: "Annuler",
    validation: "Vérifiez les informations saisies.",
    started: "Ce rendez-vous a déjà commencé et ses détails ne peuvent plus être modifiés ici.",
    conflict: "La nouvelle durée chevauche un autre rendez-vous.",
    schedule: "La nouvelle durée ne respecte pas le planning disponible.",
    session: "Votre session a expiré. Reconnectez-vous.",
    unknown: "Impossible de modifier le rendez-vous.",
  },
  ar: {
    action: "تعديل التفاصيل",
    title: "تعديل الموعد اليدوي",
    patientName: "اسم المريض",
    phone: "الهاتف",
    email: "البريد الإلكتروني",
    appointmentType: "نوع الاستشارة",
    notes: "ملاحظة داخلية",
    optional: "اختياري",
    save: "حفظ",
    saving: "جارٍ الحفظ…",
    cancel: "إلغاء",
    validation: "تحقق من المعلومات المدخلة.",
    started: "لقد بدأ هذا الموعد ولا يمكن تعديل تفاصيله من هنا بعد الآن.",
    conflict: "المدة الجديدة تتداخل مع موعد آخر.",
    schedule: "المدة الجديدة لا تتوافق مع الجدول المتاح.",
    session: "انتهت الجلسة. سجّل الدخول من جديد.",
    unknown: "تعذر تعديل الموعد.",
  },
} as const;

export function ManualAppointmentEdit({
  appointment,
  appointmentTypes,
  locale,
}: {
  appointment: DashboardAppointment;
  appointmentTypes: DashboardAppointmentTypeOption[];
  locale: string;
}) {
  const copy = locale === "ar" ? COPY.ar : COPY.fr;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const startsAtMs = new Date(appointment.startsAt).getTime();
  const hasStarted = startsAtMs <= nowMs;

  const [patientName, setPatientName] = useState(appointment.patientName);
  const [patientPhone, setPatientPhone] = useState(appointment.patientPhone);
  const [patientEmail, setPatientEmail] = useState(appointment.patientEmail ?? "");
  const [appointmentTypeId, setAppointmentTypeId] = useState(appointment.appointmentTypeId);
  const [notes, setNotes] = useState(appointment.notes ?? "");

  useEffect(() => {
    if (!Number.isFinite(startsAtMs) || startsAtMs <= nowMs) return;
    const timer = window.setTimeout(
      () => setNowMs(Date.now()),
      Math.max(0, startsAtMs - Date.now() + 100),
    );
    return () => window.clearTimeout(timer);
  }, [startsAtMs, nowMs]);

  function beginEditing() {
    setPatientName(appointment.patientName);
    setPatientPhone(appointment.patientPhone);
    setPatientEmail(appointment.patientEmail ?? "");
    setAppointmentTypeId(appointment.appointmentTypeId);
    setNotes(appointment.notes ?? "");
    setError(null);
    setEditing(true);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await updateStaffAppointmentDetailsAction({
        appointmentId: appointment.id,
        appointmentTypeId,
        patientName,
        patientPhone,
        patientEmail: patientEmail.trim() || null,
        notes: notes.trim() || null,
      });

      if (!result.success) {
        switch (result.errorCode) {
          case "VALIDATION_ERROR":
            setError(copy.validation);
            break;
          case "APPOINTMENT_STARTED":
          case "NOT_MODIFIABLE":
            setError(copy.started);
            break;
          case "SLOT_UNAVAILABLE":
            setError(copy.conflict);
            break;
          case "SCHEDULE_CHANGED":
            setError(copy.schedule);
            break;
          case "SESSION_INVALID":
          case "UNAUTHENTICATED":
            setError(copy.session);
            break;
          default:
            setError(copy.unknown);
        }
        return;
      }

      setEditing(false);
      router.refresh();
    });
  }

  if (hasStarted) return null;

  if (!editing) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={beginEditing}>
        {copy.action}
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="border-border mt-3 space-y-3 rounded-lg border p-3">
      <p className="font-medium">{copy.title}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium">
          {copy.patientName}
          <input
            required
            maxLength={120}
            value={patientName}
            onChange={(event) => setPatientName(event.target.value)}
            className="border-input bg-background h-9 rounded-md border px-2 font-normal"
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          {copy.phone}
          <input
            required
            maxLength={40}
            value={patientPhone}
            onChange={(event) => setPatientPhone(event.target.value)}
            className="border-input bg-background h-9 rounded-md border px-2 font-normal"
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          {copy.email}
          <input
            type="email"
            maxLength={254}
            value={patientEmail}
            onChange={(event) => setPatientEmail(event.target.value)}
            placeholder={copy.optional}
            className="border-input bg-background h-9 rounded-md border px-2 font-normal"
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          {copy.appointmentType}
          <select
            required
            value={appointmentTypeId}
            onChange={(event) => setAppointmentTypeId(event.target.value)}
            className="border-input bg-background h-9 rounded-md border px-2 font-normal"
          >
            {appointmentTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name} · {type.durationMinutes} min
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium sm:col-span-2">
          {copy.notes}
          <textarea
            rows={2}
            maxLength={1000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={copy.optional}
            className="border-input bg-background resize-y rounded-md border px-2 py-1.5 font-normal"
          />
        </label>
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending || appointmentTypes.length === 0}>
          {pending ? copy.saving : copy.save}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setError(null);
            setEditing(false);
          }}
        >
          {copy.cancel}
        </Button>
      </div>
    </form>
  );
}
