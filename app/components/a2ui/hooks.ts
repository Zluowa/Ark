// @input: Reusable patterns across A2UI widgets
// @output: useCopyFeedback hook
// @position: Shared hooks for all A2UI widget components

import { useCallback, useEffect, useRef, useState } from "react";

/** Copy text to clipboard with visual feedback. Replaces 9 duplicate copy patterns. */
export function useCopyFeedback(timeout = 1500) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), timeout);
    });
  }, [timeout]);

  return { copied, copy };
}
