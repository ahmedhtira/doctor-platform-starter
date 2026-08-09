import { Heading, Text } from "@react-email/components";
import { EmailLayout } from "./email-layout";

export type AppointmentCancellationCopy = {
  subject: string;
  heading: string;
  greeting: string;
  intro: string;
  doctorLabel: string;
  dateLabel: string;
  clinicLabel: string;
  footer: string;
};

/**
 * No management link — a cancelled appointment has nothing left to
 * manage (PROJECT_SPEC.md's M7 section).
 */
export function AppointmentCancellationEmail({
  locale,
  copy,
  doctorName,
  clinicName,
  formattedDateTime,
}: {
  locale: string;
  copy: AppointmentCancellationCopy;
  doctorName: string;
  clinicName: string;
  formattedDateTime: string;
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
        <strong>{copy.clinicLabel}:</strong> {clinicName}
      </Text>
    </EmailLayout>
  );
}
