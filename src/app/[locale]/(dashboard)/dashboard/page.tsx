import { useTranslations } from "next-intl";

export default function DashboardTodayPage() {
  const t = useTranslations("dashboard");

  return (
    <div>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-muted-foreground mt-2">{t("description")}</p>
    </div>
  );
}
