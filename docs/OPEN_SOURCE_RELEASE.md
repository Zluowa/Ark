# Open Source Release Checklist

Use this checklist before pushing Ark to a public GitHub repository.

## Repository Hygiene

1. Confirm `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` exist
2. Confirm `.github/ISSUE_TEMPLATE` and `.github/workflows/ci.yml` exist
3. Confirm no real `.env.local` or state files are tracked

## Public Copy Review

1. Review `README.md`
2. Review `app/app/page.tsx`
3. Review `app/app/open-source/page.tsx`
4. Remove any private project names, internal URLs, or real keys

## Runtime Review

1. `pnpm onboard --dry-run --profile full`
1. `pnpm --dir app typecheck`
2. `pnpm --dir app build`
3. `cargo test --manifest-path desktop/Cargo.toml -p omniagent-island -j 1`

## Website Review

1. Verify `/` renders the public landing page
2. Verify `/dashboard` still loads the operator workspace
3. Verify docs links and GitHub link destinations

## Environment Review

1. Review `app/.env.example`
2. Keep placeholders only
3. Document any new variables in `README.md` and `docs/SELF_HOSTING.md`
4. Keep `docs/AGENT_DEPLOYMENT.md` aligned with the actual onboarding command
