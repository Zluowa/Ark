// @input: url + filename props
// @output: Download button with idle → done feedback
// @position: Shared download trigger used across all A2UI file widgets

"use client";

import { useEffect, useState } from "react";
import { DownloadIcon, CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { triggerDownload } from "./utils";

type Props = { url: string; filename?: string; className?: string };

export function SaveButton({ url, filename = "download", className }: Props) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 2500);
    return () => clearTimeout(id);
  }, [done]);

  const handleClick = () => {
    if (done) return;
    triggerDownload(url, filename);
    setDone(true);
  };

  return (
    <button onClick={handleClick} className={cn(
      "flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition",
      done ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400 hover:bg-rose-500/25",
      className,
    )}>
      {done ? <><CheckIcon className="size-3" />Saved</> : <><DownloadIcon className="size-3" />Save</>}
    </button>
  );
}
