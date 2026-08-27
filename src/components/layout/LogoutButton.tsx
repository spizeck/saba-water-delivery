"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { clearSession } from "@/lib/auth/client-session";
import { getFirebaseAuth } from "@/lib/firebase/client";

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
      className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
    >
      {signingOut ? "Logging out\u2026" : "Log out"}
    </button>
  );
}
