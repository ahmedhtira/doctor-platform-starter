import { useTranslations } from "next-intl";

export default function HomePage() {
  const t = useTranslations("home");

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-muted-foreground mt-2">{t("description")}</p>
    </div>
  );
}
