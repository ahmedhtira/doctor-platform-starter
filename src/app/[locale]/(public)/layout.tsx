import type { ReactNode } from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "@/components/locale-switcher";

// Doctor/secretary login is deliberately not in this header — the staff
// workspace (login → dashboard) is a separate, desktop-first flow, not
// part of patient browsing. It's reachable only via the quiet footer link
// below (see PROJECT_SPEC.md M2.5).
export default function PublicLayout({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const locale = useLocale();

  return (
    <>
      <header className="border-border/70 bg-background/85 sticky top-0 z-40 border-b backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <Link href="/" aria-label={t("nav.home")} className="flex items-center rounded-md">
            <Image
              src="/dewini-logo.png"
              alt="Dewini"
              width={1266}
              height={552}
              priority
              className="h-8 w-auto sm:h-10"
            />
          </Link>
          <LocaleSwitcher />
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-border/70 border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 py-6 text-center text-sm sm:flex-row sm:justify-between sm:px-6 sm:text-start">
          <p className="text-muted-foreground">
            <span className="text-foreground font-semibold">{t("common.appName")}</span>
            <span aria-hidden> · </span>
            {t("common.tagline")}
          </p>
          <div className="flex items-center gap-4">
            <Link
              href="/privacy"
              className="text-muted-foreground hover:text-foreground underline-offset-4 transition-colors hover:underline"
            >
              {locale === "ar" ? "سياسة الخصوصية" : "Confidentialité"}
            </Link>
            <Link
              href="/login"
              className="text-muted-foreground hover:text-foreground underline-offset-4 transition-colors hover:underline"
            >
              {t("nav.staffPortal")}
            </Link>
          </div>
        </div>
      </footer>
    </>
  );
}
