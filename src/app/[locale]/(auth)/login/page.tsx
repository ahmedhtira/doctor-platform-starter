import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/components/auth/login-form";
import { getAuthenticatedUser, getStaffedDoctors } from "@/lib/dashboard/auth-context";
import { redirect } from "@/i18n/navigation";

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;

  // Optimistic redirect: an already-authenticated staff member visiting
  // /login again should land straight on the dashboard, mirroring the
  // Next.js auth guide's public-route redirect example.
  const user = await getAuthenticatedUser();
  if (user) {
    const doctors = await getStaffedDoctors(user.id);
    if (doctors.length > 0) {
      redirect({ href: "/dashboard", locale });
    }
  }

  const t = await getTranslations("login");

  return (
    <div className="flex min-h-svh items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </div>
  );
}
