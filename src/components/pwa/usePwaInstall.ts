"use client";

import { useCallback, useEffect, useState } from "react";

import type { PwaPortal } from "@/lib/pwa/constants";
import {
  isIOSSafari,
  isInstallPromptSupported,
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

function getInitialState(): PwaInstallState {
  if (typeof window === "undefined") return { kind: "loading" };

  if (isStandaloneDisplay()) return { kind: "standalone" };

  if (isIOSSafari()) return { kind: "ios" };

  if (!isInstallPromptSupported()) return { kind: "unsupported" };

  if (capturedInstallPrompt) {
    const prompt = toInstallPrompt(capturedInstallPrompt);
    if (prompt) return { kind: "prompt", prompt };
  }

  return { kind: "loading" };
}

/**
 * Detects whether the PWA is already installed, running on iOS Safari, or
 * eligible for a Chromium install prompt. The initial state is computed once
 * during component mount; any subsequent updates are driven by browser events
 * or a timeout, so state transitions happen inside event callbacks rather than
 * synchronously within the effect body.
 */
export function usePwaInstall(_portal: PwaPortal): UsePwaInstallResult {
  const [state, setState] = useState<PwaInstallState>(getInitialState);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Already resolved by initial state.
    if (state.kind !== "loading") return;

    const timer = window.setTimeout(() => {
      setState({ kind: "unsupported" });
    }, 3000);

    const handler = (event: Event) => {
      event.preventDefault();
      window.clearTimeout(timer);
      const prompt = toInstallPrompt(event);
      if (prompt) {
        capturedInstallPrompt = event;
        setState({ kind: "prompt", prompt });
      }
    };

    const installedHandler = () => {
      window.clearTimeout(timer);
      setState({ kind: "standalone" });
    };

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installedHandler);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, [state.kind]);

  const invokeInstall = useCallback(async () => {
    if (state.kind !== "prompt") return;
    try {
      await state.prompt.prompt();
      const choice = await state.prompt.userChoice;
      if (choice.outcome === "dismissed") {
        setDismissed(true);
      }
    } catch {
      setDismissed(true);
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
