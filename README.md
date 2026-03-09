<p align="center">
  <strong>Ark</strong>
</p>

<p align="center">
  <a href="#quickstart"><strong>Quickstart</strong></a>
  &middot;
  <a href="docs/SELF_HOSTING.md"><strong>Docs</strong></a>
  &middot;
  <a href="https://github.com/Zluowa/Ark"><strong>GitHub</strong></a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
  <a href="https://github.com/Zluowa/Ark/stargazers"><img src="https://img.shields.io/github/stars/Zluowa/Ark?style=flat" alt="Stars" /></a>
  <a href="https://github.com/Zluowa/Ark/actions/workflows/ci.yml"><img src="https://github.com/Zluowa/Ark/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/platform-Windows-111111" alt="Windows" />
</p>

<br/>

## What is Ark?

# Open-source orchestration for island-native workflows

**If a dashboard is a _workspace_, Ark is the _surface_.**

Ark is a self-hosted stack that turns the Dynamic Island into a real execution surface for capture, files, editing, music, focus, and AI handoff. The repo combines a Rust-native Windows island runtime, a Next.js public site and dashboard, and optional local infra for state and artifacts.

**Manage workflows, not windows.**

|        | Step                   | Example                                                                 |
| ------ | ---------------------- | ----------------------------------------------------------------------- |
| **01** | Capture the signal     | Record audio, start screen capture, drop a file, open Studio, or resume |
| **02** | Transform it in place  | Convert to text, edit images, reopen files, route into tools            |
| **03** | Handoff with context   | Continue in AI, download artifacts, or reopen the right surface         |

<br/>

## Ark is right for you if

- You want the Dynamic Island to be a real workflow surface, not just a status ornament
- You capture audio, screen, files, or image edits and want the next action to happen from the same surface
- You need a local-first stack with BYOK providers instead of a hosted black box
- You want a public repo you can fork, self-host, and extend without an internal cleanup sprint first
- You want one system that connects the island, dashboard, tools, and file handoff instead of isolated widgets

<br/>

## Features

| | |
| --- | --- |
| **Audio Notes** | Record, convert to text, then continue the transcript through normal AI input instead of a dead export flow. |
| **Screen Record** | Use countdown, recording, saving, and summary as island-native states instead of detached recorder windows. |
| **Studio** | Background removal, watermark cleanup, and image edits stay on the island and reopen into the correct surface. |
| **Files** | Recent artifacts are resumable. The stack reopens the right file workflow instead of dropping you into a dashboard maze. |
| **NetEase** | Search, playback, and account connection live inside the same stack as the rest of the island capabilities. |
| **Focus** | Pomodoro is a calm island state with next actions and AI handoff, not a separate productivity mini-app. |
| **File-first AI handoff** | Reports, transcripts, captures, and edits materialize as files first, then continue through AI with explicit user intent. |
| **Self-hosted stack** | The public site, dashboard, native island, and optional local infra all ship in one reproducible repo. |
| **BYOK providers** | No project account is required. Use your own models, gateways, storage, and speech or video services. |

<br/>

## Problems Ark solves

| Without Ark | With Ark |
| --- | --- |
| You keep bouncing between recorder windows, dashboards, and tool pages just to finish one small task. | Ark keeps the flow on the island so the next useful action is always one surface away. |
| Audio, screenshots, and edits turn into dead files that still need manual cleanup, naming, and follow-up. | Captures and edits flow directly into files, transcripts, markdown reports, and AI handoff. |
| Your desktop assistant looks polished, but the real work still happens somewhere else. | The island itself becomes the execution surface for recording, editing, playback, focus, and file resumption. |
| Open-source release work turns into an internal cleanup project because docs, envs, and links are not public-safe. | Ark ships with BYOK env examples, GitHub community files, self-hosting docs, and a public landing page out of the box. |

<br/>

## Why Ark is special

| | |
| --- | --- |
| **Surface-native orchestration** | Ark models the island as the product surface, not as a notification shell attached to a dashboard later. |
| **File-first state transitions** | Reports, transcripts, captures, and edits become explicit artifacts that can be reopened, downloaded, or sent back into AI. |
| **Resumable local state** | The stack can reopen music, files, studio, focus, and recent results with the right priority instead of guessing from stale state. |
| **Provider portability** | OpenAI-compatible chat, Gemini video analysis, Volcengine ASR, and local infra stay configurable without changing the public contract. |
| **Native + web in one repo** | Rust island runtime, Next.js dashboard, self-hosting docs, and optional infra are versioned together as one product. |
| **Public-safe release posture** | The repo is meant to be pushed as-is: license, templates, CI, docs, source links, and no bundled project secrets. |

<br/>

## What Ark is not

| | |
| --- | --- |
| **Not a generic widget gallery.** | The goal is not to showcase mini-components. The goal is to make the island itself the place where workflows continue. |
| **Not a hosted-only SaaS shell.** | Ark is designed to be forked, self-hosted, and BYOK. Public copy cannot rely on private infra to make sense. |
| **Not dashboard-first.** | The dashboard exists, but the product story starts from the island and radiates outward into files, tools, and docs. |
| **Not a single narrow tool.** | Capture, editing, playback, files, focus, and AI handoff all belong to the same surface system. |

<br/>

## Quickstart

Open source. Self-hosted. No Ark account required.

```bash
git clone https://github.com/Zluowa/Ark.git
cd Ark
pnpm --dir app install
cp app/.env.example app/.env.local
docker compose -f infra/docker-compose.yml up -d
pnpm --dir app dev
cargo run --manifest-path desktop/Cargo.toml -p omniagent-island
```

Typical BYOK providers:

1. Chat and image generation: `OPENAI_API_KEY` or your own compatible gateway
2. Screen analysis: `GEMINI_API_KEY` or `GOOGLE_API_KEY`
3. Audio transcription: `VOLCENGINE_APPID` plus `VOLCENGINE_ACCESS_TOKEN`
4. Search: `TAVILY_API_KEY`

Detailed setup lives in [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

<br/>

## FAQ

**What does a typical Ark setup look like?**  
The public site and dashboard run from Next.js, the island runtime runs locally on Windows, and optional Compose services add durable state and artifacts.

**Do I need Ark-hosted accounts or project keys?**  
No. The repo is BYOK. You bring your own model, speech, video, or storage providers and keep secrets in your own environment.

**Can I use just the website or just the island?**  
Yes. The architecture is modular. You can run the website alone, the website plus local infra, or the full site-plus-native-island stack.

**Why not just open a dashboard or a recorder app?**  
Because Ark is optimized around fewer jumps. The point is to keep capture, AI, files, and resume actions on the smallest useful surface.

<br/>

## Development

```bash
pnpm --dir app typecheck
pnpm --dir app build
cargo test --manifest-path desktop/Cargo.toml -p omniagent-island -j 1
node scripts/check-task-delivery.mjs
node scripts/check-task-delivery.mjs --require-ui
```

<br/>

## Roadmap

- Unify more native island surfaces under one visual language
- Continue reducing dashboard-first flows in favor of file-first and island-first handoff
- Harden provider portability and self-hosting defaults
- Improve public documentation and onboarding for forks

<br/>

## Contributing

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md).

<br/>

## Community

- GitHub Issues: https://github.com/Zluowa/Ark/issues
- GitHub Discussions: https://github.com/Zluowa/Ark/discussions
- Security policy: [SECURITY.md](SECURITY.md)

<br/>

## License

MIT
