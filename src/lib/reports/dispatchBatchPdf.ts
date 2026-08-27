import "server-only";

/**
 * Renders a Batch Dispatch driver run sheet (see
 * `src/lib/domain/dispatchBatchPdfData.ts`) as a compact, printable
 * PDF. See PRODUCT.md / TECHNICAL.md "Batch Dispatch".
 *
 * Reuses the exact same PDFKit setup/conventions as
 * `continuityReportPdf.ts` — deliberately simple and operational, not a
 * styled report platform (see DEVIN.md "Do Not Overbuild"). There is
 * exactly one implementation, used for both the initial batch-creation
 * download and every later reprint.
 */

import PDFDocument from "pdfkit";

import type { DispatchBatchPdfData, DispatchBatchPdfRow } from "@/lib/domain/dispatchBatchPdfData";
import { formatWaterQuantity } from "@/lib/domain/quantity";
import { formatSabaDateTime } from "@/lib/utils/datetime";

export { dispatchBatchPdfFilename } from "./dispatchBatchPdfFilename";

const PRIORITY_LABEL: Record<string, string> = {
  critical: "CRITICAL",
  urgent: "Urgent",
  normal: "Normal",
};

const STATUS_LABEL: Record<string, string> = {
  claimed: "Not yet delivered",
  delivered: "Delivered",
  confirmed: "Delivered — confirmed",
  disputed: "Delivered — disputed",
  cancelled: "Cancelled",
  requested: "Not yet delivered",
  available: "Not yet delivered",
  preferred_driver_hold: "Not yet delivered",
};

function formatAge(ageMinutes: number): string {
  const hours = Math.floor(ageMinutes / 60);
  const minutes = ageMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function drawRow(doc: PDFKit.PDFDocument, row: DispatchBatchPdfRow) {
  // Account for extra lines with 2-load requests (collection areas)
  const extraHeight = row.loads === 2 ? 40 : 20;
  if (doc.y > doc.page.height - doc.page.margins.bottom - 130 - extraHeight) {
    doc.addPage();
  }

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(row.priority === "critical" ? "#991b1b" : "#0f172a")
    .text(`${row.sequence}. ${row.customerName}`, { continued: true })
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#334155")
    .text(`   ${PRIORITY_LABEL[row.priority] ?? row.priority} priority`);

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#334155")
    .text(
      [
        `Village: ${row.village}`,
        row.phone ? `Phone: ${row.phone}` : null,
        `Quantity: ${formatWaterQuantity(row.loads)}`,
      ]
        .filter(Boolean)
        .join("   |   "),
    );
  doc.text(`Directions: ${row.deliveryDirections}`);
  doc.text(
    [
      `Requested: ${formatSabaDateTime(row.requestedAt)}`,
      `Age at printing: ${formatAge(row.ageMinutesAtGeneration)}`,
      row.preferredDriverName
        ? row.preferredDriverIsBatchDriver
          ? `Preferred driver: ${row.preferredDriverName}`
          : `Originally preferred: ${row.preferredDriverName} (reassigned to this run)`
        : null,
    ]
      .filter(Boolean)
      .join("   |   "),
  );

  if (row.status === "claimed") {
    doc.moveDown(0.3);
    // Per-load collection areas
    for (let i = 1; i <= row.loads; i++) {
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#0f172a")
        .text(`Load ${i}:  Fill station: ________________  Meter: ________________  [ ] Water collected  Time: __________`);
    }
    doc.moveDown(0.2);
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#0f172a")
      .text("[ ] Delivered      Driver initials: __________      Time: __________");
    doc.text("Notes: ______________________________________________");
  } else {
    doc
      .font("Helvetica-Oblique")
      .fontSize(9)
      .fillColor("#166534")
      .text(
        `${STATUS_LABEL[row.status] ?? row.status}` +
          (row.deliveredAt ? ` (${formatSabaDateTime(row.deliveredAt)})` : ""),
      );
  }

  doc.moveDown(0.7);
}

/**
 * Renders `data` to a PDF buffer. Pure with respect to its input (no
 * Firestore access, no side effects) — used identically for the
 * initial download after creating a batch and for every later reprint.
 */
export function renderDispatchBatchPdf(data: DispatchBatchPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(18).fillColor("#0f172a").text("Saba Water Delivery");
    doc.font("Helvetica-Bold").fontSize(14).text("Delivery Run Sheet");
    doc.moveDown(0.5);
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#334155")
      .text(`Driver: ${data.driverName}`);
    doc.text(`Generated: ${formatSabaDateTime(data.generatedAt)} Saba Time`);
    doc.text(`Run ID: ${data.batchId.slice(0, 8)}`);
    doc
      .font("Helvetica-Oblique")
      .fontSize(9)
      .fillColor("#64748b")
      .text(
        "This sheet reflects assignments as of the generated time shown above.",
      );

    doc.moveDown(0.5);
    doc
      .font("Helvetica-Bold")
      .fontSize(13)
      .fillColor("#0f172a")
      .text(`Requests (${data.rows.length})`);
    doc.moveDown(0.25);

    if (data.rows.length === 0) {
      doc.font("Helvetica").fontSize(9).fillColor("#64748b").text("No requests in this delivery run.");
    } else {
      for (const row of data.rows) drawRow(doc, row);
    }

    doc.end();
  });
}
