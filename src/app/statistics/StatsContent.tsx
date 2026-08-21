"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { Card } from "@/components/ui/Card";
import type { StatsData, StatsPeriod } from "@/lib/domain/statistics";

import { CurrentOpsSection } from "./CurrentOpsSection";
import { DisputeSection } from "./DisputeSection";
import { DriverTable } from "./DriverTable";
import { PreferredDriverSection } from "./PreferredDriverSection";
import { TrendChart } from "./TrendChart";
import { VillageTable } from "./VillageTable";

const PERIOD_OPTIONS: { value: StatsPeriod; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
  { value: "all", label: "All time" },
];

interface StatsContentProps {
  stats: StatsData;
}

export function StatsContent({ stats }: StatsContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentPeriod = (searchParams.get("period") ?? "30d") as StatsPeriod;

  function handlePeriodChange(period: StatsPeriod) {
    router.push(`/statistics?period=${period}`);
  }

  return (
    <>
      {/* Header with period selector */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-slate-900">
          Operational Statistics
        </h1>
        <select
          value={currentPeriod}
          onChange={(e) => handlePeriodChange(e.target.value as StatsPeriod)}
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
        >
          {PERIOD_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          label="Total Requests"
          value={stats.summary.totalRequests}
        />
        <MetricCard
          label="Confirmed"
          value={stats.summary.confirmedDeliveries}
          color="green"
        />
        <MetricCard
          label="Awaiting Confirmation"
          value={stats.summary.awaitingConfirmation}
        />
        <MetricCard
          label="Disputed"
          value={stats.summary.disputed}
          color="red"
        />
        <MetricCard
          label="Cancelled"
          value={stats.summary.cancelled}
          color="slate"
        />
        <MetricCard
          label="Gallons"
          value={stats.summary.gallonsDelivered.toLocaleString()}
          sublabel="delivered"
          color="blue"
        />
      </div>

      {/* Request source breakdown */}
      <p className="text-xs text-slate-500">
        {stats.summary.bySource.resident.toLocaleString()} submitted online &middot;{" "}
        {stats.summary.bySource.whatsapp.toLocaleString()} via WhatsApp &middot;{" "}
        {stats.summary.bySource.dispatcher.toLocaleString()} entered by staff
      </p>

      {/* Current operations */}
      <CurrentOpsSection current={stats.current} />

      {/* Priority breakdown */}
      <Card>
        <h2 className="text-lg font-bold text-slate-900">Requests by Priority</h2>
        <p className="mt-1 text-xs text-slate-500">
          Current dispatch priority (initial or staff-overridden), and average
          request-to-delivery time by priority.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {stats.priorityTiming.map((row) => (
            <div key={row.priority}>
              <p className="text-xs font-medium uppercase text-slate-500">{row.priority}</p>
              <p className="mt-0.5 text-xl font-bold text-slate-900">{row.count}</p>
              <p className="text-xs text-slate-500">
                Avg delivery time: {formatDuration(row.avgRequestToDeliveryHours)}
              </p>
            </div>
          ))}
        </div>
      </Card>

      {/* Timing metrics */}
      <Card>
        <h2 className="text-lg font-bold text-slate-900">Average Times</h2>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <TimingItem
            label="Request → Claim"
            hours={stats.timing.avgRequestToClaimHours}
          />
          <TimingItem
            label="Request → Delivery"
            hours={stats.timing.avgRequestToDeliveryHours}
          />
          <TimingItem
            label="Claim → Delivery"
            hours={stats.timing.avgClaimToDeliveryHours}
          />
          <TimingItem
            label="Delivery → Confirm"
            hours={stats.timing.avgDeliveryToConfirmationHours}
          />
        </div>
      </Card>

      {/* Trend chart */}
      <TrendChart data={stats.trend} period={stats.period} />

      {/* Village demand */}
      <VillageTable villages={stats.villages} />

      {/* Driver metrics */}
      <DriverTable drivers={stats.drivers} />

      {/* Preferred driver */}
      <PreferredDriverSection metrics={stats.preferredDriver} />

      {/* Dispatch offers */}
      <Card>
        <h2 className="text-lg font-bold text-slate-900">Dispatch Offers</h2>
        <p className="mt-1 text-xs text-slate-500">
          One-request-at-a-time driver offers, accept/decline outcomes
        </p>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatItem label="Offers Sent" value={stats.dispatchOffers.offersSent} />
          <StatItem label="Accepted" value={stats.dispatchOffers.accepted} />
          <StatItem label="Declined" value={stats.dispatchOffers.declined} />
          <StatItem
            label="Acceptance Rate"
            value={
              stats.dispatchOffers.acceptanceRate === null
                ? "—"
                : `${stats.dispatchOffers.acceptanceRate}%`
            }
          />
        </div>
      </Card>

      {/* Disputes */}
      <DisputeSection metrics={stats.disputes} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetricCard({
  label,
  value,
  sublabel,
  color,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
  color?: "green" | "red" | "blue" | "slate";
}) {
  const colorClass = {
    green: "text-green-700",
    red: "text-red-700",
    blue: "text-blue-700",
    slate: "text-slate-500",
  }[color ?? "slate"] ?? "text-slate-900";

  return (
    <Card className="!p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${colorClass}`}>{value}</p>
      {sublabel && <p className="text-xs text-slate-400">{sublabel}</p>}
    </Card>
  );
}

function formatDuration(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = Math.round(hours % 24);
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

function TimingItem({ label, hours }: { label: string; hours: number | null }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-slate-900">
        {formatDuration(hours)}
      </p>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-slate-900">{value}</p>
    </div>
  );
}
