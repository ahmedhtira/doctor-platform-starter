import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { getAuthenticatedUser } from "@/lib/dashboard/auth-context";
import { redirect } from "@/i18n/navigation";

// Only reachable with a real session — /auth/confirm/route.ts is the
// only thing that establishes one via verifyOtp() before redirecting
// here. A direct visit with no session (stale bookmark, someone guessing
// the URL) bounces to /login with the same generic error the confirm
// route itself uses on an invalid/expired link.
export default async function SetPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await getAuthenticatedUser();
  if (!user) {
    return redirect({ href: "/login?authError=invalid_or_expired", locale });
  }

  const t = await getTranslations("setPassword");

  return (
    <div className="flex min-h-svh items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SetPasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
