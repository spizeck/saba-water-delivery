import type { Metadata } from "next";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";
import { getStatistics, type StatsPeriod } from "@/lib/domain/statistics";

import { StatsContent } from "./StatsContent";

export const metadata: Metadata = {
  title: "Statistics — Saba Water Delivery",
};

interface PageProps {
  searchParams: Promise<{ period?: string }>;
}

const VALID_PERIODS: StatsPeriod[] = ["7d", "30d", "month", "year", "all"];

export default async function StatisticsPage({ searchParams }: PageProps) {
  const { profile } = await requireRole(["dispatcher", "admin"]);
  const params = await searchParams;

  const period: StatsPeriod = VALID_PERIODS.includes(params.period as StatsPeriod)
    ? (params.period as StatsPeriod)
    : "30d";

  const stats = await getStatistics(period);

  return (
    <>
      <PortalHeader portalName="Statistics" roles={profile.roles} />
      <main className="flex-1 py-8">
        <Container className="flex flex-col gap-6 max-w-6xl">
          <StatsContent stats={stats} />
        </Container>
      </main>
    </>
  );
}
