import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Placeholder only — Supabase Auth wiring, validation, and session handling
// are out of scope for this milestone (M0 scaffolding).
export default function LoginPage() {
  const t = useTranslations("login");

  return (
    <div className="flex min-h-svh items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">{t("emailLabel")}</Label>
              <Input id="email" type="email" autoComplete="email" disabled />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">{t("passwordLabel")}</Label>
              <Input id="password" type="password" autoComplete="current-password" disabled />
            </div>
            <Button type="submit" disabled className="mt-2">
              {t("submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
