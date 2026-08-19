"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Check, Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";

const PASSWORD_SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";

export function SetPasswordForm() {
  const t = useTranslations("setPassword");
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const passwordRules = {
    length: password.length >= 10,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    symbol: [...password].some((character) =>
      PASSWORD_SYMBOLS.includes(character),
    ),
  };

  const passwordIsStrong = Object.values(passwordRules).every(Boolean);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!passwordIsStrong) {
      setError(t("errorWeak"));
      return;
    }

    if (password !== confirmPassword) {
      setError(t("errorMismatch"));
      return;
    }

    startTransition(async () => {
      const supabase = createClient();

      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        setError(t("errorGeneric"));
        return;
      }

      await supabase.auth.signOut();

      router.replace("/login");
      router.refresh();
    });
  }

  const rules = [
    { passed: passwordRules.length, label: t("ruleLength") },
    { passed: passwordRules.lowercase, label: t("ruleLowercase") },
    { passed: passwordRules.uppercase, label: t("ruleUppercase") },
    { passed: passwordRules.number, label: t("ruleNumber") },
    { passed: passwordRules.symbol, label: t("ruleSymbol") },
  ];

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{t("passwordLabel")}</Label>

        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="pe-10"
          />

          <button
            type="button"
            onClick={() => setShowPassword((current) => !current)}
            aria-label={
              showPassword ? t("hidePassword") : t("showPassword")
            }
            aria-pressed={showPassword}
            className="text-muted-foreground hover:text-foreground absolute inset-y-0 end-2 flex items-center justify-center"
          >
            {showPassword ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>

        <ul className="space-y-1 text-xs">
          {rules.map((rule) => (
            <li
              key={rule.label}
              className={
                rule.passed ? "text-foreground" : "text-muted-foreground"
              }
            >
              <span className="inline-flex items-center gap-1.5">
                {rule.passed ? (
                  <Check className="size-3.5" aria-hidden="true" />
                ) : (
                  <span
                    className="inline-block size-3.5 text-center"
                    aria-hidden="true"
                  >
                    •
                  </span>
                )}

                {rule.label}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="confirmPassword">
          {t("confirmPasswordLabel")}
        </Label>

        <div className="relative">
          <Input
            id="confirmPassword"
            type={showConfirmPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="pe-10"
          />

          <button
            type="button"
            onClick={() =>
              setShowConfirmPassword((current) => !current)
            }
            aria-label={
              showConfirmPassword
                ? t("hidePassword")
                : t("showPassword")
            }
            aria-pressed={showConfirmPassword}
            className="text-muted-foreground hover:text-foreground absolute inset-y-0 end-2 flex items-center justify-center"
          >
            {showConfirmPassword ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <Button type="submit" disabled={pending} className="mt-2">
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
