"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyCommandButton({
  command,
  className = "",
}: {
  command: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy command"}
      onClick={handleCopy}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-white/6 text-white/72 transition hover:border-white/20 hover:bg-white/10 hover:text-white ${className}`}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </button>
  );
}
