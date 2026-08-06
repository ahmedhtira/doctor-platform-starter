import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "@/components/locale-switcher";

export default function PublicLayout({ children }: { children: ReactNode }) {
  const t = useTranslations();

  return (
    <>
      <header className="flex items-center justify-between border-b px-4 py-3">
        <Link href="/" className="font-semibold">
          {t("common.appName")}
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm hover:underline">
            {t("nav.login")}
          </Link>
          <LocaleSwitcher />
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </>
  );
}
