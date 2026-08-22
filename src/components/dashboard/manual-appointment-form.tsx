"use client";

import { useState, useTransition, type FormEvent } from "react";
import { DateTime } from "luxon";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { createStaffAppointmentAction } from "@/app/[locale]/(dashboard)/dashboard/actions";

export type ManualAppointmentClinicOption = {
  id: string;
  name: string;
  timezone: string;
};

export type ManualAppointmentTypeOption = {
  id: string;
  name: string;
  durationMinutes: number;
};

const COPY = {
  fr: {
    addAction: "Ajouter un rendez-vous",
    success: "Rendez-vous ajouté.",
    missingConfiguration: "Ajoutez d'abord un cabinet et un type de consultation.",
    title: "Ajouter un rendez-vous",
    description: "Enregistrez un rendez-vous pris par téléphone, au cabinet ou autrement.",
    closeAction: "Fermer",
    patientNameLabel: "Nom du patient",
    patientPhoneLabel: "Téléphone",
    patientEmailLabel: "E-mail",
    clinicLabel: "Cabinet",
    appointmentTypeLabel: "Type de consultation",
    dateLabel: "Date",
    timeLabel: "Heure",
    notesLabel: "Note interne",
    optionalPlaceholder: "Optionnel",
    creating: "Ajout en cours…",
    confirmAction: "Ajouter le rendez-vous",
    cancelAction: "Annuler",
    errorSlotUnavailable: "Ce créneau est déjà occupé. Choisissez une autre heure.",
    errorSchedule: "Ce créneau est hors horaires, en pause ou bloqué.",
    errorSession: "Votre session a expiré. Reconnectez-vous.",
    errorValidation: "Vérifiez les informations saisies.",
    errorUnknown: "Impossible d'ajouter le rendez-vous. Réessayez.",
  },
  ar: {
    addAction: "إضافة موعد",
    success: "تمت إضافة الموعد.",
    missingConfiguration: "أضف عيادة ونوع استشارة أولاً.",
    title: "إضافة موعد",
    description: "سجّل موعدًا تم أخذه عبر الهاتف أو في العيادة أو بأي طريقة أخرى.",
    closeAction: "إغلاق",
    patientNameLabel: "اسم المريض",
    patientPhoneLabel: "الهاتف",
    patientEmailLabel: "البريد الإلكتروني",
    clinicLabel: "العيادة",
    appointmentTypeLabel: "نوع الاستشارة",
    dateLabel: "التاريخ",
    timeLabel: "الوقت",
    notesLabel: "ملاحظة داخلية",
    optionalPlaceholder: "اختياري",
    creating: "جارٍ الإضافة…",
    confirmAction: "إضافة الموعد",
    cancelAction: "إلغاء",
    errorSlotUnavailable: "هذا الوقت محجوز بالفعل. اختر وقتًا آخر.",
    errorSchedule: "هذا الوقت خارج ساعات العمل أو خلال استراحة أو فترة محجوبة.",
    errorSession: "انتهت جلستك. يرجى تسجيل الدخول من جديد.",
    errorValidation: "تحقق من المعلومات المدخلة.",
    errorUnknown: "تعذر إضافة الموعد. حاول مرة أخرى.",
  },
} as const;

type CopyKey = keyof (typeof COPY)["fr"];
type Copy = Record<CopyKey, string>;

function actionErrorMessage(copy: Copy, code: string): string {
  switch (code) {
    case "SLOT_UNAVAILABLE":
      return copy.errorSlotUnavailable;
    case "SCHEDULE_CHANGED":
      return copy.errorSchedule;
    case "UNAUTHENTICATED":
    case "SESSION_INVALID":
      return copy.errorSession;
    case "VALIDATION_ERROR":
      return copy.errorValidation;
    default:
      return copy.errorUnknown;
  }
}

