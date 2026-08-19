import { Card } from "@/components/ui/Card";
import type { DriverEvent } from "@/lib/domain/types";
import { formatSabaDateTime } from "@/lib/utils/datetime";

const EVENT_LABELS: Record<string, string> = {
  driver_online: "Went online",
  driver_offline: "Went offline",
  driver_access_restricted: "Delivery access restricted",
  driver_access_restored: "Delivery access restored",
  driver_cooldown_started: "Decline cooldown started",
  driver_registry_created: "Added to registry",
  driver_registry_updated: "Details updated",
  driver_account_linked: "Account linked",
  driver_account_unlinked: "Account unlinked",
  meter_assignment_added: "Meter assignment added",
  meter_assignment_updated: "Meter assignment updated",
  meter_assignment_removed: "Meter assignment removed",
};

export function DriverEventHistory({ events }: { events: DriverEvent[] }) {
  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">History</h2>
      {events.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">No events recorded.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {events.map((event) => (
            <div key={event.id} className="rounded-lg border border-slate-100 p-3">
              <p className="text-sm font-medium text-slate-900">
                {EVENT_LABELS[event.type] ?? event.type}
              </p>
              <p className="text-xs text-slate-500">
                {formatSabaDateTime(event.createdAt)}
                {event.actorRole && <> ({event.actorRole})</>}
              </p>
              {event.metadata && Object.keys(event.metadata).length > 0 && (
                <p className="mt-1 text-xs text-slate-600">
                  {Object.entries(event.metadata)
                    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                    .join(" \u00b7 ")}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
