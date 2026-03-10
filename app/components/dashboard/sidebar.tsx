// @input: next/navigation, lucide-react icons, Avatar UI component, Sheet for mobile drawer
// @output: desktop sidebar (hidden on mobile) + SidebarDrawer for mobile overlay
// @position: shared layout shell for all dashboard pages

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  MessageSquare,
  Wrench,
  Settings,
  BarChart3,
  Zap,
  Plug,
  ChevronsUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, type MessageKey } from "@/lib/i18n";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useArkSession } from "@/components/account/session-provider";

const NAV_ITEMS: { href: string; labelKey: MessageKey; icon: typeof Home }[] = [
  { href: "/dashboard", labelKey: "nav.home", icon: Home },
  { href: "/dashboard/agent", labelKey: "nav.agent", icon: MessageSquare },
  { href: "/dashboard/tools", labelKey: "nav.tools", icon: Wrench },
  { href: "/dashboard/connections", labelKey: "nav.connections", icon: Plug },
  { href: "/dashboard/usage", labelKey: "nav.usage", icon: BarChart3 },
  { href: "/dashboard/settings", labelKey: "nav.settings", icon: Settings },
];

function NavItem({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: typeof Home;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.8} />
      {label}
    </Link>
  );
}

function UserFooter() {
  const { session } = useArkSession();
  const initials =
    session?.user.displayName
      ?.split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "AR";

  return (
    <div className="border-t border-border px-3 py-3">
      <Link
        href="/dashboard/settings"
        className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/50"
      >
        <Avatar size="sm">
          <AvatarFallback className="bg-emerald-500/20 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 text-left">
          <p className="truncate text-[12px] font-medium leading-tight text-foreground">
            {session?.user.displayName || "Ark User"}
          </p>
          <p className="truncate text-[11px] leading-tight text-muted-foreground">
            {session?.workspace.name || session?.user.email || "No workspace"}
          </p>
        </div>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground/60 group-hover:text-muted-foreground" />
      </Link>
    </div>
  );
}

function SidebarContent({ onNavClick }: { onNavClick?: () => void }) {
  const pathname = usePathname();
  const t = useT();
  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  return (
    <>
      <div className="flex items-center gap-2.5 px-5 py-4">
        <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-500">
          <Zap className="size-4 text-zinc-950" strokeWidth={2.5} />
        </div>
        <span className="font-semibold tracking-tight text-foreground">Ark</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pt-1" onClick={onNavClick}>
        <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
          {t("nav.section")}
        </p>
        <div className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(({ href, labelKey, icon }) => (
            <NavItem
              key={href}
              href={href}
              label={t(labelKey)}
              icon={icon}
              active={isActive(href)}
            />
          ))}
        </div>
      </nav>

      <UserFooter />
    </>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden h-screen w-52 shrink-0 flex-col border-r border-border bg-background lg:flex">
      <SidebarContent />
    </aside>
  );
}

export function MobileSidebar({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="flex w-52 flex-col p-0">
        <SidebarContent onNavClick={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}
