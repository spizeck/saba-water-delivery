import Link from "next/link";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";
import {
  focusVisibleClasses,
  interactiveTransitionClasses,
  pressClasses,
} from "@/lib/utils/interactive";

type Variant = "primary" | "secondary" | "outline";
type Size = "md" | "lg";

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-blue-700 text-white hover:bg-blue-800 active:bg-blue-900 disabled:bg-blue-300",
  secondary:
    "bg-slate-100 text-slate-900 hover:bg-slate-200 active:bg-slate-300 disabled:text-slate-400",
  outline:
    "border border-slate-300 text-slate-900 bg-white hover:bg-slate-50 active:bg-slate-100 disabled:text-slate-400",
};

const sizeClasses: Record<Size, string> = {
  md: "h-11 px-5 text-base",
  lg: "h-14 px-6 text-lg",
};

const baseClasses = cn(
  "inline-flex w-full cursor-pointer select-none touch-manipulation items-center justify-center gap-2 rounded-lg font-semibold",
  interactiveTransitionClasses,
  pressClasses,
  focusVisibleClasses,
  "disabled:cursor-not-allowed",
  "sm:w-auto",
);

/**
 * Inline spinner shown while `loading` is set. Deliberately rendered
 * alongside (not instead of) the label so the button keeps its size and
 * the "Verb-ing…" pending text call sites already provide. Spinning is
 * suppressed under reduced motion — the pending label remains the
 * non-motion busy signal.
 */
function Spinner() {
  return (
    <svg
      className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  );
}

interface CommonProps {
  variant?: Variant;
  size?: Size;
  /**
   * Marks the button as busy: shows a spinner, forces `disabled`, and
   * sets `aria-busy`. Pass the `useActionState` `pending` flag — keep
   * the existing "Verb-ing…" label swap for the text-level signal.
   */
  loading?: boolean;
  className?: string;
}

type ButtonProps = CommonProps & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        baseClasses,
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

interface LinkButtonProps extends CommonProps {
  href: string;
  children: React.ReactNode;
}

/** Same visual style as Button, for navigational actions. */
export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
}: LinkButtonProps) {
  return (
    <Link
      href={href}
      className={cn(
        baseClasses,
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
    >
      {children}
    </Link>
  );
}
