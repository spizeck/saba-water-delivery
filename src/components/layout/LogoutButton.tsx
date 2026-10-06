"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { clearSession } from "@/lib/auth/client-session";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { cn } from "@/lib/utils/cn";
import { navPillClasses } from "@/lib/utils/interactive";

export function LogoutButton() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleLogout() {
    setSigningOut(true);
    const auth = getFirebaseAuth();
    await Promise.all([auth?.signOut(), clearSession()]);
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={signingOut}
      className={cn(navPillClasses, "text-slate-600")}
    >
      {signingOut ? "Logging out\u2026" : "Log out"}
    </button>
  );
}
