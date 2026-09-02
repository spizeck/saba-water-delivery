"use client";

import { useCallback, useEffect, useState } from "react";

import type { PwaPortal } from "@/lib/pwa/constants";
import {
  isIOSSafari,
  isStandaloneDisplay,
  toInstallPrompt,
  type InstallPrompt,
} from "@/lib/pwa/platform";

export type PwaInstallState =
  | { kind: "loading" }
  | { kind: "standalone" }
  | { kind: "ios" }
  | { kind: "prompt"; prompt: InstallPrompt }
  | { kind: "unsupported" };

export interface UsePwaInstallResult {
  state: PwaInstallState;
  invokeInstall: () => Promise<void>;
  dismissed: boolean;
  isStandalone: boolean;
  isIOS: boolean;
}

let capturedInstallPrompt: Event | null = null;

/**
 * Detects whether the PWA is already installed, running on iOS Safari, or
 * eligible for a Chromium install prompt. Server rendering and client hydration
 * both start in the loading state; browser-only detection runs after hydration.
 */
export function usePwaInstall(_portal: PwaPortal): UsePwaInstallResult {
  const [state, setState] = useState<PwaInstallState>({ kind: "loading" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || state.kind === "standalone" || state.kind === "ios") {
      return;
    }

    let active = true;
    const timer =
      state.kind === "loading"
        ? window.setTimeout(() => setState({ kind: "unsupported" }), 3000)
        : null;

    const handler = (event: Event) => {
      event.preventDefault();
      if (timer !== null) window.clearTimeout(timer);
      const prompt = toInstallPrompt(event);
      if (prompt) {
        capturedInstallPrompt = event;
        setDismissed(false);
        setState({ kind: "prompt", prompt });
      }
    };

    const installedHandler = () => {
      if (timer !== null) window.clearTimeout(timer);
      capturedInstallPrompt = null;
      setState({ kind: "standalone" });
    };

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installedHandler);

    if (state.kind === "loading") {
      queueMicrotask(() => {
        if (!active) return;
        if (isStandaloneDisplay()) {
          setState({ kind: "standalone" });
          return;
        }
        if (isIOSSafari()) {
          setState({ kind: "ios" });
          return;
        }
        if (capturedInstallPrompt) {
          const prompt = toInstallPrompt(capturedInstallPrompt);
          if (prompt) setState({ kind: "prompt", prompt });
        }
      });
    }

    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, [state.kind]);

  const invokeInstall = useCallback(async () => {
    if (state.kind !== "prompt") return;
    try {
      await state.prompt.prompt();
      const choice = await state.prompt.userChoice;
      capturedInstallPrompt = null;
      setState({ kind: "unsupported" });
      if (choice.outcome === "dismissed") {
        setDismissed(true);
      }
    } catch {
      capturedInstallPrompt = null;
      setDismissed(true);
      setState({ kind: "unsupported" });
    }
  }, [state]);

  return {
    state,
    invokeInstall,
    dismissed,
    isStandalone: state.kind === "standalone",
    isIOS: state.kind === "ios",
  };
}
