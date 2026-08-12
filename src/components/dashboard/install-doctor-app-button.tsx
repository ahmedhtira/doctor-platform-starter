"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

type InstallChoice = {
  outcome: "accepted" | "dismissed";
  platform: string;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
};

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

function isRunningAsInstalledApp() {
  if (typeof window === "undefined") {
    return false;
  }

  const displayModeStandalone =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone = (window.navigator as NavigatorWithStandalone).standalone === true;

  return displayModeStandalone || iosStandalone;
}

export function InstallDoctorAppButton({
  actionLabel,
  description,
  openingLabel,
}: {
  actionLabel: string;
  description: string;
  openingLabel: string;
}) {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(isRunningAsInstalledApp);
  const [isOpening, setIsOpening] = useState(false);

  useEffect(() => {
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const markAsInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", markAsInstalled);

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/dewini-pro-sw.js").catch(() => undefined);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", markAsInstalled);
    };
  }, []);

  if (isInstalled || !installPrompt) {
    return null;
  }

  return (
    <button
      type="button"
      disabled={isOpening}
      onClick={async () => {
        setIsOpening(true);
        await installPrompt.prompt();
        const choice = await installPrompt.userChoice;

        if (choice.outcome === "accepted") {
          setIsInstalled(true);
        }

        // A captured prompt can only be used once. If the doctor dismisses
        // it, Chromium may offer a fresh one on a later visit.
        setInstallPrompt(null);
        setIsOpening(false);
      }}
      className="border-primary/20 bg-primary/7 text-primary hover:bg-primary/12 inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-start font-semibold transition-colors disabled:pointer-events-none disabled:opacity-60 lg:w-full"
    >
      <Download className="size-4" aria-hidden />
      <span className="min-w-0">
        <span className="block">{isOpening ? openingLabel : actionLabel}</span>
        <span className="text-muted-foreground hidden text-[0.7rem] leading-snug font-normal lg:block">
          {description}
        </span>
      </span>
    </button>
  );
}
