"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  setDoctorPublishedAction,
  setDoctorSuspendedAction,
  deleteDoctorAction,
} from "@/app/[locale]/(admin)/admin/actions";
import type { AdminDoctorListItem } from "@/lib/admin/list-doctors-for-admin";

type Mode = "view" | "confirmingDelete";

/**
 * Per-row publish/unpublish, suspend/reactivate, and delete controls.
 * Delete's "strong confirmation step" (type the doctor's name) is one
 * level past appointment-actions.tsx's confirm-step precedent — that one
 * has no revert path either, but suspend/publish here can always be
 * reversed; delete (for a doctor with appointment history) cannot.
 */
export function DoctorStatusActions({ doctor }: { doctor: AdminDoctorListItem }) {
  const t = useTranslations("admin");
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("view");
  const [confirmText, setConfirmText] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleTogglePublished() {
    setError(null);
    startTransition(async () => {
      const result = await setDoctorPublishedAction({
        doctorId: doctor.id,
        isPublished: !doctor.isPublished,
      });
      if (!result.success) {
        setError(t("errorGeneric"));
        return;
      }
      router.refresh();
    });
  }

  function handleToggleSuspended() {
    setError(null);
    startTransition(async () => {
      const result = await setDoctorSuspendedAction({
        doctorId: doctor.id,
        suspended: !doctor.isSuspended,
      });
      if (!result.success) {
        setError(t("errorGeneric"));
        return;
      }
      router.refresh();
    });
  }

  function handleDelete() {
    if (confirmText !== doctor.fullName) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteDoctorAction({ doctorId: doctor.id });
      if (!result.success) {
        setError(t("errorGeneric"));
        return;
      }
      setMode("view");
      router.refresh();
    });
  }

  if (doctor.isDeleted) {
    return null;
  }

  if (mode === "confirmingDelete") {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <p className="text-destructive text-xs">{t("deleteConfirmPrompt", { name: doctor.fullName })}</p>
        <Input
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          className="h-7 w-40 text-xs"
        />
        {error ? <p className="text-destructive text-xs">{error}</p> : null}
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="xs"
            variant="destructive"
            disabled={confirmText !== doctor.fullName || pending}
            onClick={handleDelete}
          >
            {pending ? t("deleting") : t("deleteConfirmYes")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setMode("view");
              setConfirmText("");
            }}
          >
            {t("deleteConfirmNo")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      <div className="flex gap-1.5">
        <Button type="button" size="xs" variant="outline" disabled={pending} onClick={handleTogglePublished}>
          {doctor.isPublished ? t("unpublishAction") : t("publishAction")}
        </Button>
        <Button type="button" size="xs" variant="outline" disabled={pending} onClick={handleToggleSuspended}>
          {doctor.isSuspended ? t("reactivateAction") : t("suspendAction")}
        </Button>
        <Button type="button" size="xs" variant="destructive" disabled={pending} onClick={() => setMode("confirmingDelete")}>
          {t("deleteAction")}
        </Button>
      </div>
    </div>
  );
}
