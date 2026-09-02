import { formatSabaDateTime } from "@/lib/utils/datetime";

export interface DeliveryConfirmationEmailConfig {
  apiKey: string;
  from: string;
  appUrl: string;
}

export interface DeliveryConfirmationEmailInput {
  to: string;
  displayName: string;
  requestId: string;
  loads: 1 | 2;
  gallons: 1000 | 2000;
  village: string;
  deliveryDirections: string;
  deliveredAt: string;
}

export function getDeliveryConfirmationEmailConfig(): DeliveryConfirmationEmailConfig | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.DELIVERY_CONFIRMATION_EMAIL_FROM?.trim() ||
    process.env.CONTINUITY_REPORT_EMAIL_FROM?.trim();
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ||
    "https://saba-water-delivery.vercel.app";
  if (!apiKey || !from) return null;
  return { apiKey, from, appUrl };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildDeliveryConfirmationReviewUrl(
  appUrl: string,
  requestId: string,
): string {
  return `${appUrl}/resident/review/${encodeURIComponent(requestId)}`;
}

export function buildDeliveryConfirmationEmailPayload(
  input: DeliveryConfirmationEmailInput,
  config: DeliveryConfirmationEmailConfig,
) {
  const reviewUrl = buildDeliveryConfirmationReviewUrl(config.appUrl, input.requestId);
  const salutation = input.displayName.trim() ? `Hello ${input.displayName.trim()},` : "Hello,";
  const quantity = `${input.loads} ${input.loads === 1 ? "load" : "loads"} (${input.gallons.toLocaleString("en-US")} gallons)`;
  const location = `${input.village} — ${input.deliveryDirections}`;
  const delivered = formatSabaDateTime(input.deliveredAt);
  const text = [
    salutation,
    "",
    "Your Saba water delivery has been marked delivered.",
    `Quantity: ${quantity}`,
    `Delivery location: ${location}`,
    `Delivery date and time: ${delivered} Saba time`,
    "",
    "Please review the delivery within 24 hours to confirm that you received it or report a problem. If you do not respond within that window, the delivery will be confirmed automatically.",
    "",
    "Review Delivery:",
    reviewUrl,
    "",
    "Saba Water Delivery",
  ].join("\n");
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.5"><p>${escapeHtml(salutation)}</p><p>Your <strong>Saba water delivery</strong> has been marked delivered.</p><ul><li><strong>Quantity:</strong> ${escapeHtml(quantity)}</li><li><strong>Delivery location:</strong> ${escapeHtml(location)}</li><li><strong>Delivery date and time:</strong> ${escapeHtml(delivered)} Saba time</li></ul><p>Please review the delivery within 24 hours to confirm that you received it or report a problem. If you do not respond within that window, the delivery will be confirmed automatically.</p><p><a href="${escapeHtml(reviewUrl)}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Review Delivery</a></p><p>Saba Water Delivery</p></body></html>`;
  return {
    from: config.from,
    to: input.to,
    subject: "Please confirm your water delivery",
    text,
    html,
  };
}
