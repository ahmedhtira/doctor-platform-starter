"use client";

import { useLocale } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

const LABELS: Record<string, string> = { fr: "Français", ar: "العربية" };

export function LocaleSwitcher() {
  const pathname = usePathname();
  const activeLocale = useLocale();

  return (
    <div className="flex items-center gap-3 text-sm">
      {routing.locales.map((locale) => (
        <Link
          key={locale}
          href={pathname}
          locale={locale}
          aria-current={locale === activeLocale ? "true" : undefined}
          className={
            locale === activeLocale
              ? "font-semibold underline"
              : "text-muted-foreground hover:underline"
          }
        >
          {LABELS[locale]}
        </Link>
      ))}
    </div>
  );
}
