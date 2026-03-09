"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6">
      <div className="max-w-md space-y-4 rounded-2xl border bg-card p-6 text-card-foreground shadow-sm">
        <div className="flex items-center gap-3">
          <AlertTriangle className="size-5 text-destructive" />
          <h1 className="font-semibold text-lg">Frontend Runtime Error</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Something went wrong while rendering this page. You can retry the
          segment without reloading the whole app.
        </p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
