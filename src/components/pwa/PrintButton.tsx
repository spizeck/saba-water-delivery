"use client";

import { cn } from "@/lib/utils/cn";
import {
  focusVisibleClasses,
  interactiveTransitionClasses,
  pressClasses,
} from "@/lib/utils/interactive";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={cn(
        "cursor-pointer rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 select-none",
        interactiveTransitionClasses,
        "hover:bg-slate-50 active:bg-slate-100",
        pressClasses,
        focusVisibleClasses,
        "print:hidden",
      )}
    >
      Print
    </button>
  );
}
