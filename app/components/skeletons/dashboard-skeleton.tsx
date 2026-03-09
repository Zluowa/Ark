// @input: none
// @output: full-page dashboard skeleton matching WelcomeHero + StatsRow + QuickActions + RecentActivity + ApiKeyCard layout
// @position: shown during dashboard route load via loading.tsx

import { SkeletonLine, SkeletonBlock, SkeletonCircle } from "@/components/ui/skeleton";

function HeroSkeleton() {
  return (
    <SkeletonBlock className="h-[148px] w-full" />
  );
}

function StatsRowSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-4">
          <SkeletonLine className="h-3 w-1/2" />
          <SkeletonLine className="mt-2 h-6 w-2/3" />
        </div>
      ))}
    </div>
  );
}

function CardSkeleton({ lines = 3, height = "h-40" }: { lines?: number; height?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-card p-5 ${height}`}>
      <SkeletonLine className="h-4 w-1/3" />
      <div className="mt-4 flex flex-col gap-2">
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonLine key={i} className={`h-3 ${i % 2 === 0 ? "w-full" : "w-4/5"}`} />
        ))}
      </div>
    </div>
  );
}

function ActivitySkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <SkeletonLine className="h-4 w-1/4" />
      <div className="mt-4 flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <SkeletonCircle className="size-7 shrink-0" />
            <div className="flex flex-1 flex-col gap-1.5">
              <SkeletonLine className="h-3 w-3/4" />
              <SkeletonLine className="h-2.5 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex flex-col gap-6">
        <HeroSkeleton />
        <StatsRowSkeleton />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 flex flex-col gap-6">
            <CardSkeleton lines={4} height="h-48" />
            <CardSkeleton lines={2} height="h-32" />
          </div>
          <div>
            <ActivitySkeleton />
          </div>
        </div>
      </div>
    </div>
  );
}
