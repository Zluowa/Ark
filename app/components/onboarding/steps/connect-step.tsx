// @input: onNext callback
// @output: recommended connection prompt for 小红书
// @position: step 3 of OnboardingModal

"use client";

import { Camera, ArrowRight, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export function ConnectStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold text-foreground">推荐连接</h2>
        <p className="mt-1 text-sm text-muted-foreground">以下服务连接后可立即使用核心功能</p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-4 rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-rose-500/10">
            <Camera className="size-5 text-rose-400" strokeWidth={1.8} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">小红书</p>
            <p className="text-xs text-muted-foreground mt-0.5">下载笔记、视频、图片，扫码即可授权</p>
          </div>
          <Link
            href="/dashboard/connections"
            onClick={onNext}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            连接
            <ChevronRight className="size-3" />
          </Link>
        </div>

        <p className="text-center text-[11px] text-muted-foreground/60">
          或稍后在 Connections 页面连接
        </p>
      </div>

      <div className="mt-auto">
        <Button onClick={onNext} variant="outline" className="w-full gap-2">
          稍后再说
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
