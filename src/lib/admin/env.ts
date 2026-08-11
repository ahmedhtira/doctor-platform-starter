function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * The platform admin's immutable auth.users.id — not their email.
 * Authorization must not key off email (it can change); see
 * is-platform-admin.ts and PROJECT_SPEC.md's M10 section.
 */
export function getPlatformAdminUserId(): string {
  return requireEnv("PLATFORM_ADMIN_USER_ID");
}
