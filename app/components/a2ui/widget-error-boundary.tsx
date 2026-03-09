// @input: Any ToolCallMessagePartComponent children
// @output: Caught render errors shown as graceful fallback inside DarkShell style
// @position: Resilience wrapper — isolates widget crashes from the rest of the UI

"use client";

import { Component, type ReactNode } from "react";
import { AlertTriangleIcon, RefreshCwIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

type Props = { children: ReactNode };
type State = { failed: boolean };

class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  retry = () => this.setState({ failed: false });

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="my-2 mx-auto w-full max-w-md overflow-hidden rounded-xl border border-white/8 bg-zinc-900 shadow-xl">
        <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
          <AlertTriangleIcon className="size-5 text-zinc-500" />
          <p className="text-[12px] text-zinc-400">Widget failed to render</p>
          <button
            onClick={this.retry}
            className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-3 py-1.5 text-[11px] text-zinc-300 transition hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
          >
            <RefreshCwIcon className="size-3" />
            Retry
          </button>
        </div>
      </div>
    );
  }
}

export function withErrorBoundary(
  C: ToolCallMessagePartComponent,
): ToolCallMessagePartComponent {
  const Wrapped: ToolCallMessagePartComponent = (props) => (
    <ErrorBoundary>
      <C {...props} />
    </ErrorBoundary>
  );
  Wrapped.displayName = `WithErrorBoundary(${C.displayName ?? C.name ?? "Widget"})`;
  return Wrapped;
}
