import "server-only";

/**
 * Renders the operational continuity snapshot (see
 * `src/lib/domain/continuityReport.ts`) as a compact, printable PDF.
 * See PRODUCT.md / TECHNICAL.md "Operational Continuity Snapshot".
 *
 * Deliberately simple and operational — a plain, readable document
 * suitable for printing or viewing on a phone during an outage, not a
 * styled report platform (see DEVIN.md "Do Not Overbuild"). There is
 * exactly one PDF implementation, shared by the nightly email job and
 * the staff-only manual download route.
 */

import PDFDocument from "pdfkit";

import type {
  AssignedReportRow,
  ContinuityReportData,
  UnassignedReportRow,
} from "@/lib/domain/continuityReport";
import { formatWaterQuantity } from "@/lib/domain/quantity";
import { formatSabaDateTime } from "@/lib/utils/datetime";

export { continuityReportPdfFilename } from "./continuityReportFilename";

const PRIORITY_LABEL: Record<string, string> = {
  critical: "CRITICAL",
  urgent: "Urgent",
  normal: "Normal",
};

function formatAge(ageMinutes: number): string {
  const hours = Math.floor(ageMinutes / 60);
  const minutes = ageMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function compactNotes(notes: string): string {
  return notes.length > 240 ? `${notes.slice(0, 237)}...` : notes;
}

function drawSectionHeading(doc: PDFKit.PDFDocument, text: string) {
  if (doc.y > doc.page.height - doc.page.margins.bottom - 80) {
    doc.addPage();
  }
  doc.moveDown(0.75);
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#0f172a").text(text);
  doc.moveDown(0.25);
}

function drawUnassignedRow(doc: PDFKit.PDFDocument, row: UnassignedReportRow) {
  if (doc.y > doc.page.height - doc.page.margins.bottom - 70) {
    doc.addPage();
  }
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(row.priority === "critical" ? "#991b1b" : "#0f172a")
    .text(
      `${PRIORITY_LABEL[row.priority] ?? row.priority}${row.isEscalated ? " [ESCALATED]" : ""} — ${row.customerName}`,
      { continued: false },
    );
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
  if (row.requestNotes) doc.text(`Notes: ${compactNotes(row.requestNotes)}`);
  doc.text(
    [
      `Requested: ${formatSabaDateTime(row.requestedAt)}`,
      `Age: ${formatAge(row.ageMinutes)}`,
      row.preferredDriverName ? `Preferred driver: ${row.preferredDriverName}` : null,
    ]
      .filter(Boolean)
      .join("   |   "),
  );
  doc.moveDown(0.6);
}

function drawAssignedRow(doc: PDFKit.PDFDocument, row: AssignedReportRow) {
  if (doc.y > doc.page.height - doc.page.margins.bottom - 70) {
    doc.addPage();
  }
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(row.priority === "critical" ? "#991b1b" : "#0f172a")
    .text(`${PRIORITY_LABEL[row.priority] ?? row.priority} — ${row.customerName}`);
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
  if (row.requestNotes) doc.text(`Notes: ${compactNotes(row.requestNotes)}`);
  doc.text(
    [
      `Driver: ${row.assignedDriverName ?? "Unknown driver"}${row.isBatchAssigned ? " (Delivery Run)" : ""}`,
      `Requested: ${formatSabaDateTime(row.requestedAt)}`,
      row.claimedAt ? `Claimed: ${formatSabaDateTime(row.claimedAt)}` : null,
    ]
      .filter(Boolean)
      .join("   |   "),
  );
  // Collection progress
  doc.text(`Water collected: ${row.loadsCollected}/${row.loads} loads`);
  if (row.collectionDetails.length > 0) {
    const details = row.collectionDetails
      .map((d) => `Load ${d.loadNumber}: ${d.fillStationName} (${d.meterCode})`)
      .join("  |  ");
    doc.text(details);
  }
  doc.moveDown(0.6);
}

/**
 * Renders `data` to a PDF buffer. Pure with respect to its input (no
 * Firestore access, no side effects) — the same function is used by
 * both the nightly cron job (to email) and the manual staff download
 * route (to stream directly to the browser).
 */
export function renderContinuityReportPdf(data: ContinuityReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(18).fillColor("#0f172a").text("Saba Water Delivery");
    doc.font("Helvetica-Bold").fontSize(14).text("Outstanding Delivery Snapshot");
    doc.moveDown(0.5);
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#475569")
      .text(`Generated: ${formatSabaDateTime(data.generatedAt)} Saba Time`);
    doc
      .font("Helvetica-Oblique")
      .fontSize(9)
      .fillColor("#64748b")
      .text(
        "This report reflects the delivery queue as of the generated time shown above. It is a snapshot, not live data.",
      );

    drawSectionHeading(doc, `Unassigned Requests (${data.unassigned.length})`);
    if (data.unassigned.length === 0) {
      doc.font("Helvetica").fontSize(9).fillColor("#64748b").text("None.");
    } else {
      for (const row of data.unassigned) drawUnassignedRow(doc, row);
    }

    drawSectionHeading(doc, `Assigned Requests (${data.assigned.length})`);
    if (data.assigned.length === 0) {
      doc.font("Helvetica").fontSize(9).fillColor("#64748b").text("None.");
    } else {
      for (const row of data.assigned) drawAssignedRow(doc, row);
    }

    doc.end();
  });
}
