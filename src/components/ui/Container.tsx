import { cn } from "@/lib/utils/cn";

export function Container({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-3xl px-4 sm:px-6", className)}>
      {children}
    </div>
  );
}
