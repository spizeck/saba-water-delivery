"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { UserRole } from "@/lib/domain/types";

import { addUserRole, removeUserRole, type RoleActionState } from "../../actions";

const MANAGEABLE_ROLES: { role: UserRole; label: string; description: string }[] = [
  { role: "dispatcher", label: "Dispatcher", description: "Access dispatcher operational functions" },
  { role: "admin", label: "Admin", description: "Full system administration access" },
  { role: "viewer", label: "Viewer", description: "Read-only oversight of requests and statistics" },
];

interface RoleManagementProps {
  targetUid: string;
  currentRoles: UserRole[];
  isOwnAccount: boolean;
  linkedDriverId: string | null;
}

export function RoleManagement({
  targetUid,
  currentRoles,
  isOwnAccount,
  linkedDriverId,
}: RoleManagementProps) {
  const [confirmingRemove, setConfirmingRemove] = useState<UserRole | null>(null);

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Roles</h2>
      <p className="mt-1 text-xs text-slate-500">
        Resident is the baseline role and cannot be removed. The driver role is managed from the
        Driver Registry.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        {/* Resident role (always present, not toggleable) */}
        <div className="flex items-center justify-between rounded-lg border border-slate-100 p-3">
          <div>
            <p className="text-sm font-medium text-slate-900">Resident</p>
            <p className="text-xs text-slate-500">Baseline account access</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
            Always active
          </span>
        </div>

        {/* Driver role — system managed */}
        {currentRoles.includes("driver") && (
          <div className="flex items-center justify-between rounded-lg border border-slate-100 p-3">
            <div>
              <p className="text-sm font-medium text-slate-900">Driver</p>
              <p className="text-xs text-slate-500">Managed through the Driver Registry</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                Active
              </span>
              {linkedDriverId && (
                <Link
                  href={`/admin/drivers/${linkedDriverId}`}
                  className="text-xs text-blue-700 hover:underline"
                >
                  View Driver Record
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Manageable roles */}
        {MANAGEABLE_ROLES.map(({ role, label, description }) => {
          const hasRole = currentRoles.includes(role);
          return (
            <RoleRow
              key={role}
              targetUid={targetUid}
              role={role}
              label={label}
              description={description}
              hasRole={hasRole}
              isOwnAccount={isOwnAccount}
              isConfirming={confirmingRemove === role}
              onConfirmStart={() => setConfirmingRemove(role)}
              onConfirmCancel={() => setConfirmingRemove(null)}
            />
          );
        })}
      </div>
    </Card>
  );
}

interface RoleRowProps {
  targetUid: string;
  role: UserRole;
  label: string;
  description: string;
  hasRole: boolean;
  isOwnAccount: boolean;
  isConfirming: boolean;
  onConfirmStart: () => void;
  onConfirmCancel: () => void;
}

function RoleRow({
  targetUid,
  role,
  label,
  description,
  hasRole,
  isOwnAccount,
  isConfirming,
  onConfirmStart,
  onConfirmCancel,
}: RoleRowProps) {
  const initialState: RoleActionState = { status: "idle" };
  const [addState, addAction, addPending] = useActionState(addUserRole, initialState);
  const [removeState, removeAction, removePending] = useActionState(removeUserRole, initialState);

  return (
    <div className="rounded-lg border border-slate-100 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">{label}</p>
          <p className="text-xs text-slate-500">{description}</p>
        </div>
        {hasRole ? (
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
              Active
            </span>
            {role === "admin" && isOwnAccount ? (
              <span className="text-xs text-slate-400">You</span>
            ) : (
              <button
                type="button"
                onClick={onConfirmStart}
                disabled={removePending}
                className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
        ) : (
          <form action={addAction}>
            <input type="hidden" name="targetUid" value={targetUid} />
            <input type="hidden" name="role" value={role} />
            <Button
              type="submit"
              variant="outline"
              size="md"
              disabled={addPending}
              className="!h-8 !px-3 !text-xs"
            >
              {addPending ? "Adding..." : "Add"}
            </Button>
          </form>
        )}
      </div>

      {/* Add state feedback */}
      {addState.status === "success" && (
        <p className="mt-2 text-xs font-medium text-green-700">{addState.message}</p>
      )}
      {addState.status === "error" && (
        <p className="mt-2 text-xs font-medium text-red-700">{addState.message}</p>
      )}

      {/* Remove state feedback */}
      {removeState.status === "success" && (
        <p className="mt-2 text-xs font-medium text-green-700">{removeState.message}</p>
      )}
      {removeState.status === "error" && (
        <p className="mt-2 text-xs font-medium text-red-700">{removeState.message}</p>
      )}

      {/* Confirmation dialog for removal */}
      {hasRole && isConfirming && !(role === "admin" && isOwnAccount) && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-800">Remove the {label} role from this user?</p>
          <div className="mt-2 flex gap-2">
            <form action={removeAction}>
              <input type="hidden" name="targetUid" value={targetUid} />
              <input type="hidden" name="role" value={role} />
              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={removePending}
                className="!h-7 !px-3 !text-xs !bg-red-700 hover:!bg-red-800"
              >
                {removePending ? "Removing..." : "Confirm remove"}
              </Button>
            </form>
            <button
              type="button"
              onClick={onConfirmCancel}
              className="rounded-lg px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
