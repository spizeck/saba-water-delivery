"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";

import type { UserRole } from "@/lib/domain/types";

const ROLE_LABELS: Record<UserRole, string> = {
  resident: "Resident",
  driver: "Driver",
  dispatcher: "Dispatcher",
  admin: "Admin",
};

/** Sets the portal preference cookie (non-httpOnly, client-readable). */
function setPortalCookie(role: string) {
  document.cookie = `portal=${role};path=/;max-age=${60 * 60 * 24 * 5};samesite=lax`;
}

interface RoleSwitcherProps {
  roles: UserRole[];
  currentPortal: string;
}

/**
 * Dropdown switcher that lets multi-role users navigate between portals.
 * Only rendered when the user has more than one role.
 * Switching sets a portal cookie (for remembering) and navigates to the
 * selected portal route. Does NOT modify stored roles.
 */
export function RoleSwitcher({ roles, currentPortal }: RoleSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Derive active portal from the current path or fallback to currentPortal prop
  const activePortal = (
    roles.find((r) => pathname.startsWith(`/${r}`)) ?? currentPortal
  ) as UserRole;

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  function handleSwitch(role: UserRole) {
    setOpen(false);
    // Set the portal cookie (client-readable, not httpOnly)
    setPortalCookie(role);
    router.push(`/${role}`);
  }

  if (roles.length <= 1) return null;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <span className="hidden sm:inline">Viewing as:</span>
        <span className="font-semibold text-slate-900">
          {ROLE_LABELS[activePortal] ?? activePortal}
        </span>
        <svg
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 min-w-[140px] rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {roles.map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => handleSwitch(role)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                role === activePortal
                  ? "bg-blue-50 font-semibold text-blue-700"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              {ROLE_LABELS[role]}
              {role === activePortal && (
                <svg className="ml-auto h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
