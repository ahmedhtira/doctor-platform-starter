import { getPlatformAdminUserId } from "./env";
import { isPlatformAdminUserId } from "./is-platform-admin";

/**
 * Shared by loginAction and the login page's optimistic redirect so the
 * two never drift apart on where the platform admin lands after
 * authenticating, versus everyone else (who goes to the staff
 * dashboard).
 */
export function resolvePostAuthRedirectHref(userId: string | null | undefined): "/admin" | "/dashboard" {
  return isPlatformAdminUserId(userId, getPlatformAdminUserId()) ? "/admin" : "/dashboard";
}
