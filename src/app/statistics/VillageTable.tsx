import { Card } from "@/components/ui/Card";
import type { VillageDemand } from "@/lib/domain/statistics";

interface VillageTableProps {
  villages: VillageDemand[];
}

export function VillageTable({ villages }: VillageTableProps) {
  if (villages.length === 0) {
    return (
      <Card>
        <h2 className="text-lg font-bold text-slate-900">Demand by Village</h2>
        <p className="mt-2 text-sm text-slate-500">No data for this period.</p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Demand by Village</h2>
      <p className="mt-1 text-xs text-slate-500">Sorted by highest demand</p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="pb-2 font-medium text-slate-500">Village</th>
              <th className="pb-2 text-right font-medium text-slate-500">
                Requests
              </th>
              <th className="pb-2 text-right font-medium text-slate-500">
                Delivered
              </th>
              <th className="pb-2 text-right font-medium text-slate-500">
                Gallons
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {villages.map((v) => (
              <tr key={v.village}>
                <td className="py-2 font-medium text-slate-900">{v.village}</td>
                <td className="py-2 text-right text-slate-700">{v.requests}</td>
                <td className="py-2 text-right text-slate-700">
                  {v.deliveredLoads}
                </td>
                <td className="py-2 text-right text-slate-700">
                  {v.gallonsDelivered.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
