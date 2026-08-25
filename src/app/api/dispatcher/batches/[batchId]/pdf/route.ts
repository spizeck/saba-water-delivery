import { requireRole } from "@/lib/auth/session";
import { getDispatchBatch, recordBatchGenerated } from "@/lib/domain/dispatchBatches";
import { buildDispatchBatchPdfData } from "@/lib/domain/dispatchBatchPdfData";
import { getAllDriverRegistryEntries } from "@/lib/domain/driverRegistry";
import { getRequestsForDispatchBatch } from "@/lib/domain/waterRequests";
import { dispatchBatchPdfFilename, renderDispatchBatchPdf } from "@/lib/reports/dispatchBatchPdf";

/**
 * Staff-only Batch Dispatch driver run sheet — see PRODUCT.md /
 * TECHNICAL.md "Batch Dispatch". Used both for the initial download
 * right after creating a batch and for every later "Reprint Dispatch
 * Sheet." Never creates a new batch merely to regenerate the PDF — see
 * PRODUCT.md "Batch Dispatch" "Reprint" for why a reprint always
 * reflects the batch's CURRENT member requests and their current
 * status, not a frozen snapshot of the original assignment.
 *
 * The PDF is generated on demand and streamed directly to the browser;
 * it is never written to public storage, matching the existing
 * continuity-report route's privacy posture.
 */
interface RouteParams {
  params: Promise<{ batchId: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  const session = await requireRole(["dispatcher", "admin"]);
  const { batchId } = await params;

  const batch = await getDispatchBatch(batchId);
  if (!batch) {
    return new Response("Batch not found.", { status: 404 });
  }

  const [requests, allDrivers] = await Promise.all([
    getRequestsForDispatchBatch(batchId),
    getAllDriverRegistryEntries(),
  ]);

  const driverNamesByUserId = new Map<string, string>();
  for (const d of allDrivers) {
    if (d.linkedUserId) driverNamesByUserId.set(d.linkedUserId, d.displayName);
  }
  const driverName = driverNamesByUserId.get(batch.driverId) ?? "Unknown driver";

  const data = buildDispatchBatchPdfData(
    batch.id,
    batch.driverId,
    driverName,
    requests,
    driverNamesByUserId,
  );
  const pdfBuffer = await renderDispatchBatchPdf(data);
  const filename = dispatchBatchPdfFilename(batch.id, driverName, data.generatedAt);

  await recordBatchGenerated(batch.id, session.uid);

  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
