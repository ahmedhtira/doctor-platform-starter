import { createElement } from "react";
import { createTranslator } from "next-intl";
import { render, toPlainText } from "@react-email/render";
import { DoctorInviteEmail } from "@/emails/v1/doctor-invite";
import { PasswordResetEmail } from "@/emails/v1/password-reset";

export type AccountEmailTemplate = "doctor_invite" | "password_reset";

export type RenderAccountEmailInput = {
  template: AccountEmailTemplate;
  locale: string;
  actionLink: string;
};

export type RenderedEmail = { subject: string; html: string; text: string };

async function loadTranslator(locale: string) {
  const messages = (await import(`../../../messages/${locale}.json`)).default;
  return createTranslator({ locale, messages, namespace: "email.v1" });
}

/**
 * Separate, deliberately simpler dispatcher from render-outbox-email.ts
 * (left untouched — appointment emails keep using the M7 outbox exactly
 * as before). No template_version dispatch: nothing here is ever
 * stored-and-retried later (see PROJECT_SPEC.md's M10 section — invite/
 * reset links are transient and sent immediately), so there's no
 * future-template-drift risk that mechanism exists to guard against for
 * the appointment templates.
 */
export async function renderAccountEmail(input: RenderAccountEmailInput): Promise<RenderedEmail> {
  const t = await loadTranslator(input.locale);
  let element: React.ReactElement;
  let subject: string;

  switch (input.template) {
    case "doctor_invite": {
      subject = t("doctorInvite.subject");
      element = createElement(DoctorInviteEmail, {
        locale: input.locale,
        copy: {
          subject,
          heading: t("doctorInvite.heading"),
          greeting: t("doctorInvite.greeting"),
          intro: t("doctorInvite.intro"),
          actionButtonLabel: t("doctorInvite.actionButtonLabel"),
          expiryNotice: t("doctorInvite.expiryNotice"),
          footer: t("doctorInvite.footer"),
        },
        actionLink: input.actionLink,
      });
      break;
    }
    case "password_reset": {
      subject = t("passwordReset.subject");
      element = createElement(PasswordResetEmail, {
        locale: input.locale,
        copy: {
          subject,
          heading: t("passwordReset.heading"),
          greeting: t("passwordReset.greeting"),
          intro: t("passwordReset.intro"),
          actionButtonLabel: t("passwordReset.actionButtonLabel"),
          expiryNotice: t("passwordReset.expiryNotice"),
          ignoreNotice: t("passwordReset.ignoreNotice"),
          footer: t("passwordReset.footer"),
        },
        actionLink: input.actionLink,
      });
      break;
    }
  }

  const html = await render(element);
  const text = toPlainText(html);
  return { subject, html, text };
}
