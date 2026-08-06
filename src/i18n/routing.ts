import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["fr", "ar"],
  defaultLocale: "fr",
  localePrefix: "always",
});

export const rtlLocales: ReadonlySet<string> = new Set(["ar"]);

export function directionForLocale(locale: string): "ltr" | "rtl" {
  return rtlLocales.has(locale) ? "rtl" : "ltr";
}
