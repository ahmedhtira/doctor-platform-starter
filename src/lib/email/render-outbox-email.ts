import { createElement } from "react";
import { createTranslator } from "next-intl";
import { render, toPlainText } from "@react-email/render";
import { AppointmentConfirmationEmail } from "@/emails/v1/appointment-confirmation";
import { AppointmentCancellationEmail } from "@/emails/v1/appointment-cancellation";
import { AppointmentRescheduleEmail } from "@/emails/v1/appointment-reschedule";
import type { EmailOutboxPayload } from "./outbox-payload";

export type RenderOutboxEmailInput = {
  template: string;
  templateVersion: number;
  payload: EmailOutboxPayload;
  locale: string;
  /** Null for templates that don't carry one (appointment_cancellation). */
  managementLink: string | null;
};

export type RenderedEmail = { subject: string; html: string; text: string };

function formatDateTime(iso: string, timezone: string, locale: string): string {
  // dateStyle/timeStyle can't be combined with explicit component options
  // (hour12) in the same formatter — same reasoning as
  // booking-confirmation.tsx's/managed-appointment-view.tsx's formatDateTime.
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

async function loadTranslator(locale: string) {
  const messages = (await import(`../../../messages/${locale}.json`)).default;
  return createTranslator({ locale, messages, namespace: "email.v1" });
}

/**
 * Dispatches on `${template}:${templateVersion}` to the matching
 * src/emails/v1/* component — version 1 is structurally frozen (a future
 * copy/rendering change is a src/emails/v2/ directory, never an edit to
 * these files), so an unrecognized combination is a hard, explicit error
 * rather than a silent mis-render (PROJECT_SPEC.md's M7 section).
 */
export async function renderOutboxEmail(input: RenderOutboxEmailInput): Promise<RenderedEmail> {
  const key = `${input.template}:${input.templateVersion}`;
  const t = await loadTranslator(input.locale);
  const formattedDateTime = formatDateTime(
    input.payload.starts_at,
    input.payload.clinic_timezone,
    input.locale,
  );

  let element: React.ReactElement;
  let subject: string;

  switch (key) {
    case "appointment_confirmation:1": {
      subject = t("confirmation.subject", { doctorName: input.payload.doctor_name });
      if (!input.managementLink) {
        throw new Error("appointment_confirmation requires a managementLink");
      }
      element = createElement(AppointmentConfirmationEmail, {
        locale: input.locale,
        copy: {
          subject,
          heading: t("confirmation.heading"),
          greeting: t("confirmation.greeting", { patientName: input.payload.patient_name }),
          intro: t("confirmation.intro"),
          doctorLabel: t("confirmation.doctorLabel"),
          dateLabel: t("confirmation.dateLabel"),
          clinicLabel: t("confirmation.clinicLabel"),
          appointmentTypeLabel: t("confirmation.appointmentTypeLabel"),
          manageIntro: t("confirmation.manageIntro"),
          manageButtonLabel: t("confirmation.manageButtonLabel"),
          footer: t("confirmation.footer"),
        },
        doctorName: input.payload.doctor_name,
        clinicName: input.payload.clinic_name,
        clinicAddress: input.payload.clinic_address,
        formattedDateTime,
        appointmentTypeName: input.payload.appointment_type_name,
        managementLink: input.managementLink,
      });
      break;
    }
    case "appointment_cancellation:1": {
      subject = t("cancellation.subject", { doctorName: input.payload.doctor_name });
      element = createElement(AppointmentCancellationEmail, {
        locale: input.locale,
        copy: {
          subject,
          heading: t("cancellation.heading"),
          greeting: t("cancellation.greeting", { patientName: input.payload.patient_name }),
          intro: t("cancellation.intro"),
          doctorLabel: t("cancellation.doctorLabel"),
          dateLabel: t("cancellation.dateLabel"),
          clinicLabel: t("cancellation.clinicLabel"),
          footer: t("cancellation.footer"),
        },
        doctorName: input.payload.doctor_name,
        clinicName: input.payload.clinic_name,
        formattedDateTime,
      });
      break;
    }
    case "appointment_reschedule_patient:1":
    case "appointment_reschedule_staff:1": {
      const isStaffInitiated = input.template === "appointment_reschedule_staff";
      subject = t("reschedule.subject", { doctorName: input.payload.doctor_name });
      if (!input.managementLink) {
        throw new Error(`${input.template} requires a managementLink`);
      }
      element = createElement(AppointmentRescheduleEmail, {
        locale: input.locale,
        isStaffInitiated,
        copy: {
          subject,
          heading: t("reschedule.heading"),
          greeting: t("reschedule.greeting", { patientName: input.payload.patient_name }),
          introPatient: t("reschedule.introPatient"),
          introStaff: t("reschedule.introStaff"),
          doctorLabel: t("reschedule.doctorLabel"),
          dateLabel: t("reschedule.dateLabel"),
          clinicLabel: t("reschedule.clinicLabel"),
          appointmentTypeLabel: t("reschedule.appointmentTypeLabel"),
          manageIntro: t("reschedule.manageIntro"),
          manageButtonLabel: t("reschedule.manageButtonLabel"),
          footer: t("reschedule.footer"),
        },
        doctorName: input.payload.doctor_name,
        clinicName: input.payload.clinic_name,
        clinicAddress: input.payload.clinic_address,
        formattedDateTime,
        appointmentTypeName: input.payload.appointment_type_name,
        managementLink: input.managementLink,
      });
      break;
    }
    default:
      throw new Error(`Unknown email template/version combination: ${key}`);
  }

  const html = await render(element);
  const text = toPlainText(html);
  return { subject, html, text };
}

/** Templates that carry a patient management link. */
export function templateHasManagementLink(template: string): boolean {
  return (
    template === "appointment_confirmation" ||
    template === "appointment_reschedule_patient" ||
    template === "appointment_reschedule_staff"
  );
}
