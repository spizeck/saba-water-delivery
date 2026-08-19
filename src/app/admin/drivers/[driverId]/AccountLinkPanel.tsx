"use client";

import { useActionState, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { DriverRegistryEntry, UserProfile } from "@/lib/domain/types";
import type { ResidentDirectoryEntry } from "@/lib/domain/users";

import {
  linkDriverAccountAction,
  unlinkDriverAccountAction,
  type DriverFormActionState,
} from "../actions";

const initialState: DriverFormActionState = { status: "idle" };

interface Props {
  driver: DriverRegistryEntry;
  residents: ResidentDirectoryEntry[];
  linkedUser: UserProfile | null;
}

export function AccountLinkPanel({ driver, residents, linkedUser }: Props) {
  const [linkState, linkAction, linkPending] = useActionState(linkDriverAccountAction, initialState);
  const [unlinkState, unlinkAction, unlinkPending] = useActionState(unlinkDriverAccountAction, initialState);
  const [confirmingUnlink, setConfirmingUnlink] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return residents.slice(0, 20);
    const q = search.toLowerCase();
    return residents
      .filter(
        (r) =>
          r.displayName.toLowerCase().includes(q) ||
          (r.phone?.toLowerCase().includes(q) ?? false) ||
          (r.email?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 20);
  }, [residents, search]);

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Account Link</h2>

      {driver.linkedUserId ? (
        <div className="mt-3">
          <h3 className="text-sm font-medium text-slate-900">Linked Account</h3>

          {linkedUser ? (
            <div className="mt-2">
              <p className="text-base font-semibold text-slate-900">
                {linkedUser.displayName || "Unnamed"}
              </p>
              <p className="text-sm text-slate-600">
                {linkedUser.email ?? "No email"}
                {linkedUser.email && linkedUser.phone ? " \u00b7 " : ""}
                {linkedUser.phone ?? ""}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-amber-700">Linked account unavailable</p>
          )}

          {driver.linkedUserId && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
                Technical details
              </summary>
              <p className="mt-1 break-all font-mono text-xs text-slate-500">
                {driver.linkedUserId}
              </p>
            </details>
          )}

          {unlinkState.status === "success" ? (
            <p className="mt-3 text-sm font-medium text-green-700">{unlinkState.message}</p>
          ) : !confirmingUnlink ? (
            <Button
              variant="outline"
              size="md"
              className="mt-3 !border-red-200 !text-red-700 hover:!bg-red-50"
              onClick={() => setConfirmingUnlink(true)}
            >
              Unlink Account
            </Button>
          ) : (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-800">
                Unlink this account? Active claimed deliveries must be
                resolved or reassigned first. Delivery history is preserved.
              </p>
              {unlinkState.status === "error" && (
                <p className="mt-2 text-sm text-red-700">{unlinkState.message}</p>
              )}
              <form action={unlinkAction} className="mt-2 flex gap-2">
                <input type="hidden" name="driverId" value={driver.id} />
                <Button type="submit" size="md" disabled={unlinkPending}>
                  {unlinkPending ? "Unlinking\u2026" : "Confirm unlink"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  onClick={() => setConfirmingUnlink(false)}
                >
                  Cancel
                </Button>
              </form>
            </div>
          )}
        </div>
      ) : linkState.status === "success" ? (
        <p className="mt-3 text-sm font-medium text-green-700">{linkState.message}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm text-slate-600">
            No account linked yet. Search for the driver&apos;s existing
            account once they have signed in, then link it explicitly.
          </p>
          <input
            type="text"
            placeholder="Search by name, phone, or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
          />
          <div className="flex max-h-56 flex-col divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {filtered.length === 0 && (
              <p className="p-3 text-sm text-slate-500">No matching accounts.</p>
            )}
            {filtered.map((r) => (
              <button
                type="button"
                key={r.uid}
                onClick={() => setSelectedUserId(r.uid)}
                className={`flex flex-col p-3 text-left text-sm hover:bg-slate-50 ${
                  selectedUserId === r.uid ? "bg-blue-50" : ""
                }`}
              >
                <span className="font-medium text-slate-900">{r.displayName || "Unnamed"}</span>
                <span className="text-xs text-slate-500">
                  {r.email ?? "No email"}
                  {r.phone ? ` \u00b7 ${r.phone}` : ""}
                </span>
              </button>
            ))}
          </div>

          {linkState.status === "error" && (
            <p className="text-sm font-medium text-red-700">{linkState.message}</p>
          )}

          <form action={linkAction}>
            <input type="hidden" name="driverId" value={driver.id} />
            <input type="hidden" name="userId" value={selectedUserId ?? ""} />
            <Button type="submit" size="md" disabled={linkPending || !selectedUserId}>
              {linkPending ? "Linking\u2026" : "Link Selected Account"}
            </Button>
          </form>
        </div>
      )}
    </Card>
  );
}
