"use server";

import { z } from "zod";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolvePostAuthRedirectHref } from "@/lib/admin/post-auth-redirect";

// Server Action — the only place client code touches Supabase Auth for the
// staff login flow. One generic error message regardless of cause (wrong
// password vs. unknown email vs. unconfirmed account): same
// no-enumeration philosophy as redeem_management_token's single "invalid
// or expired" error.

const loginInputSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export type LoginResult = { success: true } | { success: false; message: string };

export async function loginAction(input: unknown): Promise<LoginResult> {
  const parsed = loginInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: "INVALID_CREDENTIALS" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
  console.warn("loginAction: Supabase sign-in failed", {
    code: error.code,
    status: error.status,
  });

  return { success: false, message: "INVALID_CREDENTIALS" };
}

  return redirect({
    href: resolvePostAuthRedirectHref(data.user?.id),
    locale: await getLocale(),
  });
}
