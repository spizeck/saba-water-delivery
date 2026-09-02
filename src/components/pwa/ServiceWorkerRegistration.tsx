"use client";

import { useEffect } from "react";

/**
 * Registers a lightweight service worker that only caches the offline
 * fallback page and a small runtime asset cache. It does not cache
 * authenticated responses or Firestore data.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let cancelled = false;

    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });

        if (cancelled) return;

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (installing) {
            installing.addEventListener("statechange", () => {
              if (installing.state === "installed" && navigator.serviceWorker.controller) {
                // A new service worker is waiting; skip waiting in development.
                if (process.env.NODE_ENV === "development") {
                  void installing.postMessage({ type: "SKIP_WAITING" });
                }
              }
            });
          }
        });
      } catch {
        // Registration failures are not fatal; the app remains usable online.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
