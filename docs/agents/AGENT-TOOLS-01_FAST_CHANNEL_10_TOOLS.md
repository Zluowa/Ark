# AGENT-TOOLS-01: Fast Channel 10 Tools

## Mission

Deliver first batch of built-in tools and standardize tool package structure.

## Scope

1. Create 10 tool packages (PDF/Image/Video priority).
2. Each tool must include:
- `manifest.json`
- `executor` implementation
- `ui-config.json`
- `tests/test_cases.json`
3. Expose list/read API for tools:
- `GET /v1/tools` (or local equivalent route)
- `GET /v1/tools/{tool_id}`
4. Ensure tools can be called from fast channel router.

## Suggested First 10

1. `pdf.compress`
2. `pdf.merge`
3. `pdf.split`
4. `image.compress`
5. `image.convert`
6. `image.crop`
7. `video.transcode`
8. `video.extract_audio`
9. `video.clip`
10. `utility.json_format`

## Files to Touch

1. `app/tools/` (new tool package root)
2. `app/app/api/tools/` (new list/read routes)
3. `app/lib/server/` (tool loader/router)
4. `app/components/` (tool cards only when needed)

## Constraints

1. Prioritize reusable OSS libraries; no from-scratch parser/codec work.
2. Keep tool metadata schema aligned with PRD tool package section.
3. Any heavy runtime dependency must be justified in PR notes.

## Definition of Done

1. 10 tools visible via tools API.
2. At least 1 end-to-end invocation from chat route through fast channel.
3. Each tool has test cases for success and common failures.

## Verification

```bash
pnpm --dir app lint
pnpm --dir app typecheck
pnpm --dir app build
pnpm --dir app smoke:chat-run
```

