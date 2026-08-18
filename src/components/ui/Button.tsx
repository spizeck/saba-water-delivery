import Link from "next/link";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

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

const baseClasses =
  "inline-flex w-full items-center justify-center gap-2 rounded-lg font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed sm:w-auto";

interface CommonProps {
  variant?: Variant;
  size?: Size;
  className?: string;
}

type ButtonProps = CommonProps & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(baseClasses, variantClasses[variant], sizeClasses[size], className)}
      {...props}
    />
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
      className={cn(baseClasses, variantClasses[variant], sizeClasses[size], className)}
    >
      {children}
    </Link>
  );
}
