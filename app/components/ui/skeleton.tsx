// @input: className for sizing/layout overrides
// @output: Skeleton, SkeletonLine, SkeletonBlock, SkeletonCircle, SkeletonCard primitives
// @position: base UI layer — composable shimmer skeleton building blocks

import { cn } from "@/lib/utils";

const shimmer =
  "animate-shimmer bg-[linear-gradient(90deg,var(--color-muted)_0%,color-mix(in_oklch,var(--color-muted)_60%,transparent)_50%,var(--color-muted)_100%)] bg-[length:200%_100%]";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("rounded-md", shimmer, className)}
      aria-hidden="true"
      {...props}
    />
  );
}

function SkeletonLine({ className }: { className?: string }) {
  return <Skeleton className={cn("h-4 w-full", className)} />;
}

function SkeletonBlock({ className }: { className?: string }) {
  return <Skeleton className={cn("rounded-xl", className)} />;
}

function SkeletonCircle({ className }: { className?: string }) {
  return <Skeleton className={cn("rounded-full", className)} />;
}

function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn("rounded-xl border border-border bg-card p-4", className)}
      aria-hidden="true"
    >
      <div className="flex items-start gap-3">
        <SkeletonCircle className="size-8 shrink-0" />
        <div className="flex flex-1 flex-col gap-2 pt-0.5">
          <SkeletonLine className="h-3.5 w-2/3" />
          <SkeletonLine className="h-3 w-full" />
          <SkeletonLine className="h-3 w-4/5" />
        </div>
      </div>
    </div>
  );
}

export { Skeleton, SkeletonLine, SkeletonBlock, SkeletonCircle, SkeletonCard };
