"use client";

import Link from "next/link";
import { useState } from "react";

import { Card } from "@/components/ui/Card";
import type { AdminUserListItem } from "@/lib/domain/admin";
import type { UserRole } from "@/lib/domain/types";

const ROLE_LABELS: Record<UserRole, string> = {
  resident: "Resident",
  driver: "Driver",
  dispatcher: "Dispatcher",
  admin: "Admin",
  viewer: "Viewer",
};

interface UserListProps {
  users: AdminUserListItem[];
}

export function UserList({ users }: UserListProps) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");

  const filtered = users.filter((user) => {
    // Role filter
    if (roleFilter !== "all" && !user.roles.includes(roleFilter)) {
      return false;
    }
    // Text search
    if (search) {
      const q = search.toLowerCase();
      return (
        user.displayName.toLowerCase().includes(q) ||
        (user.email?.toLowerCase().includes(q) ?? false)
      );
    }
    return true;
  });

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as UserRole | "all")}
            className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
          >
            <option value="all">All roles</option>
            <option value="resident">Resident</option>
            <option value="driver">Driver</option>
            <option value="dispatcher">Dispatcher</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        <p className="text-xs text-slate-500">
          {filtered.length} user{filtered.length !== 1 ? "s" : ""}
          {search || roleFilter !== "all" ? " matching" : " total"}
        </p>

        <div className="flex flex-col divide-y divide-slate-100">
          {filtered.map((user) => (
            <div
              key={user.uid}
              className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900">
                  {user.displayName || "Unnamed"}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {user.email ?? "No email"}
                  {user.phone ? ` · ${user.phone}` : ""}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {user.roles.map((role) => (
                    <span
                      key={role}
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${getRoleBadgeClass(role)}`}
                    >
                      {ROLE_LABELS[role]}
                    </span>
                  ))}
                  {user.driverStatus && (
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        user.driverStatus.eligibilityStatus === "eligible"
                          ? "bg-green-50 text-green-700"
                          : "bg-red-50 text-red-700"
                      }`}
                    >
                      {user.driverStatus.eligibilityStatus === "eligible"
                        ? "Eligible"
                        : "Ineligible"}
                    </span>
                  )}
                </div>
              </div>
              <Link
                href={`/admin/users/${user.uid}`}
                className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Manage
              </Link>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="py-4 text-center text-sm text-slate-500">
              No users found.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function getRoleBadgeClass(role: UserRole): string {
  switch (role) {
    case "admin":
      return "bg-purple-50 text-purple-700";
    case "dispatcher":
      return "bg-blue-50 text-blue-700";
    case "driver":
      return "bg-amber-50 text-amber-700";
    case "resident":
      return "bg-slate-100 text-slate-600";
    case "viewer":
      return "bg-teal-50 text-teal-700";
  }
}
