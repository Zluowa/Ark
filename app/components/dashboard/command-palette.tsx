// @input: Dialog UI, nav routes, keyboard shortcut (Cmd+K / Ctrl+K)
// @output: searchable command palette overlay for fast navigation
// @position: global overlay mounted in dashboard layout

"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Home, MessageSquare, Wrench, Plug, BarChart3,
  Settings, Globe, ArrowRight, Search,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useT, type MessageKey } from "@/lib/i18n";

interface Command {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: typeof Home;
  external?: boolean;
}

const CMD_DEFS: { id: string; labelKey: MessageKey; descKey: MessageKey; href: string; icon: typeof Home; external?: boolean }[] = [
  { id: "home", labelKey: "nav.home", descKey: "cmd.home.desc", href: "/dashboard", icon: Home },
  { id: "agent", labelKey: "nav.agent", descKey: "cmd.agent.desc", href: "/dashboard/agent", icon: MessageSquare },
  { id: "tools", labelKey: "nav.tools", descKey: "cmd.tools.desc", href: "/dashboard/tools", icon: Wrench },
  { id: "connections", labelKey: "nav.connections", descKey: "cmd.connections.desc", href: "/dashboard/connections", icon: Plug },
  { id: "usage", labelKey: "nav.usage", descKey: "cmd.usage.desc", href: "/dashboard/usage", icon: BarChart3 },
  { id: "settings", labelKey: "nav.settings", descKey: "cmd.settings.desc", href: "/dashboard/settings", icon: Settings },
  { id: "docs", labelKey: "cmd.docs", descKey: "cmd.docs.desc", href: "https://docs.omniagent.dev", icon: Globe, external: true },
];

function useCommands(): Command[] {
  const t = useT();
  return CMD_DEFS.map((d) => ({
    id: d.id,
    label: t(d.labelKey),
    description: t(d.descKey),
    href: d.href,
    icon: d.icon,
    external: d.external,
  }));
}

interface CommandItemProps {
  command: Command;
  active: boolean;
  onSelect: (command: Command) => void;
}

function CommandItem({ command, active, onSelect }: CommandItemProps) {
  const Icon = command.icon;
  return (
    <button
      onClick={() => onSelect(command)}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
        active ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50",
      )}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="size-4" strokeWidth={1.8} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{command.label}</p>
        <p className="text-xs text-muted-foreground">{command.description}</p>
      </div>
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/50" />
    </button>
  );
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const t = useT();
  const commands = useCommands();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const filtered = (() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter((c) => c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q));
  })();

  const handleSelect = useCallback((command: Command) => {
    onOpenChange(false);
    setQuery("");
    if (command.external) {
      window.open(command.href, "_blank", "noopener,noreferrer");
    } else {
      router.push(command.href);
    }
  }, [onOpenChange, router]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, filtered.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
      if (e.key === "Enter") { e.preventDefault(); if (filtered[activeIndex]) handleSelect(filtered[activeIndex]); }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, filtered, activeIndex, handleSelect]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="overflow-hidden p-0 max-w-lg top-[30%]">
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <DialogDescription className="sr-only">
          {t("cmd.placeholder")}
        </DialogDescription>
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("cmd.placeholder")}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
          <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">
            ESC
          </kbd>
        </div>
        <div className="max-h-72 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("cmd.noResults", { query })}</p>
          ) : (
            filtered.map((cmd, i) => (
              <CommandItem key={cmd.id} command={cmd} active={i === activeIndex} onSelect={handleSelect} />
            ))
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-border px-4 py-2">
          <span className="text-[11px] text-muted-foreground/60 flex items-center gap-1">
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">↑↓</kbd> {t("cmd.navigate")}
          </span>
          <span className="text-[11px] text-muted-foreground/60 flex items-center gap-1">
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">↵</kbd> {t("cmd.open")}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  return { open, setOpen };
}
