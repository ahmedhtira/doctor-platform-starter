/**
 * Centralizes dashboard query-string construction so `doctorId` (and, on
 * Calendar, `week`) survive every in-dashboard navigation — nav links, the
 * doctor switcher, week paging, and (via locale-switcher.tsx) an fr/ar
 * switch. No React/Next dependency: usable from server components (Today,
 * Calendar) and client components (dashboard-nav.tsx) alike.
 */
export function buildDashboardHref(
  pathname: string,
  params: Record<string, string | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      query.set(key, value);
    }
  }
  const queryString = query.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}
