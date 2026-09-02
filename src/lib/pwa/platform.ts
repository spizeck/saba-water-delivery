/**
 * Platform/installation helpers that run in the browser. They are kept pure
 * (no side effects) so they can be used both inside and outside React hooks.
 */

export function isIOSSafari(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: boolean }).MSStream;

  // iPadOS 13+ reports "Macintosh" with a touch screen; treat it as iOS only
  // when the touch-enabled Mac user agent pattern matches.
  const isIPad =
    /Macintosh/.test(ua) && "ontouchend" in document && navigator.maxTouchPoints > 0;

  return isIOS || isIPad;
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;

  // iOS Safari sets navigator.standalone when launched from the home screen.
  if ((navigator as unknown as { standalone?: boolean }).standalone === true) {
    return true;
  }

  // Chromium and modern browsers expose the display-mode media query.
  return window.matchMedia("(display-mode: standalone)").matches;
}

export function isInstallPromptSupported(): boolean {
  return typeof window !== "undefined" && "BeforeInstallPromptEvent" in window;
}

export type InstallPrompt = {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export function toInstallPrompt(event: Event): InstallPrompt | null {
  const prompt = event as unknown as {
    prompt?: () => Promise<void>;
    userChoice?: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  };

  const { prompt: show, userChoice } = prompt;
  if (typeof show !== "function" || typeof userChoice === "undefined") {
    return null;
  }

  return {
    // `show` is a native WebIDL operation that brand-checks its `this`, so it
    // must be invoked with the original event as the receiver. Calling it
    // detached (e.g. `show()`) throws "TypeError: Illegal invocation".
    prompt: () => show.call(event),
    userChoice,
  };
}
