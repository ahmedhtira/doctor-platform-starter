import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { generateOpaqueSecret } from "./crypto-secret";
import { hashManagementToken } from "./generate-management-token";
import { ManageError, classifyRedeemError } from "./manage-errors";

export type ManagementSession =
  Database["public"]["Functions"]["redeem_management_token"]["Returns"];

/** randomBytes(32) hex-encoded, same shape as a management token. */
const SESSION_SECRET_BYTE_LENGTH = 32;

export type RedeemManagementTokenResult = {
  session: ManagementSession;
  /**
   * Raw session secret — exists only transiently, in this return value and
   * whatever the caller does with it (setting the manage-session cookie).
   * Never written to Postgres; only its hash is. Do not log this value.
   */
  sessionSecret: string;
};

/**
 * DI core of the token-exchange step: takes the Supabase client as a
 * parameter (same testability pattern as bookAppointment/fetchAvailableSlots)
 * rather than constructing its own.
 *
 * On success, mints a fresh, independent session secret (never the DB
 * session row's own id — see manage-session-cookie.ts for why) and passes
 * only its hash into Postgres alongside the token's hash.
 */
export async function redeemManagementToken(
  supabase: SupabaseClient<Database>,
  rawToken: string,
): Promise<RedeemManagementTokenResult> {
  const tokenHash = hashManagementToken(rawToken);
  const { rawSecret: sessionSecret, secretHash: sessionSecretHash } = generateOpaqueSecret(
    SESSION_SECRET_BYTE_LENGTH,
  );

  const { data, error } = await supabase.rpc("redeem_management_token", {
    p_token_hash: tokenHash,
    p_session_secret_hash: sessionSecretHash,
  });

  if (error) {
    throw new ManageError(classifyRedeemError(error.code), error.message);
  }

  return { session: data, sessionSecret };
}
