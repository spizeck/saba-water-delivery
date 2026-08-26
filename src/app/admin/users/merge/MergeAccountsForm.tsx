"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { UserRole } from "@/lib/domain/types";
import { formatPhoneForDisplay } from "@/lib/utils/formatPhone";
import type { AdminUserListItem } from "@/lib/domain/admin";

import {
  getMergeAccountPreview,
  mergeAccounts,
  type AccountMergePreview,
  type MergeAccountsActionState,
} from "../../actions";

interface Props {
  users: AdminUserListItem[];
}

const initialState: MergeAccountsActionState = { status: "idle" };

const ALL_ROLES: UserRole[] = ["resident", "driver", "dispatcher", "admin", "viewer"];

export function MergeAccountsForm({ users }: Props) {
  const [canonicalUid, setCanonicalUid] = useState("");
  const [duplicateUid, setDuplicateUid] = useState("");
  const [preview, setPreview] = useState<AccountMergePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [roleMergePolicy, setRoleMergePolicy] = useState<"union" | "explicit">("union");
  const [explicitRoles, setExplicitRoles] = useState<UserRole[]>(["resident"]);
  const [reason, setReason] = useState("");

  const [state, formAction, pending] = useActionState(mergeAccounts, initialState);

  async function loadPreview() {
    if (!canonicalUid || !duplicateUid || canonicalUid === duplicateUid) {
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    try {
      const data = await getMergeAccountPreview(canonicalUid, duplicateUid);
      setPreview(data);
      setExplicitRoles(data.defaultUnionRoles);
    } catch {
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  const canPreview = Boolean(canonicalUid && duplicateUid && canonicalUid !== duplicateUid);
  const canSubmit =
    canPreview &&
    preview &&
    !preview.blocked &&
    reason.trim().length > 0 &&
    (roleMergePolicy !== "explicit" || explicitRoles.length > 0);

  return (
    <>
      <Card>
        <h2 className="text-lg font-bold text-slate-900">Select accounts</h2>
        <p className="mt-1 text-xs text-slate-500">
          The <strong>canonical</strong> account remains active. The <strong>duplicate</strong>{" "}
          account&apos;s application data is relinked, then the duplicate Firebase Auth account is
          deleted when possible.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Canonical account
            <select
              value={canonicalUid}
              onChange={(e) => {
                setCanonicalUid(e.target.value);
                setPreview(null);
              }}
              className="h-10 rounded-lg border border-slate-300 px-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
            >
              <option value="">Select the account to keep...</option>
              {users.map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.displayName || "Unnamed"} — {u.email ?? u.phone ?? u.uid.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Duplicate account
            <select
              value={duplicateUid}
              onChange={(e) => {
                setDuplicateUid(e.target.value);
                setPreview(null);
              }}
              className="h-10 rounded-lg border border-slate-300 px-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
            >
              <option value="">Select the account to merge...</option>
              {users.map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.displayName || "Unnamed"} — {u.email ?? u.phone ?? u.uid.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4">
          <Button
            type="button"
            variant="outline"
            size="md"
            disabled={!canPreview}
            onClick={loadPreview}
          >
            {previewLoading ? "Loading..." : "Preview merge"}
          </Button>
        </div>
      </Card>

      {preview && (
        <form action={formAction} className="flex flex-col gap-6">
          <input type="hidden" name="canonicalUid" value={canonicalUid} />
          <input type="hidden" name="duplicateUid" value={duplicateUid} />
          <input type="hidden" name="roleMergePolicy" value={roleMergePolicy} />
          {roleMergePolicy === "explicit" &&
            explicitRoles.map((role) => (
              <input key={role} type="hidden" name="explicitRoles" value={role} />
            ))}

          <Card>
            <h2 className="text-lg font-bold text-slate-900">Comparison</h2>

            {preview.blocked && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-sm font-medium text-red-800">Merge blocked</p>
                <p className="text-xs text-red-700">{preview.blockedReason}</p>
              </div>
            )}

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Canonical (kept)
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {preview.canonicalUser.displayName || "Unnamed"}
                </p>
                <p className="text-xs text-slate-600">
                  {preview.canonicalUser.email ?? "No email"}
                </p>
                <p className="text-xs text-slate-600">
                  {formatPhoneForDisplay(preview.canonicalUser.phone) ?? "No phone"}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Roles: {preview.canonicalRoles.join(", ") || "none"}
                </p>
                {preview.canonicalDriverId && (
                  <p className="text-xs text-blue-700">Driver registry link: yes</p>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Duplicate (relinked/deleted)
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {preview.duplicateUser.displayName || "Unnamed"}
                </p>
                <p className="text-xs text-slate-600">
                  {preview.duplicateUser.email ?? "No email"}
                </p>
                <p className="text-xs text-slate-600">
                  {formatPhoneForDisplay(preview.duplicateUser.phone) ?? "No phone"}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Roles: {preview.duplicateRoles.join(", ") || "none"}
                </p>
                <p className="text-xs text-slate-500">
                  Requests to relink: {preview.requestCountForDuplicate}
                </p>
                {preview.duplicateDriverId && (
                  <p className="text-xs text-blue-700">Driver registry link: yes</p>
                )}
              </div>
            </div>

            <div className="mt-4">
              <p className="text-sm font-medium text-slate-700">Role merge policy</p>
              <div className="mt-2 flex gap-4">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="roleMergePolicyChoice"
                    checked={roleMergePolicy === "union"}
                    onChange={() => {
                      setRoleMergePolicy("union");
                      setExplicitRoles(preview.defaultUnionRoles);
                    }}
                  />
                  Safe union (resident + viewer only)
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="roleMergePolicyChoice"
                    checked={roleMergePolicy === "explicit"}
                    onChange={() => setRoleMergePolicy("explicit")}
                  />
                  Explicit
                </label>
              </div>

              {roleMergePolicy === "union" && (
                <p className="mt-2 text-xs text-slate-500">
                  Resulting roles: {preview.defaultUnionRoles.join(", ") || "none"}. Admin,
                  dispatcher, and driver roles are not transferred automatically.
                </p>
              )}

              {roleMergePolicy === "explicit" && (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-medium text-amber-800">
                    Select the exact final role list
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {ALL_ROLES.map((role) => (
                      <label key={role} className="flex items-center gap-1 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={explicitRoles.includes(role)}
                          onChange={(e) => {
                            const next = new Set(explicitRoles);
                            if (e.target.checked) next.add(role);
                            else next.delete(role);
                            setExplicitRoles(Array.from(next));
                          }}
                        />
                        {role}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <label className="mt-4 flex flex-col gap-1 text-sm font-medium text-slate-700">
              Reason for merge
              <textarea
                name="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                required
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </label>

            {state.status === "error" && (
              <p role="alert" className="mt-3 text-sm font-medium text-red-700">
                {state.message}
              </p>
            )}

            <div className="mt-4">
              <Button type="submit" size="md" disabled={!canSubmit || pending}>
                {pending ? "Merging..." : "Confirm merge"}
              </Button>
            </div>
          </Card>
        </form>
      )}

      {state.status === "success" && (
        <Card className="!border-green-200 !bg-green-50">
          <p className="text-sm font-medium text-green-800">{state.message}</p>
        </Card>
      )}
    </>
  );
}
