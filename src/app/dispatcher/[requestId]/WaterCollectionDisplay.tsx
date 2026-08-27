"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { FillStation, MeterAssignment, WaterLoadCollection } from "@/lib/domain/types";
import { DEFAULT_FILL_STATION_ID } from "@/lib/domain/types";
import type { RequestedLoads } from "@/lib/domain/quantity";
import { formatSabaDateTime } from "@/lib/utils/datetime";

import { recordCollectionByStaff, type StaffCollectionActionState } from "../actions";

interface Props {
  requestId: string;
  loads: RequestedLoads;
  loadCollections: WaterLoadCollection[] | null;
  /** The assigned driver's Firebase uid. */
  assignedDriverId: string | null;
  /** The assigned driver's display name. */
  assignedDriverName: string | null;
  stations: FillStation[];
  /** Meter assignments for the assigned driver. */
  driverMeters: MeterAssignment[];
  /** Whether the request is in "claimed" status (reconciliation only allowed when claimed). */
  isClaimed: boolean;
}

/**
 * Water Collection display for the dispatcher request detail page.
 * Shows existing collection records and provides a reconciliation form
 * for uncollected loads when the request is still claimed.
 */
export function WaterCollectionDisplay({
  requestId,
  loads,
  loadCollections,
  assignedDriverId,
  assignedDriverName,
  stations,
  driverMeters,
  isClaimed,
}: Props) {
  const collections = loadCollections ?? [];

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Water Collection</h2>
      <div className="mt-3 flex flex-col gap-3">
        {Array.from({ length: loads }, (_, i) => {
          const loadNumber = (i + 1) as 1 | 2;
          const existing = collections.find((c) => c.loadNumber === loadNumber);
          return existing ? (
            <CollectedLoadDisplay key={loadNumber} loadNumber={loadNumber} record={existing} />
          ) : (
            <UncollectedLoad
              key={loadNumber}
              requestId={requestId}
              loadNumber={loadNumber}
              assignedDriverId={assignedDriverId}
              assignedDriverName={assignedDriverName}
              stations={stations}
              driverMeters={driverMeters}
              isClaimed={isClaimed}
            />
          );
        })}
      </div>
    </Card>
  );
}

function CollectedLoadDisplay({
  loadNumber,
  record,
}: {
  loadNumber: 1 | 2;
  record: WaterLoadCollection;
}) {
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-3">
      <div className="flex items-center gap-2">
        <span className="text-green-700">&#10003;</span>
        <span className="text-sm font-medium text-green-800">Load {loadNumber} — Collected</span>
      </div>
      <dl className="mt-2 flex flex-col gap-0.5 text-xs text-green-700">
        <div className="flex gap-1">
          <dt className="font-medium">Station:</dt>
          <dd>{record.fillStationName}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="font-medium">Meter:</dt>
          <dd>{record.meterCode} &middot; Meter {record.meterNumber}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="font-medium">Driver:</dt>
          <dd>{record.driverId}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="font-medium">Collected:</dt>
          <dd>{formatSabaDateTime(record.collectedAt)}</dd>
        </div>
        {record.recordedByRole !== "driver" && (
          <div className="flex gap-1">
            <dt className="font-medium">Recorded by staff:</dt>
            <dd>{record.recordedBy}</dd>
          </div>
        )}
        {record.note && (
          <div className="flex gap-1">
            <dt className="font-medium">Note:</dt>
            <dd>{record.note}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

const collectionInitialState: StaffCollectionActionState = { status: "idle" };

function UncollectedLoad({
  requestId,
  loadNumber,
  assignedDriverId,
  assignedDriverName,
  stations,
  driverMeters,
  isClaimed,
}: {
  requestId: string;
  loadNumber: 1 | 2;
  assignedDriverId: string | null;
  assignedDriverName: string | null;
  stations: FillStation[];
  driverMeters: MeterAssignment[];
  isClaimed: boolean;
}) {
  const [showForm, setShowForm] = useState(false);
  const [selectedStationId, setSelectedStationId] = useState<string>(DEFAULT_FILL_STATION_ID);
  const [state, formAction, pending] = useActionState(recordCollectionByStaff, collectionInitialState);

  const activeStations = stations.filter((s) => s.active);
  const sortedStations = [...activeStations].sort((a, b) => {
    if (a.id === DEFAULT_FILL_STATION_ID) return -1;
    if (b.id === DEFAULT_FILL_STATION_ID) return 1;
    return a.name.localeCompare(b.name);
  });

  const resolvedMeter = driverMeters.find((m) => m.stationId === selectedStationId);

  if (state.status === "success") {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-3">
        <p className="text-sm font-medium text-green-800">{state.message}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-700">
          Load {loadNumber} — Not collected
        </p>
        {isClaimed && !showForm && (
          <Button
            size="md"
            variant="outline"
            className="!h-7 !px-2 !text-xs"
            onClick={() => setShowForm(true)}
          >
            Record collection
          </Button>
        )}
      </div>

      {showForm && isClaimed && (
        <form action={formAction} className="mt-3 flex flex-col gap-2">
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="loadNumber" value={loadNumber} />
          <input type="hidden" name="fillStationId" value={selectedStationId} />
          <input type="hidden" name="driverId" value={assignedDriverId ?? ""} />

          {assignedDriverName && (
            <p className="text-xs text-slate-600">
              Recording for driver: <span className="font-medium">{assignedDriverName}</span>
            </p>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Fill station</span>
            <select
              value={selectedStationId}
              onChange={(e) => setSelectedStationId(e.target.value)}
              className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
            >
              {sortedStations.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>

          {resolvedMeter && (
            <p className="text-xs text-slate-600">
              Meter: <span className="font-medium">{resolvedMeter.meterCode} &middot; Meter {resolvedMeter.meterNumber}</span>
            </p>
          )}
          {selectedStationId && !resolvedMeter && (
            <p className="text-xs font-medium text-red-700">
              No meter is assigned to this driver for the selected fill station.
            </p>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Note (required)</span>
            <textarea
              name="note"
              required
              rows={2}
              placeholder="How this collection was verified (e.g. driver confirmed by phone, paper run sheet)"
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </label>

          {state.status === "error" && (
            <p className="text-xs font-medium text-red-700">{state.message}</p>
          )}

          <div className="flex gap-2">
            <Button
              type="submit"
              size="md"
              disabled={pending || !resolvedMeter || !assignedDriverId}
              className="!h-8 !px-3 !text-xs"
            >
              {pending ? "Recording\u2026" : "Record collection"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="md"
              className="!h-8 !px-3 !text-xs"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
