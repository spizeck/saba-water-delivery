"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { FillStation, MeterAssignment } from "@/lib/domain/types";

import { setMeterAssignmentAction, type DriverFormActionState } from "../actions";

const initialState: DriverFormActionState = { status: "idle" };

interface Props {
  driverId: string;
  stations: FillStation[];
  meters: MeterAssignment[];
}

export function MeterAssignmentsPanel({ driverId, stations, meters }: Props) {
  const meterByStation = new Map(meters.map((m) => [m.stationId, m]));

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Fill Station Meters</h2>
      <div className="mt-3 flex flex-col divide-y divide-slate-100">
        {stations
          .filter((s) => s.active)
          .map((station) => (
            <StationRow
              key={station.id}
              driverId={driverId}
              station={station}
              meter={meterByStation.get(station.id) ?? null}
            />
          ))}
      </div>
    </Card>
  );
}

function StationRow({
  driverId,
  station,
  meter,
}: {
  driverId: string;
  station: FillStation;
  meter: MeterAssignment | null;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(setMeterAssignmentAction, initialState);

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">{station.name}</p>
          <p className="text-sm text-slate-600">
            {meter ? `${meter.meterCode} \u2014 Meter ${meter.meterNumber}` : "No meter assigned"}
          </p>
        </div>
        <Button
          size="md"
          variant="outline"
          className="!h-8 !px-3 !text-xs"
          onClick={() => setEditing((v) => !v)}
        >
          {meter ? "Edit" : "Assign"}
        </Button>
      </div>

      {editing && (
        <form
          action={formAction}
          className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 p-3"
        >
          <input type="hidden" name="driverId" value={driverId} />
          <input type="hidden" name="stationId" value={station.id} />
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
            Meter code
            <input
              name="meterCode"
              defaultValue={meter?.meterCode ?? ""}
              required
              className="h-9 w-28 rounded-lg border border-slate-300 px-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
            Meter number
            <input
              name="meterNumber"
              type="number"
              min={0}
              defaultValue={meter?.meterNumber ?? ""}
              required
              className="h-9 w-24 rounded-lg border border-slate-300 px-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </label>
          <Button type="submit" size="md" disabled={pending} className="!h-9 !text-xs">
            {pending ? "Saving\u2026" : "Save"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="md"
            className="!h-9 !text-xs"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
          {state.status === "error" && (
            <p className="w-full text-xs font-medium text-red-700">{state.message}</p>
          )}
          {state.status === "success" && (
            <p className="w-full text-xs font-medium text-green-700">{state.message}</p>
          )}
        </form>
      )}
    </div>
  );
}
