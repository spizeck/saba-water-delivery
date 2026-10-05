"use client";

import { useActionState, useEffect, useRef } from "react";

import { Button } from "@/components/ui/Button";

import {
  acknowledgeWorkflowNotice,
  type WorkflowNoticeActionState,
} from "./actions";

const initialState: WorkflowNoticeActionState = { status: "idle" };

interface Props {
  /**
   * The notice version this render showed the driver — submitted verbatim
   * with the acknowledgement. The server validates it against
   * `CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION`, so a stale page can never
   * record an acknowledgement for a newer notice it did not display, and
   * the write can never downgrade a newer stored acknowledgement.
   */
  noticeVersion: number;
}

/**
 * Versioned driver workflow-change notice (issue #123 follow-up).
 * `/driver/page.tsx` renders this only when the driver's persisted
 * `workflowNoticeAcknowledgedVersion` is behind
 * `CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION` — this component decides HOW
 * the notice looks, not WHETHER it shows.
 *
 * There is deliberately no backdrop click, Escape handling, or close/X
 * control: the only way past the notice is the explicit "Got it" submit,
 * which records the acknowledgement server-side on the Driver Registry
 * entry (so it holds across phones and cleared browser storage).
 *
 * The acknowledgement is education, not an assignment gate — if the
 * server render already auto-assigned a delivery, that assignment stays
 * authoritative underneath this overlay; acknowledging changes nothing
 * about dispatch, availability, or cooldown state.
 */
export function WorkflowNoticeModal({ noticeVersion }: Props) {
  const [state, formAction, pending] = useActionState(
    acknowledgeWorkflowNotice,
    initialState,
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // On mount: remember what had focus (the notice opens automatically,
  // so there is no trigger element) and move focus to "Got it" — what
  // `autoFocus` would do, except autoFocus runs BEFORE effects and would
  // have already overwritten `document.activeElement`. On unmount after
  // a successful acknowledgement, restore focus if that element is still
  // connected so keyboard users don't drop to <body>.
  useEffect(() => {
    const previous = document.activeElement;
    restoreFocusRef.current = previous instanceof HTMLElement ? previous : null;
    dialogRef.current
      ?.querySelector<HTMLElement>("button:not([disabled])")
      ?.focus();
    return () => {
      const el = restoreFocusRef.current;
      if (el?.isConnected) el.focus();
    };
  }, []);

  // While the acknowledgement is saving, the only control ("Got it") is
  // disabled — the browser drops focus to <body>, which is outside this
  // overlay's keydown reach. Park focus on the dialog container itself
  // for the duration so Tab still cannot escape.
  useEffect(() => {
    if (pending) dialogRef.current?.focus();
  }, [pending]);

  // `aria-modal` announces modality but does not trap focus — keep Tab /
  // Shift+Tab cycling inside the dialog so a keyboard user cannot reach
  // the (visually covered) page controls behind the overlay.
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    // Enabled, visible controls only. `input:not([disabled])` would also
    // match the hidden `noticeVersion` field, which can never receive
    // focus — counting it as "first" would break Shift+Tab containment.
    const focusables = dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) {
      // Every control is disabled (e.g. "Got it" while saving) — retain
      // focus on the dialog container instead of letting Tab escape.
      e.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || active === dialog) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || active === dialog) {
      e.preventDefault();
      first.focus();
    }
  }

  // Dismissed only after the acknowledgement has actually persisted — a
  // failed write keeps the modal up with a retryable error, and because
  // the trigger is the server-stored version, the notice simply returns
  // on the next visit anyway.
  if (state.status === "success") return null;

  return (
    <div
      ref={dialogRef}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="driver-workflow-notice-heading"
    >
      <div className="flex w-full max-w-md flex-col gap-4 rounded-xl bg-white p-6 shadow-lg">
        <h2
          id="driver-workflow-notice-heading"
          className="text-lg font-bold text-slate-900"
        >
          Driver workflow has changed
        </h2>

        <div className="flex flex-col gap-3 text-sm text-slate-600">
          <p>
            When you are <strong>Online</strong>, the delivery shown on your
            Driver screen is now <strong>already assigned to you</strong>.
          </p>
          <p>
            You no longer need to press <strong>Accept Delivery</strong>.
          </p>
          <p>
            Closing the app or locking your phone{" "}
            <strong>does not release the delivery</strong>.
          </p>
          <p>
            If you cannot make the delivery, use{" "}
            <strong>Decline / Release Delivery</strong> so it can be assigned to
            another driver.
          </p>
          <p>Only go Online when you are ready to receive a delivery.</p>
        </div>

        {state.status === "error" && (
          <p role="alert" className="text-sm font-medium text-red-700">
            {state.message}
          </p>
        )}

        <form action={formAction}>
          <input type="hidden" name="noticeVersion" value={noticeVersion} />
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? "Saving…" : "Got it"}
          </Button>
        </form>
      </div>
    </div>
  );
}
