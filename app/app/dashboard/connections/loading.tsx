// @input: none
// @output: connections route loading UI via Next.js Suspense boundary
// @position: automatic — Next.js shows this during /dashboard/connections page load

import { ConnectionsSkeleton } from "@/components/skeletons/connections-skeleton";
import { Plug } from "lucide-react";

export default function ConnectionsLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10">
          <Plug className="size-5 text-emerald-500" strokeWidth={1.8} />
        </div>
        <div>
          <p className="text-base font-semibold text-foreground">连接账号</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            连接你的账号以解锁更多能力。授权后 Agent 可自动操作这些服务。
          </p>
        </div>
      </div>
      <ConnectionsSkeleton />
    </div>
  );
}
