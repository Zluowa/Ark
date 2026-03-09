// @input: none
// @output: connections page skeleton — header icon + filter tabs + 3-column connection card grid
// @position: shown during /dashboard/connections route load, and as initial state in ConnectionGrid

import { SkeletonLine, SkeletonBlock, SkeletonCircle } from "@/components/ui/skeleton";

function FilterTabsSkeleton() {
  return (
    <div className="flex gap-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <SkeletonBlock key={i} className="h-7 w-20 rounded-full" />
      ))}
    </div>
  );
}

function ConnectionCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <SkeletonCircle className="size-9 shrink-0" />
        <div className="flex flex-1 flex-col gap-1.5">
          <SkeletonLine className="h-3.5 w-1/2" />
          <SkeletonLine className="h-3 w-full" />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <SkeletonBlock className="h-5 w-16 rounded-full" />
        <SkeletonBlock className="h-7 w-20 rounded-lg" />
      </div>
    </div>
  );
}

export function ConnectionsSkeleton({ count = 9 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-5">
      <FilterTabsSkeleton />
      <div className="flex flex-col gap-3">
        <SkeletonLine className="h-3 w-24" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: count }).map((_, i) => (
            <ConnectionCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
