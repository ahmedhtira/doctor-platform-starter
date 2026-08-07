"use client";

import { useLocale } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";

const LABELS: Record<string, string> = { fr: "Français", ar: "العربية" };

export function LocaleSwitcher() {
  const pathname = usePathname();
  const activeLocale = useLocale();

  return (
    <div className="bg-muted ring-foreground/8 inline-flex items-center gap-0.5 rounded-full p-0.5 text-sm ring-1">
      {routing.locales.map((locale) => (
        <Link
          key={locale}
          href={pathname}
          locale={locale}
          aria-current={locale === activeLocale ? "true" : undefined}
          className={cn(
            "rounded-full px-3 py-1 font-medium transition-colors",
            locale === activeLocale
              ? "bg-card text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {LABELS[locale]}
        </Link>
      ))}
    </div>
  );
}
