import { cn } from "./cn";

/**
 * Shared interaction vocabulary — the small set of class recipes every
 * interactive element should be built from so feedback stays consistent
 * across portals. See DEVIN.md "Interaction feedback" for guidance.
 *
 * Every recipe is pure CSS/Tailwind: immediate pointer-down response,
 * a short 150ms settle, and no transforms at all under
 * `prefers-reduced-motion` (color/border feedback is always preserved).
 */

/**
 * Short, snappy transition for interactive state changes (colors,
 * shadows, transforms). Disabled entirely under reduced motion.
 */
export const interactiveTransitionClasses =
  "transition duration-150 ease-out motion-reduce:transition-none";

/**
 * Tactile press feedback — a subtle scale plus a 1px settle while the
 * element is `:active`. Uses the `scale`/`translate` CSS properties, so
 * it never causes layout shift. Both resets are needed for reduced
 * motion because they are independent properties in Tailwind v4.
 */
export const pressClasses =
  "active:scale-[0.98] active:translate-y-px motion-reduce:active:scale-100 motion-reduce:active:translate-y-0";

/** Shared focus-visible ring (matches the blue-700 accent). */
export const focusVisibleClasses =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";

/**
 * Small bordered action — "Manage", "View Statistics", "Print Run
 * Sheet", "Generate Continuity Report". Works for both links and
 * buttons; `disabled:` styles are inert on links.
 */
export const chipActionClasses = cn(
  "inline-flex select-none items-center justify-center rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700",
  "cursor-pointer",
  interactiveTransitionClasses,
  "hover:bg-slate-50 active:bg-slate-100",
  pressClasses,
  focusVisibleClasses,
  "disabled:cursor-not-allowed disabled:opacity-50",
);

/**
 * Quiet header/nav pill — "Home", "Log out", "Log in". Text color is
 * deliberately not included so callers can pick slate or blue.
 */
export const navPillClasses = cn(
  "select-none rounded-lg px-3 py-2 text-sm font-semibold",
  "cursor-pointer",
  interactiveTransitionClasses,
  "hover:bg-slate-100 active:bg-slate-200",
  pressClasses,
  focusVisibleClasses,
  "disabled:cursor-not-allowed disabled:opacity-50",
);

/**
 * Row inside a picker/result list (resident search, account link).
 * Provides hover/press background and a strong inset focus ring so
 * keyboard selection stays obvious. No scale — transforms on full-width
 * rows read as jank, not tactility.
 */
export const selectableRowClasses = cn(
  "w-full cursor-pointer select-none text-left",
  interactiveTransitionClasses,
  "hover:bg-slate-50 active:bg-slate-100",
  "focus-visible:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600",
);

/**
 * Icon-only button (dialog close, disclosure triggers). Keeps a usable
 * tap target; supply the icon and `aria-label` at the call site.
 */
export const iconButtonClasses = cn(
  "inline-flex h-9 w-9 select-none items-center justify-center rounded-lg text-slate-400",
  "cursor-pointer",
  interactiveTransitionClasses,
  "hover:bg-slate-100 hover:text-slate-600 active:bg-slate-200 active:text-slate-700",
  pressClasses,
  focusVisibleClasses,
  "disabled:cursor-not-allowed disabled:opacity-50",
);

/**
 * Checkbox / radio control — on-brand accent color, pointer cursor, and
 * a consistent 16px box that stays comfortably tappable inside padded
 * label rows.
 */
export const choiceControlClasses =
  "h-4 w-4 shrink-0 cursor-pointer accent-blue-700";

/**
 * Small inline text action ("Use this account", "Undo", "Details") —
 * underline affordance on hover plus a visible focus ring.
 */
export const textActionClasses = cn(
  "cursor-pointer rounded-sm font-medium text-blue-700 underline-offset-2 hover:underline",
  focusVisibleClasses,
);

/**
 * Scoped pending state for a per-row action sharing one `useActionState`
 * (e.g. a table of Retry buttons driven by a single form action).
 *
 * `submittedId` is the row id captured when a form is dispatched. Only
 * that row reports `loading` (spinner + `aria-busy`); siblings are
 * `disabled` so a second action cannot start concurrently, but they must
 * never look busy. When `pending` is false every row returns to normal
 * regardless of `submittedId`.
 */
export function rowPendingState(
  pending: boolean,
  submittedId: string | null,
  rowId: string,
): { loading: boolean; disabled: boolean } {
  const isSubmittedRow = pending && submittedId === rowId;
  return { loading: isSubmittedRow, disabled: pending && !isSubmittedRow };
}
