"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { redeemManagementTokenAction } from "@/app/[locale]/(public)/manage/actions";
import { ManagedAppointmentView } from "./managed-appointment-view";
import type { ManagedAppointmentView as ManagedAppointmentData } from "@/lib/booking/get-managed-appointment";

/**
 * Always mounts, regardless of whether the server already resolved a valid
 * session from the manage-session cookie. A raw token in the URL fragment
 * (the server can never see it — see PROJECT_SPEC.md "Patient
 * self-service (M5)") always takes priority over an existing cookie: it's
 * an explicit signal the patient wants to switch to *that* appointment's
 * session. Without this, a patient who already has an active session (e.g.
 * they booked two appointments and are opening the second confirmation
 * link while the first is still within its 30-minute window) would keep
 * seeing the *first* appointment — the server-only branch this replaced
 * short-circuited on the cookie before the fragment was ever read, since
 * only client code can see a URL fragment at all.
 *
 * Only a bare /manage visit with no fragment falls back to whatever the
 * cookie already resolved server-side (the `appointment` prop).
 */
export function ManageGate({
  appointment,
  locale,
}: {
  appointment: ManagedAppointmentData | null;
  locale: string;
}) {
  const t = useTranslations("manage");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [phase, setPhase] = useState<"checking" | "ready" | "failed">("checking");
  // Token redemption is single-use, not idempotent — unlike a plain data
  // fetch, running it twice doesn't just waste a request, it makes the
  // *second* attempt fail (already used) and could clobber a successful
  // first attempt's outcome. React's Strict Mode intentionally
  // double-invokes effects in development to surface exactly this kind of
  // bug. Tracking the specific token (not a plain boolean) is what lets
  // this guard reject a same-token re-run while still allowing a later,
  // *different* token to be attempted — e.g. a patient clicking a second
  // appointment's manage link in an already-open tab, which changes the
  // URL fragment without remounting this component, so a plain "ran once
  // ever" flag would permanently block every link after the first.
  // `undefined` (never attempted anything yet) is deliberately distinct
  // from `null` (attempted the "no token present" case) — URLSearchParams
  // .get() also returns `null` for a missing token, and initializing this
  // ref to `null` would make that very first "no token" run indistinguishable
  // from an already-attempted one, permanently skipping the `setPhase("ready")`
  // call it's supposed to make and leaving the page stuck on the loading card.
  const attemptedTokenRef = useRef<string | null | undefined>(undefined);
  // A successful redemption's `phase` shouldn't flip to "ready" until the
  // *refreshed* `appointment` prop actually lands — router.refresh() re-runs
  // the server render but doesn't resolve synchronously, and this component
  // never unmounts to pick up the new prop "for free" the way the old
  // page.tsx-level ternary did. Flipping immediately would either get stuck
  // showing the loading card forever (nothing else ever sets `phase` away
  // from "checking") or, if flipped eagerly, briefly render "invalid link"
  // using the still-stale (possibly null) prop before the refresh lands.
  const awaitingRefreshedAppointment = useRef(false);

  useEffect(() => {
    if (awaitingRefreshedAppointment.current && appointment) {
      awaitingRefreshedAppointment.current = false;
      setPhase("ready");
    }
  }, [appointment]);

  useEffect(() => {
    function attemptFromHash() {
      const hash = window.location.hash;
      const token = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash).get("token");

      if (attemptedTokenRef.current === token) {
        return;
      }
      attemptedTokenRef.current = token;

      startTransition(async () => {
        if (!token) {
          setPhase("ready");
          return;
        }

        const result = await redeemManagementTokenAction(token);
        // Never sent over the network, but no reason to leave the raw
        // token sitting in the address bar/history longer than needed.
        window.history.replaceState(null, "", window.location.pathname);

        if (result.success) {
          awaitingRefreshedAppointment.current = true;
          router.refresh();
          return;
        }
        setPhase("failed");
      });
    }

    attemptFromHash();
    window.addEventListener("hashchange", attemptFromHash);
    return () => window.removeEventListener("hashchange", attemptFromHash);
  }, [router, startTransition]);

  if (phase === "checking") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">{t("loadingLabel")}</p>
        </CardContent>
      </Card>
    );
  }

  if (phase === "ready" && appointment) {
    return <ManagedAppointmentView appointment={appointment} locale={locale} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("invalidLinkTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-destructive text-sm">{t("invalidLinkDescription")}</p>
      </CardContent>
    </Card>
  );
}
