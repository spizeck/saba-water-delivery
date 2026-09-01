import Link from "next/link";

import { Card } from "@/components/ui/Card";
import type { DriverRegistryEntry } from "@/lib/domain/types";

interface Props {
  drivers: DriverRegistryEntry[];
  title?: string;
  showStatus?: boolean;
}

export function DriverRegistryList({ drivers, title, showStatus }: Props) {
  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">
        {title ?? "Drivers"} ({drivers.length})
      </h2>

      {drivers.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">No drivers in this list.</p>
      ) : (
        <div className="mt-4 flex flex-col divide-y divide-slate-100">
          {drivers.map((driver) => (
            <div key={driver.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{driver.displayName}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {driver.archivedAt ? (
                    <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                      Archived
                    </span>
                  ) : (
                    <>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          driver.eligibilityStatus === "eligible"
                            ? "bg-green-50 text-green-700"
                            : "bg-red-50 text-red-700"
                        }`}
                      >
                        {driver.eligibilityStatus === "eligible" ? "Eligible" : "Ineligible"}
                      </span>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          driver.availabilityStatus === "online"
                            ? "bg-green-50 text-green-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {driver.availabilityStatus === "online" ? "Online" : "Offline"}
                      </span>
                    </>
                  )}
                  {driver.linkedUserId ? (
                    <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                      Account linked
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                      No account
                    </span>
                  )}
                </div>
              </div>
              <Link
                href={`/admin/drivers/${driver.id}`}
                className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Manage
              </Link>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
