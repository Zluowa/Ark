# Ark API Platform

Ark's API is the execution layer for enterprises and agents.

## Positioning

Primary message:
- Once integrated, you get the whole Ark tool catalog through one deployment key.

What Ark does:
- Receives concrete work from an upstream agent or system
- Executes deterministic tasks
- Returns artifacts, structured outputs, and async job state
- Already includes one-step local video subtitle generation for uploaded video files
- Already includes remote-link subtitle extraction for Bilibili, YouTube, Douyin, and direct downloadable video URLs

What Ark does not do:
- Replace the upstream agent's reasoning loop
- Force every task through a large language model
- Pretend chat output is a sufficient delivery format for tool work

## Why agent teams use Ark

1. Save tokens
   Ark handles download, conversion, extraction, compression, transcription, and file materialization so the upstream agent does not waste model context on tool execution.
2. Gain breadth fast
   The same key can reach the whole current Ark catalog instead of rebuilding dozens of utilities in each agent product.
3. Get artifacts back
   Ark is optimized around files and structured outputs, not just plain text.
4. Keep product logic clean
   Agents reason about intent. Ark executes the work.

## Current public contract

### Authentication

Headers accepted:
- `X-API-Key: <key>`
- `Authorization: Bearer <key>`

Model:
- One API key per deployment or tenant

Important note:
- In open-source mode, the operator issues and controls these keys.
- Self-hosted operators can now list, create, and revoke local deployment keys through the admin API without restarting the server.
- Self-hosted operators can also create tenants with default quota policy and receive a tenant bootstrap key at creation time.
- Tenant bootstrap keys are tenant-scoped operators, not platform admins:
  - they can list only their own keys
  - they can mint only tenant-scoped runtime keys
  - they cannot list tenants
  - they cannot mint `admin:*` or `tenants:*` scopes
- The repo now also ships a local `managed_ark_key` mode:
  - platform operators can issue a tenant-facing Ark key through `POST /api/v1/admin/managed-tenants`
  - platform operators can list managed tenants through `GET /api/v1/admin/managed-tenants`
  - platform operators can inspect one managed tenant, its keys, and recent usage through `GET /api/v1/admin/managed-tenants/{tenantId}`
  - platform operators can update tenant quota or suspend access through `PATCH /api/v1/admin/managed-tenants/{tenantId}`
  - platform operators can mint or rotate a tenant-facing Ark key through `POST /api/v1/admin/managed-tenants/{tenantId}/keys`
  - platform operators can revoke a tenant-facing Ark key through `DELETE /api/v1/admin/managed-tenants/{tenantId}/keys/{keyId}`
  - that tenant-facing key can immediately run sync and async executions
  - provider keys still stay on the server side
  - this is a deploy-it-yourself managed mode, not the future hosted SaaS control plane

### Discovery

Public endpoints:
- `GET /api/v1/platform`
- `GET /api/v1/tools/registry`

Use them to:
- inspect the platform contract
- discover tools
- inspect categories and output types

### Execution

Authenticated endpoints:
- `POST /api/v1/files`
- `POST /api/v1/execute`
- `POST /api/v1/execute/async`
- `GET /api/v1/jobs/{jobId}`
- `GET /api/v1/admin/api-keys`
- `POST /api/v1/admin/api-keys`
- `DELETE /api/v1/admin/api-keys/{keyId}`
- `GET /api/v1/admin/tenants`
- `POST /api/v1/admin/tenants`
- `GET /api/v1/admin/tenants/{tenantId}`
- `PATCH /api/v1/admin/tenants/{tenantId}`
- `POST /api/v1/admin/managed-tenants`
- `GET /api/v1/admin/managed-tenants`
- `GET /api/v1/admin/managed-tenants/{tenantId}`
- `PATCH /api/v1/admin/managed-tenants/{tenantId}`
- `POST /api/v1/admin/managed-tenants/{tenantId}/keys`
- `DELETE /api/v1/admin/managed-tenants/{tenantId}/keys/{keyId}`

Execution model:
- sync when the result is quick and should return inline
- async when the job is long-running or artifact-heavy

### Self-hosted operator hierarchy

Platform operator:
- bootstrap deployment key issued from env or local control plane
- can manage deployment keys
- can provision and suspend tenants

Tenant operator:
- tenant bootstrap key returned by `POST /api/v1/admin/tenants`
- can manage runtime keys only inside its own tenant
- inherits tenant default quota when a runtime key does not override quota

Runtime key:
- normal agent-facing execution key
- intended for uploads, sync execution, async jobs, and billing reads
- immediately loses access if revoked or if the tenant is suspended

### Artifacts

Ark should be treated as artifact-first infrastructure.

Common artifact types:
- `txt`
- `md`
- `json`
- `pdf`
- `docx`
- `srt`
- `vtt`
- `mp3`
- `mp4`
- `gif`
- `png`
- `zip`

## Recommended product framing

For enterprise/API pages:
- Title: `One API key. The Ark execution layer.`
- Supporting claim: `Deterministic execution, async jobs, and artifact delivery without wasting model tokens.`

For sales and ecosystem copy:
- Emphasize breadth, speed, and cost discipline
- Do not imply that every capability is already at 100+ live tools today
- Do not imply that the managed Ark key is already live if the repo still runs in self-hosted BYOK mode

## Integration layers

### Live today

- REST API
- TypeScript SDK
- Python SDK
- MCP server
- local operator key-management API for self-hosted deployments
- local tenant provisioning API for self-hosted deployments

### Planned

- skill packs built on top of the same execution API

The API remains the product core. SDK, MCP, and skills are adapters.

## Example execution chain

Example:
- upstream agent receives: "turn this PDF into a smaller DOCX and summarize it"
- agent uploads the file to Ark
- agent calls the relevant conversion tool
- Ark returns artifacts and job state
- agent continues user-facing reasoning on top of Ark outputs

Another current example:
- upstream agent uploads a local `mp4`
- agent calls `video.transcribe_subtitle`
- Ark extracts audio, runs ASR, and returns:
  - `transcript`
  - `txt`
  - `srt`
  - `vtt`
  - downloadable subtitle bundle artifact

Another current example:
- upstream agent sends a Bilibili, YouTube, Douyin, or direct downloadable video URL
- agent calls `media.extract_subtitle`
- Ark tries platform subtitles first, falls back to ASR when needed, and returns:
  - `txt`
  - `srt`
  - `vtt`
  - `subtitle_source`
  - downloadable subtitle bundle artifact

Self-hosted networking note:
- Ark works best when the host can reach the target media platform directly
- if the host needs a proxy for YouTube, set `MEDIA_PROXY` or `HTTPS_PROXY`
- if the host needs Xiaohongshu extraction, configure:
  - a tenant XHS connection
  - or `OMNIAGENT_XHS_COOKIE`
  - and optionally `OMNIAGENT_XHS_BRIDGE_URL` when the XHS bridge is not on `http://127.0.0.1:5556`
- the local helper scripts now auto-detect the Windows system proxy when possible, but explicit env is still the portable contract

This separation is the central architectural rule:
- agents think
- Ark executes
