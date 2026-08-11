import { Button, Heading, Text } from "@react-email/components";
import { EmailLayout } from "./email-layout";

export type PasswordResetCopy = {
  subject: string;
  heading: string;
  greeting: string;
  intro: string;
  actionButtonLabel: string;
  expiryNotice: string;
  ignoreNotice: string;
  footer: string;
};

/** Presentational only — same shape as DoctorInviteEmail. */
export function PasswordResetEmail({
  locale,
  copy,
  actionLink,
}: {
  locale: string;
  copy: PasswordResetCopy;
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
      <Text style={{ fontSize: "12px", color: "#71717a" }}>{copy.ignoreNotice}</Text>
    </EmailLayout>
  );
}
