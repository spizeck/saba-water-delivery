import { Card } from "@/components/ui/Card";
import type { DailyVolume, StatsPeriod } from "@/lib/domain/statistics";

interface TrendChartProps {
  data: DailyVolume[];
  period: StatsPeriod;
}

export function TrendChart({ data, period }: TrendChartProps) {
  if (data.length === 0) {
    return (
      <Card>
        <h2 className="text-lg font-bold text-slate-900">Request Volume</h2>
        <p className="mt-2 text-sm text-slate-500">No data for this period.</p>
      </Card>
    );
  }

  const maxValue = Math.max(...data.map((d) => d.requests), 1);
  const isMonthly = period === "year" || period === "all";

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Request Volume</h2>
      <p className="mt-1 text-xs text-slate-500">
        {isMonthly ? "Monthly" : "Daily"} requests
      </p>

      <div className="mt-4 flex items-end gap-1 overflow-x-auto pb-2" style={{ minHeight: 120 }}>
        {data.map((d) => {
          const height = Math.max((d.requests / maxValue) * 100, 4);
          return (
            <div
              key={d.date}
              className="group relative flex flex-col items-center"
              style={{ minWidth: data.length > 30 ? 12 : 24 }}
            >
              <div
                className="w-full rounded-t bg-blue-500 transition-colors group-hover:bg-blue-700"
                style={{ height: `${height}px`, minWidth: 8 }}
                title={`${d.date}: ${d.requests} request${d.requests !== 1 ? "s" : ""}`}
              />
              {data.length <= 14 && (
                <p className="mt-1 text-[10px] text-slate-400 whitespace-nowrap">
                  {formatLabel(d.date, isMonthly)}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {data.length > 14 && (
        <div className="mt-1 flex justify-between text-[10px] text-slate-400">
          <span>{formatLabel(data[0].date, isMonthly)}</span>
          <span>{formatLabel(data[data.length - 1].date, isMonthly)}</span>
        </div>
      )}
    </Card>
  );
}

function formatLabel(dateStr: string, isMonthly: boolean): string {
  if (isMonthly) {
    // YYYY-MM -> "Jan", "Feb", etc.
    const [year, month] = dateStr.split("-");
    const d = new Date(Number(year), Number(month) - 1, 1);
    return d.toLocaleDateString(undefined, { month: "short" });
  }
  // YYYY-MM-DD -> "12/3", "1/15", etc.
  const parts = dateStr.split("-");
  return `${Number(parts[1])}/${Number(parts[2])}`;
}
