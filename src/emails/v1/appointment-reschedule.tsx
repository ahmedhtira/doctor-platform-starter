import { Button, Heading, Text } from "@react-email/components";
import { EmailLayout } from "./email-layout";

export type AppointmentRescheduleCopy = {
  subject: string;
  heading: string;
  greeting: string;
  introPatient: string;
  introStaff: string;
  doctorLabel: string;
  dateLabel: string;
  clinicLabel: string;
  appointmentTypeLabel: string;
  manageIntro: string;
  manageButtonLabel: string;
  footer: string;
};

/**
 * One file for both reschedule variants — `isStaffInitiated` swaps a
 * single intro sentence (who made the change); everything else is
 * identical structure (PROJECT_SPEC.md's M7 section).
 */
export function AppointmentRescheduleEmail({
  locale,
  copy,
  isStaffInitiated,
  doctorName,
  clinicName,
  clinicAddress,
  formattedDateTime,
  appointmentTypeName,
  managementLink,
}: {
  locale: string;
  copy: AppointmentRescheduleCopy;
  isStaffInitiated: boolean;
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
      <Text>{isStaffInitiated ? copy.introStaff : copy.introPatient}</Text>

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