export function ManualAppointmentForm({
  doctorId,
  clinics,
  appointmentTypes,
  defaultDate,
}: {
  doctorId: string;
  clinics: ManualAppointmentClinicOption[];
  appointmentTypes: ManualAppointmentTypeOption[];
  defaultDate: string;
}) {
  const locale = useLocale();
  const copy: Copy = locale === "ar" ? COPY.ar : COPY.fr;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [clinicId, setClinicId] = useState(clinics[0]?.id ?? "");
  const [appointmentTypeId, setAppointmentTypeId] = useState(appointmentTypes[0]?.id ?? "");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("09:00");
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [patientEmail, setPatientEmail] = useState("");
  const [notes, setNotes] = useState("");

  const canCreate = clinics.length > 0 && appointmentTypes.length > 0;

  function resetPatientFields() {
    setPatientName("");
    setPatientPhone("");
    setPatientEmail("");
    setNotes("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(false);

    const clinic = clinics.find((item) => item.id === clinicId);
    if (!clinic || !appointmentTypeId || !date || !time) {
      setError(copy.errorValidation);
      return;
    }

    const startsAt = DateTime.fromISO(`${date}T${time}`, { zone: clinic.timezone });
    if (!startsAt.isValid) {
      setError(copy.errorValidation);
      return;
    }

    startTransition(async () => {
      const result = await createStaffAppointmentAction({
        doctorId,
        clinicId,
        appointmentTypeId,
        startsAt: startsAt.toISO(),
        patientName,
        patientPhone,
        patientEmail: patientEmail.trim() || null,
        notes: notes.trim() || null,
      });

      if (!result.success) {
        setError(actionErrorMessage(copy, result.errorCode));
        return;
      }

      resetPatientFields();
      setOpen(false);
      setSuccess(true);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => {
            setError(null);
            setSuccess(false);
            setOpen(true);
          }}
          disabled={!canCreate}
          className="gap-2"
        >
          <Plus className="size-4" aria-hidden />
          {copy.addAction}
        </Button>
        {success ? <p className="text-primary text-sm font-medium">{copy.success}</p> : null}
        {!canCreate ? (
          <p className="text-muted-foreground text-sm">{copy.missingConfiguration}</p>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="bg-card w-full rounded-2xl border p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-medium">{copy.title}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{copy.description}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setOpen(false)}
          disabled={pending}
          aria-label={copy.closeAction}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-1.5 text-sm font-medium">
          {copy.patientNameLabel}
          <input
            required
            maxLength={120}
            value={patientName}
            onChange={(event) => setPatientName(event.target.value)}
            className="border-input bg-background h-10 rounded-lg border px-3 font-normal outline-none focus-visible:ring-2"
          />
        </label>

        <label className="grid gap-1.5 text-sm font-medium">
          {copy.patientPhoneLabel}
          <input
            required
            maxLength={40}
            inputMode="tel"
            value={patientPhone}
            onChange={(event) => setPatientPhone(event.target.value)}
            className="border-input bg-background h-10 rounded-lg border px-3 font-normal outline-none focus-visible:ring-2"
          />
        </label>

        <label className="grid gap-1.5 text-sm font-medium">
          {copy.patientEmailLabel}
          <input
            type="email"
            maxLength={254}
            value={patientEmail}
            onChange={(event) => setPatientEmail(event.target.value)}
            placeholder={copy.optionalPlaceholder}
            className="border-input bg-background h-10 rounded-lg border px-3 font-normal outline-none focus-visible:ring-2"
          />
        </label>

        <label className="grid gap-1.5 text-sm font-medium">
          {copy.clinicLabel}
          <select
            required
            value={clinicId}
            onChange={(event) => setClinicId(event.target.value)}
            className="border-input bg-background h-10 rounded-lg border px-3 font-normal outline-none focus-visible:ring-2"
          >
            {clinics.map((clinic) => (
              <option key={clinic.id} value={clinic.id}>
                {clinic.name}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-sm font-medium">
          {copy.appointmentTypeLabel}
          <select
            required
            value={appointmentTypeId}
            onChange={(event) => setAppointmentTypeId(event.target.value)}
            className="border-input bg-background h-10 rounded-lg border px-3 font-normal outline-none focus-visible:ring-2"
          >
            {appointmentTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name} · {type.durationMinutes} min
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5 text-sm font-medium">
            {copy.dateLabel}
            <input
              required
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="border-input bg-background h-10 min-w-0 rounded-lg border px-2 font-normal outline-none focus-visible:ring-2"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            {copy.timeLabel}
            <input
              required
              type="time"
              step={900}
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className="border-input bg-background h-10 min-w-0 rounded-lg border px-2 font-normal outline-none focus-visible:ring-2"
            />
          </label>
        </div>

        <label className="grid gap-1.5 text-sm font-medium sm:col-span-2 lg:col-span-3">
          {copy.notesLabel}
          <textarea
            rows={2}
            maxLength={1000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={copy.optionalPlaceholder}
            className="border-input bg-background resize-y rounded-lg border px-3 py-2 font-normal outline-none focus-visible:ring-2"
          />
        </label>
      </div>

      {error ? <p className="text-destructive mt-4 text-sm">{error}</p> : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || !canCreate}>
          {pending ? copy.creating : copy.confirmAction}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
          {copy.cancelAction}
        </Button>
      </div>
    </form>
  );
}
