"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useArkSession } from "@/components/account/session-provider";

export function DashboardAuthGate({ children }: { children: React.ReactNode }) {
  const { authenticated, loading } = useArkSession();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !authenticated) {
      const next = pathname?.startsWith("/dashboard") ? pathname : "/dashboard";
      router.replace(`/auth?next=${encodeURIComponent(next)}`);
    }
  }, [authenticated, loading, pathname, router]);

  if (loading || !authenticated) {
    return (
      <div className="flex h-full min-h-[50vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-border bg-background/80 px-4 py-2 text-sm text-muted-foreground shadow-sm">
          <Loader2 className="size-4 animate-spin" />
          Loading your Ark workspace...
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
