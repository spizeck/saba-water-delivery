import Link from "next/link";
import { redirect } from "next/navigation";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { hasRole } from "@/lib/auth/roles";
import { getSessionUser } from "@/lib/auth/session";
import {
  checkDeliveryConfirmationTimeout,
  getWaterRequestById,
} from "@/lib/domain/waterRequests";

import { ActiveRequest } from "../../ActiveRequest";

export default async function ResidentDeliveryReviewPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) redirect("/resident");

  const reviewPath = `/resident/review/${encodeURIComponent(requestId)}`;
  const session = await getSessionUser();
  if (!session) {
    redirect(`/login?portal=resident&returnTo=${encodeURIComponent(reviewPath)}`);
  }
  if (!hasRole(session.profile.roles, "resident")) redirect("/access-denied");

  let request = await getWaterRequestById(requestId);
  if (request?.status === "delivered") {
    request = await checkDeliveryConfirmationTimeout(requestId);
  }
  const canReview = request?.customerId === session.uid;

  return (
    <>
      <PortalHeader portalName="Resident" roles={session.profile.roles} />
      <main className="flex-1 py-8">
        <Container className="flex flex-col gap-6">
          {canReview && request ? (
            <ActiveRequest request={request} />
          ) : (
            <Card>
              <h1 className="text-xl font-bold text-slate-900">Delivery review unavailable</h1>
              <p className="mt-2 text-sm text-slate-600">
                This delivery could not be found for your account.
              </p>
            </Card>
          )}
          <Link href="/resident" className="text-sm font-medium text-blue-700 hover:underline">
            Back to Resident portal
          </Link>
        </Container>
      </main>
    </>
  );
}
