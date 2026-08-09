function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getResendApiKey(): string {
  return requireEnv("RESEND_API_KEY");
}

export function getEmailFromAddress(): string {
  return process.env.EMAIL_FROM_ADDRESS || "Doctor Platform <onboarding@resend.dev>";
}

export function getAppUrl(): string {
  return process.env.APP_URL || "http://localhost:3000";
}

/**
 * Keys the deterministic HMAC derivation of email-delivery management
 * tokens (see derive-management-token.ts). Must stay stable for as long
 * as any email_outbox row that could still be retried exists — see the
 * stability warning next to EMAIL_TOKEN_DERIVATION_KEY in .env.example.
 */
export function getEmailTokenDerivationKey(): string {
  return requireEnv("EMAIL_TOKEN_DERIVATION_KEY");
}
