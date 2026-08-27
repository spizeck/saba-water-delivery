import { Card } from "@/components/ui/Card";
import type { DriverEvent } from "@/lib/domain/types";
import { formatSabaDateTime } from "@/lib/utils/datetime";
import { formatDriverEventDetails, DRIVER_EVENT_LABELS } from "@/lib/utils/formatAuditEvent";

interface Props {
  events: DriverEvent[];
  nameMap?: Record<string, string>;
}

export function DriverEventHistory({ events, nameMap = {} }: Props) {
  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">History</h2>
      {events.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">No events recorded.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {events.map((event) => {
            const details = formatDriverEventDetails(
              event.type,
              event.metadata,
              { nameMap, actorId: event.actorId },
            );
            return (
              <div key={event.id} className="rounded-lg border border-slate-100 p-3">
                <p className="text-sm font-medium text-slate-900">
                  {DRIVER_EVENT_LABELS[event.type] ?? event.type}
                </p>
                <p className="text-xs text-slate-500">
                  {formatSabaDateTime(event.createdAt)}
                  {event.actorId && (
                    <> &mdash; {nameMap[event.actorId] ?? event.actorId}</>
                  )}
                  {event.actorRole && <> ({event.actorRole})</>}
                </p>
                {details && (
                  <p className="mt-1 text-xs text-slate-600">{details}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
