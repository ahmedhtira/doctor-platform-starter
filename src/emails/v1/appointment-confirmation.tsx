import { Button, Heading, Text } from "@react-email/components";
import { EmailLayout } from "./email-layout";

export type AppointmentConfirmationCopy = {
  subject: string;
  heading: string;
  greeting: string;
  intro: string;
  doctorLabel: string;
  dateLabel: string;
  clinicLabel: string;
  appointmentTypeLabel: string;
  manageIntro: string;
  manageButtonLabel: string;
  footer: string;
};

/**
 * Presentational only — every string arrives pre-translated and every
 * date/time arrives pre-formatted, same discipline as SlotPicker
 * (src/components/booking/slot-picker.tsx). No next-intl/Zod/Luxon here.
 */
export function AppointmentConfirmationEmail({
  locale,
  copy,
  doctorName,
  clinicName,
  clinicAddress,
  formattedDateTime,
  appointmentTypeName,
  managementLink,
}: {
  locale: string;
  copy: AppointmentConfirmationCopy;
  doctorName: string;
  clinicName: string;
  clinicAddress: string;
  formattedDateTime: string;
  appointmentTypeName: string;
  managementLink: string;
}) {
  return (
    <EmailLayout locale={locale} previewText={copy.heading} footerText={copy.footer}>
      <Heading style={{ fontSize: "20px" }}>{copy.heading}</Heading>
      <Text>{copy.greeting}</Text>
      <Text>{copy.intro}</Text>

      <Text style={{ margin: "4px 0" }}>
        <strong>{copy.doctorLabel}:</strong> {doctorName}
      </Text>
      <Text style={{ margin: "4px 0" }}>
        <strong>{copy.dateLabel}:</strong> {formattedDateTime}
      </Text>
      <Text style={{ margin: "4px 0" }}>
        <strong>{copy.clinicLabel}:</strong> {clinicName} — {clinicAddress}
      </Text>
      <Text style={{ margin: "4px 0" }}>
        <strong>{copy.appointmentTypeLabel}:</strong> {appointmentTypeName}
      </Text>

      <Text style={{ marginTop: "24px" }}>{copy.manageIntro}</Text>
      <Button
        href={managementLink}
        style={{
          backgroundColor: "#18181b",
          color: "#ffffff",
          padding: "10px 20px",
          borderRadius: "6px",
          fontSize: "14px",
        }}
      >
        {copy.manageButtonLabel}
      </Button>
      <Text style={{ fontSize: "12px", wordBreak: "break-all" }}>{managementLink}</Text>
    </EmailLayout>
  );
}
