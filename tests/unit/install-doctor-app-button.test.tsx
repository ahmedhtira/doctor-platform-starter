import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InstallDoctorAppButton } from "@/components/dashboard/install-doctor-app-button";

describe("InstallDoctorAppButton", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("offers the browser's install prompt from the doctor menu", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const installEvent = new Event("beforeinstallprompt", { cancelable: true });
    Object.defineProperties(installEvent, {
      prompt: { value: prompt },
      userChoice: {
        value: Promise.resolve({ outcome: "accepted", platform: "web" }),
      },
    });

    render(
      <InstallDoctorAppButton
        actionLabel="Installer Dewini Pro"
        description="Ouvrir votre espace comme une application"
        openingLabel="Ouverture…"
      />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    fireEvent(window, installEvent);

    fireEvent.click(screen.getByRole("button", { name: /Installer Dewini Pro/ }));

    await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("button")).not.toBeInTheDocument());
    expect(installEvent.defaultPrevented).toBe(true);
  });

  it("does not suggest installation inside the installed app window", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });

    render(
      <InstallDoctorAppButton
        actionLabel="Installer Dewini Pro"
        description="Ouvrir votre espace comme une application"
        openingLabel="Ouverture…"
      />,
    );

    const installEvent = new Event("beforeinstallprompt", { cancelable: true });
    Object.defineProperties(installEvent, {
      prompt: { value: vi.fn() },
      userChoice: {
        value: Promise.resolve({ outcome: "accepted", platform: "web" }),
      },
    });
    fireEvent(window, installEvent);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
