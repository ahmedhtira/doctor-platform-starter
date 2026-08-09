import { Body, Container, Head, Hr, Html, Preview, Text } from "@react-email/components";
import { directionForLocale } from "@/i18n/routing";

/**
 * Shared shell for every v1 template. Frozen alongside the rest of v1
 * (PROJECT_SPEC.md's M7 section) — a future rendering/copy change is a
 * src/emails/v2/ directory, not an edit here.
 *
 * RTL: `dir` on <Html> plus explicit inline `text-align` on the body
 * text — many email clients honor the inline style more reliably than
 * CSS `direction` alone.
 */
export function EmailLayout({
  locale,
  previewText,
  footerText,
  children,
}: {
  locale: string;
  previewText: string;
  footerText: string;
  children: React.ReactNode;
}) {
  const direction = directionForLocale(locale);
  const textAlign = direction === "rtl" ? "right" : "left";

  return (
    <Html dir={direction} lang={locale}>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={{ backgroundColor: "#f4f4f5", fontFamily: "sans-serif", padding: "24px 0" }}>
        <Container
          dir={direction}
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "8px",
            padding: "32px",
            maxWidth: "480px",
            textAlign,
          }}
        >
          {children}
          <Hr style={{ borderColor: "#e4e4e7", margin: "24px 0" }} />
          <Text style={{ fontSize: "12px", color: "#71717a", textAlign }}>{footerText}</Text>
        </Container>
      </Body>
    </Html>
  );
}
