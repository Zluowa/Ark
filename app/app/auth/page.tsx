"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowRight, Loader2, Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Mode = "login" | "register";

export default function AuthPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";
  const [mode, setMode] = useState<Mode>("login");
  const [booting, setBooting] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    displayName: "",
    email: "",
    password: "",
    workspaceName: "",
  });

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const response = await fetch("/api/account/session", {
          cache: "no-store",
          credentials: "same-origin",
        });
        const payload = (await response.json()) as { authenticated?: boolean };
        if (!cancelled && payload.authenticated) {
          router.replace(next);
          return;
        }
      } catch {}
      if (!cancelled) {
        setBooting(false);
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [next, router]);

  const submitLabel = useMemo(
    () => (mode === "login" ? "Sign in" : "Create account"),
    [mode],
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      const endpoint = mode === "login" ? "/api/account/login" : "/api/account/register";
      const body =
        mode === "login"
          ? { email: form.email, password: form.password }
          : {
              displayName: form.displayName,
              email: form.email,
              password: form.password,
              workspaceName: form.workspaceName,
            };
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: { message?: string } };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message || "Authentication failed.");
      }
      router.replace(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.12),_transparent_38%),linear-gradient(180deg,#08080b,#0f172a)] text-white">
        <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/78 backdrop-blur">
          <Loader2 className="size-4 animate-spin" />
          Checking your Ark session...
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.14),_transparent_40%),linear-gradient(180deg,#06070a,#0b1220)] text-white">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10 lg:flex-row lg:items-center lg:justify-between lg:px-10">
        <section className="max-w-xl pb-10 lg:pb-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.24em] text-white/70 backdrop-blur">
            <Sparkles className="size-3.5 text-emerald-300" />
            Ark Account
          </div>
          <h1 className="mt-5 max-w-lg text-5xl font-medium tracking-tight text-white">
            一句话就完事。
          </h1>
          <p className="mt-4 max-w-lg text-lg leading-8 text-white/70">
            Ark 不抢你的注意力。先登录你的账户，再把工作区、连接和执行结果都收进同一个
            browser session 里。
          </p>
          <div className="mt-8 grid gap-3 text-sm text-white/72 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <p className="font-medium text-white">Workspace-scoped</p>
              <p className="mt-2 text-white/62">
                每个登录用户都有自己的工作区，连接和执行上下文会跟着工作区切换。
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <p className="font-medium text-white">Agent-ready</p>
              <p className="mt-2 text-white/62">
                Web 给人，API 给 agent，后端只维护一套真正的执行能力层。
              </p>
            </div>
          </div>
          <p className="mt-8 text-sm text-white/48">
            Need the API instead? Visit{" "}
            <Link href="/developers" className="text-emerald-300 hover:text-emerald-200">
              /developers
            </Link>
            .
          </p>
        </section>

        <section className="w-full max-w-md rounded-[28px] border border-white/10 bg-white/6 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl">
          <div className="mb-5 flex gap-2 rounded-full border border-white/10 bg-black/20 p-1">
            {(["login", "register"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={`flex-1 rounded-full px-4 py-2 text-sm transition-colors ${
                  mode === value
                    ? "bg-emerald-400 text-zinc-950"
                    : "text-white/70 hover:bg-white/8"
                }`}
              >
                {value === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            {mode === "register" ? (
              <>
                <label className="block space-y-2">
                  <span className="text-sm text-white/78">Display name</span>
                  <Input
                    value={form.displayName}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, displayName: event.target.value }))
                    }
                    placeholder="Ava Chen"
                    className="h-11 border-white/12 bg-black/20 text-white placeholder:text-white/30"
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-sm text-white/78">First workspace</span>
                  <Input
                    value={form.workspaceName}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, workspaceName: event.target.value }))
                    }
                    placeholder="Personal"
                    className="h-11 border-white/12 bg-black/20 text-white placeholder:text-white/30"
                  />
                </label>
              </>
            ) : null}

            <label className="block space-y-2">
              <span className="text-sm text-white/78">Email</span>
              <Input
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, email: event.target.value }))
                }
                placeholder="you@company.com"
                className="h-11 border-white/12 bg-black/20 text-white placeholder:text-white/30"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm text-white/78">Password</span>
              <Input
                type="password"
                value={form.password}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, password: event.target.value }))
                }
                placeholder="At least 8 characters"
                className="h-11 border-white/12 bg-black/20 text-white placeholder:text-white/30"
              />
            </label>

            {message ? (
              <p className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
                {message}
              </p>
            ) : null}

            <Button
              type="submit"
              className="h-11 w-full rounded-full bg-emerald-400 text-zinc-950 hover:bg-emerald-300"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Working...
                </>
              ) : (
                <>
                  {submitLabel}
                  <ArrowRight className="size-4" />
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/62">
            <Lock className="size-4 text-emerald-300" />
            Passwords are hashed. Sessions stay browser-local and workspace-scoped.
          </div>
        </section>
      </div>
    </main>
  );
}
