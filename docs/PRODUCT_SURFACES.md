# Ark Product Surfaces

Ark is one shared capability layer with three product surfaces on top.

## Consumer brand

- Slogan: `一句话就完事。`
- Brand thesis: Ark should not hijack attention. It should return attention to the user and let one sentence trigger real work.

## Surface model

### 1. Dynamic Island

Audience:
- Consumer users

Purpose:
- The smallest useful surface
- Immediate capture, playback, editing, resume, and next-action handoff

Examples:
- Audio Notes
- Screen Record
- Studio image edits
- NetEase playback
- Focus
- File resume

What makes Island different:
- It is not a widget gallery
- It is not a dashboard shell
- It is where workflows continue with the least context switching

### 2. Web workspace

Audience:
- Consumer users
- Operators who need more room than the island provides

Purpose:
- File management
- History
- Connections and configuration
- Tool workbench
- Deeper editing and review

Relationship to Island:
- Web is the larger workspace
- Island is the fast surface
- They share the same backend services and should never drift into separate products

### 3. API

Audience:
- Enterprises
- Agent builders
- Internal automation systems

Purpose:
- Expose the same capability layer programmatically
- Let external agents send concrete work to Ark and receive artifacts back

Core value:
- Save model tokens
- Offload deterministic execution
- Return files and structured outputs instead of chat-only responses

## Shared backend capability layer

The backend is the real center of the product.

It powers:
- Island
- Web
- API

It should own:
- Tool registry
- File upload and artifact delivery
- Sync and async execution
- Job status
- Deterministic conversions, extraction, download, transcription, and processing

## Product rules

1. Island and Web are for humans.
2. API is for enterprises and agents.
3. All three surfaces must describe the same underlying capability layer.
4. Consumer marketing should emphasize attention, speed, and low-friction interaction.
5. Developer marketing should emphasize one key, many tools, deterministic execution, and token savings.

## Current deployment modes

### Open-source mode

Status:
- Available now

Contract:
- Self-hosted
- BYOK
- Operators run the backend and issue deployment API keys for their own environment

### Managed Ark mode

Status:
- Product direction only

Intended contract:
- One Ark-issued tenant key
- Managed execution backend
- Same tool registry and artifact contract, but hosted by Ark

This managed mode is not implemented in the public repo yet and must not be presented as already live.

