"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/Button";
import type { FillStation, MeterAssignment, WaterLoadCollection } from "@/lib/domain/types";
import { DEFAULT_FILL_STATION_ID } from "@/lib/domain/types";

import { recordCollection, type RecordCollectionActionState } from "./actions";

interface Props {
  requestId: string;
  loads: 1 | 2;
  loadCollections: WaterLoadCollection[] | null;
  stations: FillStation[];
  meters: MeterAssignment[];
}

const initialState: RecordCollectionActionState = { status: "idle" };

/**
 * Water Collection section for the driver's active delivery card.
 * Shows one panel per physical load with fill-station selection,
 * resolved meter display, and a collection checkbox.
 */
export function WaterCollectionSection({
  requestId,
  loads,
  loadCollections,
  stations,
  meters,
}: Props) {
  const collections = loadCollections ?? [];
  const activeStations = stations.filter((s) => s.active);

  // Sort stations: The Bottom first, then others
  const sortedStations = [...activeStations].sort((a, b) => {
    if (a.id === DEFAULT_FILL_STATION_ID) return -1;
    if (b.id === DEFAULT_FILL_STATION_ID) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-bold text-slate-900">Water Collection</h3>
      <div className="mt-3 flex flex-col gap-4">
        {Array.from({ length: loads }, (_, i) => {
          const loadNumber = (i + 1) as 1 | 2;
          const existing = collections.find((c) => c.loadNumber === loadNumber);
          return (
            <LoadCollectionPanel
              key={loadNumber}
              requestId={requestId}
              loadNumber={loadNumber}
              existing={existing ?? null}
              sortedStations={sortedStations}
              meters={meters}
            />
          );
        })}
      </div>
    </div>
  );
}

function LoadCollectionPanel({
  requestId,
  loadNumber,
  existing,
  sortedStations,
  meters,
}: {
  requestId: string;
  loadNumber: 1 | 2;
  existing: WaterLoadCollection | null;
  sortedStations: FillStation[];
  meters: MeterAssignment[];
}) {
  const [selectedStationId, setSelectedStationId] = useState<string>(
    DEFAULT_FILL_STATION_ID,
  );
  const [state, formAction, pending] = useActionState(recordCollection, initialState);

  // If already collected, show the recorded info
  if (existing) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-3">
        <div className="flex items-center gap-2">
          <span className="text-green-700">&#10003;</span>
          <span className="text-sm font-medium text-green-800">
            Load {loadNumber} — Collected
          </span>
        </div>
        <dl className="mt-2 flex flex-col gap-0.5 text-xs text-green-700">
          <div className="flex gap-1">
            <dt className="font-medium">Station:</dt>
            <dd>{existing.fillStationName}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="font-medium">Meter:</dt>
            <dd>{existing.meterCode} &middot; Meter {existing.meterNumber}</dd>
          </div>
          {existing.collectedAt && (
            <div className="flex gap-1">
              <dt className="font-medium">Collected:</dt>
              <dd>{new Date(existing.collectedAt).toLocaleString()}</dd>
            </div>
          )}
        </dl>
      </div>
    );
  }

  // Resolve meter for selected station
  const resolvedMeter = meters.find((m) => m.stationId === selectedStationId);
  const hasNoMeter = selectedStationId && !resolvedMeter;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-sm font-medium text-slate-900">Load {loadNumber}</p>

      <div className="mt-2 flex flex-col gap-2">
        {/* Fill station select */}
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Fill station</span>
          <select
            value={selectedStationId}
            onChange={(e) => setSelectedStationId(e.target.value)}
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
          >
            {sortedStations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        {/* Resolved meter display */}
        {resolvedMeter && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Your meter</span>
            <p className="text-sm text-slate-900">
              {resolvedMeter.meterCode} &middot; Meter {resolvedMeter.meterNumber}
            </p>
          </div>
        )}

        {/* No meter warning */}
        {hasNoMeter && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-2">
            <p className="text-xs font-medium text-red-800">
              No meter is assigned to you for this fill station. Contact the Water Delivery Office.
            </p>
          </div>
        )}

        {/* Collection form */}
        {state.status === "error" && (
          <p role="alert" className="text-xs font-medium text-red-700">
            {state.message}
          </p>
        )}
        {state.status === "success" && (
          <p className="text-xs font-medium text-green-700">{state.message}</p>
        )}

        <form action={formAction}>
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="loadNumber" value={loadNumber} />
          <input type="hidden" name="fillStationId" value={selectedStationId} />
          <Button
            type="submit"
            size="md"
            disabled={pending || hasNoMeter || !selectedStationId}
            className="w-full"
          >
            {pending ? "Recording\u2026" : "Water collected"}
          </Button>
        </form>
      </div>
    </div>
  );
}
