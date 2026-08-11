import { Button, Heading, Text } from "@react-email/components";
import { EmailLayout } from "./email-layout";

export type DoctorInviteCopy = {
  subject: string;
  heading: string;
  greeting: string;
  intro: string;
  actionButtonLabel: string;
  expiryNotice: string;
  footer: string;
};

/**
 * Presentational only, same discipline as AppointmentConfirmationEmail —
 * no next-intl/Zod here. Deliberately generic (no recipient name prop):
 * nothing in this schema stores a display name for an invited doctor
 * before their own doctors row exists. Unlike the appointment templates,
 * this one is never rendered from a stored email_outbox row — see
 * PROJECT_SPEC.md's M10 section on why invite/reset links are sent
 * immediately and never persisted.
 */
export function DoctorInviteEmail({
  locale,
  copy,
  actionLink,
}: {
  locale: string;
  copy: DoctorInviteCopy;
  actionLink: string;
}) {
  return (
    <EmailLayout locale={locale} previewText={copy.heading} footerText={copy.footer}>
      <Heading style={{ fontSize: "20px" }}>{copy.heading}</Heading>
      <Text>{copy.greeting}</Text>
      <Text>{copy.intro}</Text>

      <Button
        href={actionLink}
        style={{
          backgroundColor: "#18181b",
          color: "#ffffff",
          padding: "10px 20px",
          borderRadius: "6px",
          fontSize: "14px",
          marginTop: "16px",
        }}
      >
        {copy.actionButtonLabel}
      </Button>
      <Text style={{ fontSize: "12px", wordBreak: "break-all" }}>{actionLink}</Text>
      <Text style={{ fontSize: "12px", color: "#71717a" }}>{copy.expiryNotice}</Text>
    </EmailLayout>
  );
}
