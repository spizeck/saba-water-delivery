import { Card } from "@/components/ui/Card";
import type { RoleEvent } from "@/lib/domain/admin";
import type { DriverEvent } from "@/lib/domain/types";
import { formatSabaDateTime } from "@/lib/utils/datetime";

interface UserHistoryProps {
  roleEvents: RoleEvent[];
  driverEvents: DriverEvent[];
  actorNames: Record<string, string>;
  isDriver: boolean;
}

const DRIVER_EVENT_LABELS: Record<string, string> = {
  driver_online: "Went online",
  driver_offline: "Went offline",
  driver_access_restricted: "Delivery access restricted",
  driver_access_restored: "Delivery access restored",
};

const formatDate = formatSabaDateTime;

export function UserHistory({
  roleEvents,
  driverEvents,
  actorNames,
  isDriver,
}: UserHistoryProps) {
  const hasEvents = roleEvents.length > 0 || driverEvents.length > 0;

  if (!hasEvents) return null;

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">History</h2>

      {roleEvents.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-slate-700">Role changes</h3>
          <div className="mt-2 flex flex-col gap-1.5">
            {roleEvents.map((event) => (
              <div
                key={event.id}
                className="flex items-start gap-2 rounded-lg border border-slate-50 p-2"
              >
                <span
                  className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                    event.type === "role_added"
                      ? "bg-green-100 text-green-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {event.type === "role_added" ? "+" : "-"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-900">
                    <span className="font-medium capitalize">{event.role}</span>{" "}
                    {event.type === "role_added" ? "added" : "removed"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDate(event.createdAt)}
                    {event.actorId && (
                      <> &mdash; by {actorNames[event.actorId] ?? event.actorId}</>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isDriver && driverEvents.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-slate-700">
            Driver activity
          </h3>
          <div className="mt-2 flex flex-col gap-1.5">
            {driverEvents.map((event) => (
              <div
                key={event.id}
                className="flex items-start gap-2 rounded-lg border border-slate-50 p-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-900">
                    {DRIVER_EVENT_LABELS[event.type] ?? event.type}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDate(event.createdAt)}
                    {event.actorId && (
                      <>
                        {" "}
                        &mdash; by{" "}
                        {actorNames[event.actorId] ?? event.actorId}
                      </>
                    )}
                  </p>
                  {event.metadata &&
                    Object.keys(event.metadata).length > 0 && (
                      <p className="mt-0.5 text-xs text-slate-500">
                        {Object.entries(event.metadata)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(" · ")}
                      </p>
                    )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
