"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { getLogger } from "@/lib/logging";
import { retryMergeReconciliation } from "@/lib/domain/mergeReconciliation";

const log = getLogger("admin.merge");

export interface RetryMergeReconciliationState {
  status: "idle" | "success" | "error";
  message?: string;
}

/**
 * Admin-only manual retry of an unresolved account-merge Auth reconciliation
 * (issue #73). Server-authoritative: `requireRole("admin")` gates it, and the
 * safe state-machine reset (never reopens the Firestore merge, never retries
 * an already-reconciled record, never touches the survivor uid) lives in the
 * domain layer. The record is requeued and attempted immediately so the
 * operator gets feedback in the same request. Logs the opaque event id only.
 */
export async function retryMergeReconciliationAction(
  _prevState: RetryMergeReconciliationState,
  formData: FormData,
): Promise<RetryMergeReconciliationState> {
  await requireRole("admin");

  const eventId = String(formData.get("eventId") ?? "").trim();
  if (!eventId) {
    return { status: "error", message: "Missing merge event id." };
  }

  const result = await retryMergeReconciliation(eventId);

  switch (result.status) {
    case "not_found":
      log.warn("admin.merge.reconciliation_retry_rejected", {
        eventId,
        reason: "not_found",
      });
      return { status: "error", message: "Merge record not found." };
    case "already_reconciled":
      log.warn("admin.merge.reconciliation_retry_rejected", {
        eventId,
        reason: "already_reconciled",
      });
      return {
        status: "error",
        message:
          "That merge is already fully reconciled; it will not be retried.",
      };
    case "in_progress":
      return {
        status: "error",
        message:
          "Reconciliation is already running for this merge. Wait a moment and refresh.",
      };
    case "attempted": {
      const { outcome } = result;
      log.info("admin.merge.reconciliation_retry_requested", {
        eventId,
        outcome: outcome.status,
        ...("category" in outcome ? { category: outcome.category } : {}),
      });
      revalidatePath("/admin/users/merge");
      if (outcome.status === "reconciled") {
        return {
          status: "success",
          message:
            "Reconciliation succeeded — the merged-away sign-in account is gone.",
        };
      }
      if (outcome.status === "failed" || outcome.status === "invalid_record") {
        return {
          status: "error",
          message: `Retry attempted but failed terminally (${
            outcome.status === "failed" ? outcome.category : "invalid_record"
          }). The merged-away account remains blocked from signing in; investigate the cause before retrying.`,
        };
      }
      if (outcome.status === "retry_scheduled" || outcome.status === "error") {
        return {
          status: "success",
          message:
            "Retry attempted; the failure was transient so the work was requeued for automatic retry. The merged-away account remains blocked from signing in.",
        };
      }
      return {
        status: "success",
        message: "Retry requested; the record is queued for reconciliation.",
      };
    }
  }
}
