"use client";

import { useEffect, useState } from "react";

function getInitialOfflineState(): boolean {
  if (typeof navigator === "undefined") return false;
  return !navigator.onLine;
}

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(getInitialOfflineState);

  useEffect(() => {
    if (typeof navigator === "undefined") return;

    const onOffline = () => setIsOffline(true);
    const onOnline = () => setIsOffline(false);

    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);

    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      role="status"
      className="bg-amber-50 px-4 py-2 text-center text-sm font-medium text-amber-800"
    >
      You appear to be offline. Some features will be available again when your connection returns.
    </div>
  );
}
