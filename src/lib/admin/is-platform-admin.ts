/**
 * Pure, testable seam — kept separate from auth-context.ts so it doesn't
 * need `server-only`/cookies to unit-test, same reason
 * resolve-staffed-doctors.ts is split out from auth-context.ts's
 * requireDoctorContext(). Plain string equality: user ids are UUIDs, not
 * emails, so no case-folding/trimming is needed here.
 */
export function isPlatformAdminUserId(
  userId: string | null | undefined,
  adminUserId: string,
): boolean {
  if (!userId) return false;
  return userId === adminUserId;
}
