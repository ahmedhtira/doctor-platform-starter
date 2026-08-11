import { StandardDoctorPage } from "./standard-doctor-page";
import { DrAmiraPremiumTemplate } from "./dr-amira-premium";
import type { DoctorTemplateComponent } from "./types";

/**
 * The single source of truth for which custom_template_key values are
 * valid — not a DB constraint (see migration 20260101000022's comment on
 * why). Adding a real custom template later is: write the component,
 * add one entry here, tell the admin the key to enter on that doctor's
 * edit page. Never a stored-HTML/page-builder mechanism.
 */
const CUSTOM_TEMPLATE_REGISTRY: Record<string, DoctorTemplateComponent> = {
  "dr-amira-premium": DrAmiraPremiumTemplate,
};

export const CUSTOM_TEMPLATE_KEYS = Object.keys(CUSTOM_TEMPLATE_REGISTRY);

/**
 * Never throws, never returns null/undefined — an unregistered, missing,
 * or otherwise invalid custom_template_key silently falls back to the
 * standard template. This is what makes admin data-entry mistakes safe:
 * worst case, a doctor's page just looks standard instead of custom,
 * never a crash or a 404.
 */
export function resolveDoctorTemplate(
  pageVariant: string,
  customTemplateKey: string | null,
): DoctorTemplateComponent {
  if (pageVariant === "custom" && customTemplateKey && customTemplateKey in CUSTOM_TEMPLATE_REGISTRY) {
    return CUSTOM_TEMPLATE_REGISTRY[customTemplateKey];
  }
  return StandardDoctorPage;
}
