// @input: children pages, Sidebar/MobileSidebar, CommandPalette, Breadcrumb, OnboardingModal
// @output: sidebar shell + header (hamburger on mobile, breadcrumb, search/Cmd+K, theme toggle) + onboarding overlay
// @position: root layout for all dashboard routes

"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Search, Menu } from "lucide-react";
import { SessionProvider } from "@/components/account/session-provider";
import { DashboardAuthGate } from "@/components/account/dashboard-auth-gate";
import { Sidebar, MobileSidebar } from "@/components/dashboard/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { LangToggle } from "@/components/lang-toggle";
import { useT, type MessageKey } from "@/lib/i18n";
import { OnboardingModal } from "@/components/onboarding/onboarding-modal";
import {
  CommandPalette,
  useCommandPalette,
} from "@/components/dashboard/command-palette";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

const PAGE_KEYS: Record<string, MessageKey> = {
  "/dashboard": "page.home",
  "/dashboard/agent": "page.agent",
  "/dashboard/tools": "page.tools",
  "/dashboard/connections": "page.connections",
  "/dashboard/settings": "page.settings",
  "/dashboard/usage": "page.usage",
};

function DashboardBreadcrumb({ pathname }: { pathname: string }) {
  const t = useT();
  const key =
    PAGE_KEYS[pathname] ??
    (pathname.startsWith("/dashboard/tools/") ? ("page.tools" as const) : undefined);
  const label = key ? t(key) : t("breadcrumb.page");

  if (pathname === "/dashboard") {
    return <span className="text-sm font-medium text-foreground">{t("page.home")}</span>;
  }
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/dashboard" className="text-xs">
            {t("breadcrumb.dashboard")}
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage className="text-xs font-medium">{label}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { open, setOpen } = useCommandPalette();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const t = useT();
  const isAgent = pathname === "/dashboard/agent";

  return (
    <SessionProvider>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <Sidebar />
        <MobileSidebar open={mobileNavOpen} onOpenChange={setMobileNavOpen} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4 lg:px-6">
            <div className="flex items-center gap-3">
              <button
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground lg:hidden"
                onClick={() => setMobileNavOpen(true)}
                aria-label={t("layout.openNav")}
              >
                <Menu className="size-4" />
              </button>
              <DashboardBreadcrumb pathname={pathname} />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setOpen(true)}
                className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Search className="size-3.5" />
                <span className="hidden sm:inline">{t("layout.search")}</span>
                <kbd className="hidden rounded border border-border bg-background px-1 py-0.5 text-[10px] sm:block">
                  Cmd+K
                </kbd>
              </button>
              <LangToggle />
              <ThemeToggle />
            </div>
          </header>
          <main className={isAgent ? "flex-1 overflow-hidden" : "flex-1 overflow-y-auto"}>
            <DashboardAuthGate>{children}</DashboardAuthGate>
          </main>
        </div>
        <OnboardingModal />
        <CommandPalette open={open} onOpenChange={setOpen} />
      </div>
    </SessionProvider>
  );
}
