"use client";

import { useState } from "react";
import { Briefcase, Check, Loader2, Plus } from "lucide-react";
import { useArkSession } from "@/components/account/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function WorkspaceSection() {
  const { loading, refresh, session } = useArkSession();
  const [creating, setCreating] = useState(false);
  const [switchingId, setSwitchingId] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage("Enter a workspace name first.");
      return;
    }
    setCreating(true);
    setMessage("");
    try {
      const response = await fetch("/api/account/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: { message?: string } };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message || "Failed to create workspace.");
      }
      setName("");
      setMessage("Workspace created.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create workspace.");
    } finally {
      setCreating(false);
    }
  };

  const handleSwitch = async (workspaceId: string) => {
    setSwitchingId(workspaceId);
    setMessage("");
    try {
      const response = await fetch(`/api/account/workspaces/${workspaceId}/switch`, {
        method: "POST",
      });
      const payload = (await response.json()) as { ok?: boolean; error?: { message?: string } };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message || "Failed to switch workspace.");
      }
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to switch workspace.");
    } finally {
      setSwitchingId("");
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <Briefcase className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Workspace</h2>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Your browser session is scoped to one active workspace, and that workspace maps
        to Ark&apos;s tenant execution layer.
      </p>

      <div className="space-y-3">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading workspace...</div>
        ) : (
          session?.workspaces.map((workspace) => (
            <div
              key={workspace.id}
              className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-foreground">
                    {workspace.name}
                  </p>
                  {workspace.isActive ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[11px] text-emerald-600">
                      <Check className="size-3" />
                      Active
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  tenant:{workspace.tenantId} · {workspace.role}
                </p>
              </div>
              <Button
                variant={workspace.isActive ? "secondary" : "outline"}
                size="sm"
                disabled={workspace.isActive || switchingId === workspace.id}
                onClick={() => void handleSwitch(workspace.id)}
              >
                {switchingId === workspace.id ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Switching
                  </>
                ) : workspace.isActive ? (
                  "Current"
                ) : (
                  "Switch"
                )}
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="mt-4 flex flex-col gap-2 rounded-lg border border-dashed border-border p-3">
        <label className="text-xs font-medium text-muted-foreground">
          Create another workspace
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Marketing, Personal, Client Alpha..."
            disabled={creating}
          />
          <Button disabled={creating} onClick={() => void handleCreate()}>
            {creating ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Creating
              </>
            ) : (
              <>
                <Plus className="size-4" />
                Add workspace
              </>
            )}
          </Button>
        </div>
        {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
      </div>
    </section>
  );
}
