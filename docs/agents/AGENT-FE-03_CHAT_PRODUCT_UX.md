# AGENT-FE-03: Chat Product UX

## Mission

Upgrade chat from engineering shell to production UX: one-sentence intent, visible run state, and actionable results.

## Scope

1. Connect chat flow to fast-dispatch path for tool-intent prompts.
2. Render clear tool result cards (download links, status, retry actions).
3. Improve run state panel readability for non-technical users.
4. Add failure guidance and recovery CTA (retry/edit params/switch tool).

## Files to Touch

1. `app/app/assistant.tsx`
2. `app/components/assistant-ui/thread.tsx`
3. `app/components/assistant-ui/tool-fallback.tsx`
4. `app/components/assistant-ui/run-status-panel.tsx`
5. `app/lib/api/control-plane.ts`

## Constraints

1. Reuse assistant-ui primitives first.
2. Keep mobile and desktop usable.
3. Preserve existing smoke and contract compatibility.

## Definition of Done

1. User can complete key flow in chat: ask -> execute -> download.
2. Error states show human-readable next action.
3. UX smoke and regression checks pass.

## Verification

```bash
pnpm --dir app lint
pnpm --dir app typecheck
pnpm --dir app build
pnpm --dir app smoke:chat-run
pnpm --dir app smoke:ux
```

## Completion Notes (2026-02-25)

1. Connected chat send flow to `fast-dispatch` preflight for likely tool-intent prompts:
   if matched, execute through `/api/v1/dispatch` and append structured result message;
   if not matched, fall back to existing `/api/chat` stream path.
2. Added dispatch client API in `lib/api/control-plane.ts` for frontend runtime integration.
3. Upgraded tool fallback card UX:
   output download links
   raw result details toggle
   direct CTA to Tools workbench
   failure recovery hints.
4. Improved run status panel readability for non-technical users:
   friendly status labels
   timeline labels
   live-update badge text
   recovery guide with actionable CTA (`Load Last Prompt`, `Open Tools`).
5. Added chat shell hint banner indicating fast-dispatch behavior and fallback semantics.
6. Regression verified with full gate:
   `lint`, `typecheck`, `build`, smoke suites, and all contract suites passed.
