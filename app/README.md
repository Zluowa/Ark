This directory contains the public website and operator dashboard for Ark.

## Local Setup

1. Copy `app/.env.example` to `app/.env.local`
2. Add your own provider keys or compatible gateway values
3. Run `pnpm install`
4. Run `pnpm dev`

The site runs on `http://127.0.0.1:3010`.

## Public Routes

1. `/`
   Public open-source landing page
2. `/open-source`
   Hosted quickstart and self-hosting guide
3. `/dashboard`
   Operator dashboard
4. `/dashboard/agent`
   AI chat workspace
5. `/dashboard/tools`
   Tool workbench

## Required Checks

```bash
pnpm typecheck
pnpm build
```

For the full project-level guide, read the root [README.md](../README.md) and [docs/SELF_HOSTING.md](../docs/SELF_HOSTING.md).
