import "server-only";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getAuthenticatedUser, type AuthenticatedUser } from "@/lib/dashboard/auth-context";
import { getPlatformAdminUserId } from "./env";
import { isPlatformAdminUserId } from "./is-platform-admin";

/**
 * The secure check every /admin page and Server Action runs. Treats
 * "authenticated but not the admin" exactly like "not authenticated" —
 * same collapsing requireDoctorContext() already does for "zero staffed
 * doctors" — so a logged-in doctor navigating to /admin learns nothing
 * beyond a bounce back to /login, not a distinct "forbidden" signal.
 */
export async function requirePlatformAdmin(): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser();
  const adminUserId = getPlatformAdminUserId();
  if (!user || !isPlatformAdminUserId(user.id, adminUserId)) {
    return redirect({ href: "/login", locale: await getLocale() });
  }
  return user;
}
