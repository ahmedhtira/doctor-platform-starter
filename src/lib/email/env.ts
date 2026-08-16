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
  return (
    process.env.EMAIL_FROM_ADDRESS ||
    "Dewini Appointments <appointments@send.dewini.net>"
  );
}

export function getAppointmentEmailFromAddress(): string {
  return (
    process.env.EMAIL_APPOINTMENTS_FROM_ADDRESS ||
    "Dewini Appointments <appointments@send.dewini.net>"
  );
}

export function getNotificationEmailFromAddress(): string {
  return (
    process.env.EMAIL_NOTIFICATIONS_FROM_ADDRESS ||
    "Dewini Notifications <notifications@send.dewini.net>"
  );
}

export function getNoReplyEmailFromAddress(): string {
  return (
    process.env.EMAIL_NOREPLY_FROM_ADDRESS ||
    "Dewini <no-reply@send.dewini.net>"
  );
}

export function getAppUrl(): string {
  return process.env.APP_URL || "http://localhost:3000";
}

/**
 * Keys the deterministic HMAC derivation of email-delivery management
 * tokens. Must stay stable while queued/retryable email_outbox rows exist.
 */
export function getEmailTokenDerivationKey(): string {
  return requireEnv("EMAIL_TOKEN_DERIVATION_KEY");
}
