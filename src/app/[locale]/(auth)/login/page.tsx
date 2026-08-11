import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/components/auth/login-form";
import { getAuthenticatedUser, getStaffedDoctors } from "@/lib/dashboard/auth-context";
import { resolvePostAuthRedirectHref } from "@/lib/admin/post-auth-redirect";
import { redirect } from "@/i18n/navigation";

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;

  // Optimistic redirect: an already-authenticated user visiting /login
  // again should land straight where they belong — the admin console for
  // the platform admin, the staff dashboard for anyone else who actually
  // staffs at least one doctor. Mirrors the Next.js auth guide's
  // public-route redirect example. The dashboard branch still checks
  // getStaffedDoctors() itself (not just "authenticated") so a session
  // with zero staffed doctors doesn't bounce into a dashboard that would
  // immediately redirect back here anyway.
  const user = await getAuthenticatedUser();
  if (user) {
    const destination = resolvePostAuthRedirectHref(user.id);
    if (destination === "/admin") {
      redirect({ href: "/admin", locale });
    }
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
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
