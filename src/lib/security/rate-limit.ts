import "server-only";

import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getSupabaseServiceRoleKey } from "@/lib/supabase/env";

type RateLimitOptions = {
  scope: string;
  discriminator?: string;
  limit: number;
  windowSeconds: number;
};

type ConsumeRateLimitRpcResult = {
  data: boolean | null;
  error: { message: string } | null;
};

function normalizeForwardedFor(value: string | null): string {
  if (!value) {
    return "unknown";
  }
  return value.split(",", 1)[0]?.trim() || "unknown";
}

/**
 * Server-only public-action limiter. Vercel overwrites x-forwarded-for,
 * preventing clients from spoofing their source IP. The database never
 * receives the raw IP or discriminator: both are folded into an HMAC using
 * the already-server-only service-role key.
 *
 * Fail closed. These callers are security-sensitive public mutations; if
 * the limiter cannot be checked, they should not proceed with a write/send.
 */
export async function consumeRateLimit(
  supabase: SupabaseClient<Database>,
  options: RateLimitOptions,
): Promise<boolean> {
  const requestHeaders = await headers();
  const clientIp = normalizeForwardedFor(requestHeaders.get("x-forwarded-for"));
  const discriminator = options.discriminator?.trim().toLowerCase() ?? "";
  const bucketKey = createHmac("sha256", getSupabaseServiceRoleKey())
    .update(`${options.scope}\u0000${clientIp}\u0000${discriminator}`)
    .digest("hex");

  // The RPC is introduced by the same launch migration. Keep the cast local
  // until database.types.ts is regenerated after the migration is deployed.
  const consumeRateLimitRpc = supabase.rpc as unknown as (
    fn: "consume_rate_limit",
    args: {
      p_bucket_key: string;
      p_limit: number;
      p_window_seconds: number;
    },
  ) => Promise<ConsumeRateLimitRpcResult>;

  const { data, error } = await consumeRateLimitRpc("consume_rate_limit", {
    p_bucket_key: bucketKey,
    p_limit: options.limit,
    p_window_seconds: options.windowSeconds,
  });

  if (error) {
    console.error("consumeRateLimit: limiter RPC failed", error.message);
    return false;
  }

  return data === true;
}
