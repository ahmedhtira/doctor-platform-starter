import "server-only";
import { cache } from "react";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveStaffedDoctors, type StaffDoctorSummary } from "./resolve-staffed-doctors";

export type AuthenticatedUser = { id: string; email: string };

export type { StaffDoctorSummary };

export type DoctorContext = {
  user: AuthenticatedUser;
  doctors: StaffDoctorSummary[];
  selectedDoctor: StaffDoctorSummary;
};

/**
 * `getUser()`, not `getSession()` — getUser() revalidates the token against
 * the Supabase Auth server instead of trusting an unverified cookie JWT
 * (session.user is not to be trusted for authorization decisions, per
 * Supabase's own guidance). Wrapped in React's cache() so the layout's
 * optimistic check and each page's requireDoctorContext() call share one
 * network round trip per request.
 */
export const getAuthenticatedUser = cache(async (): Promise<AuthenticatedUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return null;
  }

  return { id: user.id, email: user.email };
});

/**
 * Thin, server-only, cache()-wrapped entry point — constructs the real
 * cookie-bound client and delegates to resolve-staffed-doctors.ts's DI
 * core (see that file for why the actual query logic lives there instead
 * of here). Same split as get-available-slots.ts (thin, guarded) vs.
 * fetch-availability-data.ts (DI core, unguarded, testable).
 */
export const getStaffedDoctors = cache(async (userId: string): Promise<StaffDoctorSummary[]> => {
  const supabase = await createClient();
  return resolveStaffedDoctors(supabase, userId);
});

/**
 * The secure check every dashboard page runs (not just the layout's
 * optimistic gate — see PROJECT_SPEC.md's "layout + data-access-layer + RLS"
 * model and the Next.js auth guide's warning that a layout auth check alone
 * isn't sufficient, since layouts don't re-render on sibling navigation).
 * No patient auth exists in this app, so a session with zero staffed
 * doctors is already an edge case, not a normal flow — treated the same as
 * "not logged in."
 */
export async function requireDoctorContext(doctorIdParam?: string): Promise<DoctorContext> {
  const user = await getAuthenticatedUser();
  if (!user) {
    // `return` (not a bare statement) so control-flow narrowing of `user`
    // below doesn't depend on TS resolving redirect()'s declared `never`
    // return type through next-intl's generic navigation types — a plain
    // `return` unconditionally terminates the function regardless.
    return redirect({ href: "/login", locale: await getLocale() });
  }

  const doctors = await getStaffedDoctors(user.id);
  if (doctors.length === 0) {
    return redirect({ href: "/login", locale: await getLocale() });
  }

  const selectedDoctor =
    (doctorIdParam ? doctors.find((doctor) => doctor.id === doctorIdParam) : undefined) ??
    doctors[0];

  return { user, doctors, selectedDoctor };
}
