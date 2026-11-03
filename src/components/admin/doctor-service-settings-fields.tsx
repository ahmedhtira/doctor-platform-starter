"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { DoctorServiceSettings } from "@/lib/admin/doctor-service-settings";

export function DoctorServiceSettingsFields({
  value,
  onChange,
}: {
  value: DoctorServiceSettings;
  onChange: (value: DoctorServiceSettings) => void;
}) {
  const t = useTranslations("doctorServices");
  function update<K extends keyof DoctorServiceSettings>(key: K, next: DoctorServiceSettings[K]) {
    onChange({ ...value, [key]: next });
  }
  return (
    <div className="space-y-6">
      <fieldset className="space-y-4 rounded-xl border p-5">
        <legend className="px-2 font-semibold">{t("sosTitle")}</legend>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={value.sosEnabled}
            onChange={(e) => update("sosEnabled", e.target.checked)}
          />
          <span>{t("sosEnabled")}</span>
        </label>
        <p className="text-muted-foreground text-sm">{t("sosHint")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sosPhone">{t("sosPhone")}</Label>
            <Input
              id="sosPhone"
              type="tel"
              dir="ltr"
              required={value.sosEnabled}
              maxLength={30}
              value={value.sosPhone}
              onChange={(e) => update("sosPhone", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sosArea">{t("sosArea")}</Label>
            <Input
              id="sosArea"
              maxLength={160}
              value={value.sosArea}
              onChange={(e) => update("sosArea", e.target.value)}
            />
          </div>
        </div>
      </fieldset>
      <fieldset className="space-y-4 rounded-xl border p-5">
        <legend className="px-2 font-semibold">{t("paymentTitle")}</legend>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={value.paymentRequired}
            onChange={(e) => update("paymentRequired", e.target.checked)}
          />
          <span>{t("paymentRequired")}</span>
        </label>
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          {t("paymentSetupNotice")}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="paymentMode">{t("paymentMode")}</Label>
            <select
              id="paymentMode"
              className="border-input bg-background h-9 w-full rounded-lg border px-3 text-sm"
              value={value.paymentMode}
              onChange={(e) =>
                update("paymentMode", e.target.value === "full" ? "full" : "deposit")
              }
            >
              <option value="deposit">{t("deposit")}</option>
              <option value="full">{t("full")}</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="paymentAmount">{t("amount")}</Label>
            <Input
              id="paymentAmount"
              inputMode="decimal"
              dir="ltr"
              required={value.paymentRequired}
              maxLength={20}
              value={value.paymentAmount}
              onChange={(e) => update("paymentAmount", e.target.value)}
              placeholder="20.000"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="paymentTerms">{t("terms")}</Label>
          <Textarea
            id="paymentTerms"
            required={value.paymentRequired}
            maxLength={2000}
            value={value.paymentTerms}
            onChange={(e) => update("paymentTerms", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="recipientName">{t("recipient")}</Label>
          <Input
            id="recipientName"
            maxLength={160}
            value={value.recipientName}
            onChange={(e) => update("recipientName", e.target.value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="providerName">{t("provider")}</Label>
            <Input
              id="providerName"
              maxLength={80}
              value={value.providerName}
              onChange={(e) => update("providerName", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="accountReference">{t("accountReference")}</Label>
            <Input
              id="accountReference"
              maxLength={200}
              value={value.accountReference}
              onChange={(e) => update("accountReference", e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>
        <p className="text-muted-foreground text-sm">{t("recipientHint")}</p>
      </fieldset>
    </div>
  );
}
