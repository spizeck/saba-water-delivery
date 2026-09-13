"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { getLogger } from "@/lib/logging";
import { retryFailedNotification } from "@/lib/notifications/outboxAdmin";

const log = getLogger("admin.notifications");

export interface RetryNotificationState {
  status: "idle" | "success" | "error";
  message?: string;
}

/**
 * Admin-only manual retry of a terminally-failed notification (issue #53).
 * Server-authoritative: `requireRole("admin")` gates it, and the safe
 * state-machine reset (only `failed` → `pending`; never a `sent` resend) lives
 * in the domain layer. Logs an operational event with the opaque id only.
 */
export async function retryNotification(
  _prevState: RetryNotificationState,
  formData: FormData,
): Promise<RetryNotificationState> {
  await requireRole("admin");

  const notificationId = String(formData.get("notificationId") ?? "").trim();
  if (!notificationId) {
    return { status: "error", message: "Missing notification id." };
  }

  const result = await retryFailedNotification(notificationId);
  if (!result.ok) {
    const message =
      result.reason === "already_sent"
        ? "That notification was already sent; it will not be resent."
        : result.reason === "not_found"
          ? "Notification not found."
          : "Only a failed notification can be retried.";
    log.warn("admin.notifications.retry_rejected", {
      notificationId,
      reason: result.reason,
    });
    return { status: "error", message };
  }

  log.info("admin.notifications.retry_requested", { notificationId });
  revalidatePath("/admin/notifications");
  return {
    status: "success",
    message:
      "Notification re-queued; it will be retried on the next worker run.",
  };
}
