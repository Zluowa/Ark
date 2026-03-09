// @input: none
// @output: stack/workbench loading shell
// @position: shown during /dashboard/tools route load via loading.tsx

import { SkeletonLine, SkeletonBlock } from "@/components/ui/skeleton";

export function ToolsSkeleton() {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1480px] flex-col gap-4 px-4 py-4 md:px-6 md:py-5">
      <div className="rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(5,8,12,0.98),rgba(7,11,16,0.97))] px-5 py-5">
        <SkeletonLine className="h-3 w-24" />
        <SkeletonLine className="mt-4 h-8 w-72" />
        <SkeletonLine className="mt-3 h-4 w-96 max-w-full" />
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(5,8,12,0.96))] p-4">
          <SkeletonLine className="h-3 w-20" />
          <SkeletonBlock className="mt-4 h-11 w-full rounded-2xl" />
          <div className="mt-4 space-y-2">
            {Array.from({ length: 7 }).map((_, index) => (
              <div
                key={`stack-tool-skeleton-${index}`}
                className="rounded-[22px] border border-white/8 px-3 py-3"
              >
                <SkeletonLine className="h-3 w-28" />
                <SkeletonLine className="mt-2 h-4 w-36" />
                <SkeletonLine className="mt-2 h-3 w-full" />
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(5,8,12,0.96))] p-5">
            <SkeletonLine className="h-3 w-32" />
            <SkeletonLine className="mt-3 h-8 w-64" />
            <SkeletonLine className="mt-3 h-4 w-full" />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(5,8,12,0.96))] p-5">
              <SkeletonLine className="h-4 w-24" />
              <SkeletonBlock className="mt-4 h-11 w-full rounded-2xl" />
              <SkeletonBlock className="mt-3 h-11 w-full rounded-2xl" />
              <SkeletonBlock className="mt-3 h-11 w-full rounded-2xl" />
            </div>
            <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(5,8,12,0.96))] p-5">
              <SkeletonLine className="h-4 w-24" />
              <SkeletonBlock className="mt-4 h-44 w-full rounded-[22px]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
