/**
 * The single source of truth for the `/manage` session cookie's name/path,
 * shared by the Server Action that sets it (manage/actions.ts) and the
 * Server Component that reads it (manage/page.tsx) so they can't drift
 * apart.
 *
 * Content: the raw, independently-generated session secret (see
 * crypto-secret.ts) — never appointment_management_sessions.id. A database
 * row id is an identifier, not a credential; storing it in a cookie would
 * mean anything that ever incidentally logs or surfaces that id (an error
 * message, a future admin view) doubles as a live credential for the
 * appointment it belongs to.
 *
 * Path is site-wide ("/"), not locale-scoped. Routing uses
 * localePrefix: "always" (src/i18n/routing.ts), so `/fr/manage` and
 * `/ar/manage` share no shorter path — scoping to one locale would silently
 * break the session the moment a patient switches locale, an unrecoverable
 * lockout since the token that created the session is already single-use
 * and burned by then. This is the only application-level cookie in the
 * codebase (the only other cookie usage, src/lib/supabase/server.ts, is
 * Supabase's own auth-session cookie).
 *
 * SameSite=Strict is safe here because the initial `/manage` visit (from an
 * external email client) never depends on this cookie existing yet — token
 * exchange reads the raw token from the URL fragment, not a cookie. Every
 * later use (reload, in-app navigation, form submissions) is a same-site
 * request, where Strict behaves like Lax.
 */
export const MANAGE_SESSION_COOKIE_NAME = "manage_session";
export const MANAGE_SESSION_COOKIE_PATH = "/";

export function manageSessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: MANAGE_SESSION_COOKIE_PATH,
    maxAge: maxAgeSeconds,
  };
}
