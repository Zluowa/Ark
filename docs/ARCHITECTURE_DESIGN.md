# OmniAgent Architecture: Tools & Connections Separation

> Date: 2026-02-28
> Status: Design Draft
> Author: MOSS Architect

---

## 0. Design Thesis

OmniAgent has two fundamentally different capability types pretending to be one:

```
Tool  = stateless function(input) -> output       (no user identity needed)
Connection = stateful channel(user, service) -> proxy  (OAuth identity required)
```

Mixing them produces a type system that lies: a "tool" that requires OAuth is not a tool,
it is a connection action wearing a tool's costume. This document separates them cleanly.

---

## 1. Architecture Overview

```
                          +---------------------------+
                          |      API Gateway          |
                          |   (Next.js API Routes)    |
                          +--+----------+----------+--+
                             |          |          |
                    +--------+   +------+------+   +----------+
                    |            |             |               |
              /v1/tools    /v1/execute   /v1/connections  /v1/connections
              /v1/dispatch               /v1/connections    /:id/actions
                    |            |       /oauth/callback      |
                    |            |             |               |
              +-----+----+ +----+-----+ +-----+------+ +------+------+
              |ToolCatalog| |ToolRunner| |ConnManager | |ActionRunner |
              +-----+----+ +----+-----+ +-----+------+ +------+------+
                    |            |             |               |
              +-----+----+ +----+-----+ +-----+------+ +------+------+
              |  tools/   | | Executor | | TokenVault | | SaaS SDKs  |
              | manifests | | (FastAPI)| | (encrypted)| | / Maton    |
              +----------+ +----------+ +------------+ +------------+
```

---

## 2. Data Model Design

### 2.1 Current ToolManifest (lib/server/tool-catalog.ts) -- No Changes Needed

The existing `ToolManifest` is already correct for pure tools. No modification required.

```typescript
// Unchanged. This is already clean.
type ToolManifest = {
  id: string;            // "official.pdf.compress"
  name: string;
  version: string;
  author?: string;
  description: string;
  io?: {
    inputs?: ToolInput[];
    outputs?: ToolOutput[];
  };
  runtime?: {
    language?: string;
    dependencies?: string[];
    timeout?: number;
    memory?: string;
  };
  tags?: string[];
  stats?: ToolStats;
  claude_skill_compatible?: boolean;
};
```

**What changes**: add one field to explicitly declare "this is a pure tool, no connection needed":

```typescript
// Added field
type ToolManifest = {
  // ... existing fields ...
  requires_connection?: never;  // Pure tools never reference a connection
};
```

### 2.2 Connection (New)

```typescript
type ConnectionProvider =
  | "feishu"
  | "dingtalk"
  | "wecom"
  | "gmail"
  | "slack"
  | "notion"
  | "google_drive"
  | "dropbox"
  | "github"
  | "linear";

type ConnectionRegion = "cn" | "intl";

type ConnectionStatus =
  | "pending"       // OAuth flow initiated, not completed
  | "active"        // Token valid, ready to use
  | "expired"       // Token expired, needs refresh
  | "revoked"       // User explicitly revoked
  | "error";        // Persistent auth failure

type Connection = {
  id: string;                    // uuid
  tenant_id: string;             // owner tenant
  provider: ConnectionProvider;
  region: ConnectionRegion;
  status: ConnectionStatus;
  display_name: string;          // user-facing label, e.g. "My Work Feishu"
  scopes: string[];              // granted OAuth scopes
  metadata: Record<string, unknown>;  // provider-specific (workspace name, etc.)
  created_at: string;            // ISO 8601
  updated_at: string;
  expires_at?: string;           // token expiry, null if no expiry
};
```

### 2.3 ConnectionAction (New)

Every connection provider exposes a fixed set of actions. An action is NOT a tool.
It is an operation that runs through a connection's authenticated channel.

```typescript
type ActionParamType = "string" | "number" | "boolean" | "file" | "enum" | "json";

type ActionParam = {
  name: string;
  type: ActionParamType;
  required: boolean;
  default?: unknown;
  description: string;
  enum_values?: string[];
};

type ConnectionAction = {
  id: string;                    // "feishu.send_message"
  provider: ConnectionProvider;
  name: string;                  // "Send Message"
  description: string;
  required_scopes: string[];     // OAuth scopes this action needs
  params: ActionParam[];
  output_type: "json" | "file" | "void";
};
```

### 2.4 Relationship Model: Tool -> Connection Dependency

Some composite operations need both a tool AND a connection. This is modeled
as a pipeline, NOT by making tools aware of connections.

```typescript
// A pipeline step is either a tool invocation or a connection action invocation.
type PipelineStep =
  | { type: "tool"; tool_id: string; params: Record<string, unknown> }
  | { type: "action"; connection_id: string; action_id: string; params: Record<string, unknown> };

// A pipeline chains steps, passing outputs forward.
type Pipeline = {
  steps: PipelineStep[];
  // Output of step[n] is available as $step[n].output in step[n+1].params
};
```

**Key design decision**: Tools never reference connections. Connections never
contain tool logic. Composition happens at the API/orchestration layer, not
inside either primitive.

```
+------------------+      +-------------------+
|  Tool (stateless)|      | Connection (state) |
|  pdf.compress    |      | feishu.my_workspace|
|                  |      |                    |
|  No auth needed  |      | OAuth token inside |
+--------+---------+      +---------+----------+
         |                          |
         +--------+  +--------------+
                  |  |
            +-----+--+------+
            |   Pipeline     |
            | step1: compress |
            | step2: upload   |
            +----------------+
```

---

## 3. API Route Design

### 3.1 Tool APIs (Existing -- Minimal Changes)

```
GET  /v1/tools                    # List tools (unchanged)
GET  /v1/tools/:toolId            # Get tool detail (unchanged)
POST /v1/tools/:toolId/test       # Test tool (unchanged)
POST /v1/execute                  # Execute tool (unchanged)
POST /v1/execute/async            # Async execute (unchanged)
POST /v1/dispatch                 # Smart dispatch (unchanged)
```

**One change**: the `/v1/dispatch` router must learn to distinguish between
tool intents and connection-action intents. See Section 4.2.

### 3.2 Connection APIs (New)

```
# ── Discovery ──
GET  /v1/connections/providers                  # List available providers
GET  /v1/connections/providers/:provider        # Provider detail + available actions

# ── OAuth Flow ──
POST /v1/connections/oauth/start                # Initiate OAuth, returns redirect_url
GET  /v1/connections/oauth/callback             # OAuth callback (provider redirects here)

# ── Connection CRUD ──
GET  /v1/connections                            # List tenant's connections
GET  /v1/connections/:connectionId              # Get connection detail
PATCH /v1/connections/:connectionId             # Update display_name, metadata
DELETE /v1/connections/:connectionId            # Revoke + delete connection

# ── Connection Actions ──
GET  /v1/connections/:connectionId/actions      # List available actions for this connection
POST /v1/connections/:connectionId/actions/:actionId  # Execute action through connection

# ── Health ──
POST /v1/connections/:connectionId/verify       # Check if token is still valid
```

### 3.3 Route Request/Response Contracts

#### POST /v1/connections/oauth/start

```typescript
// Request
type OAuthStartRequest = {
  provider: ConnectionProvider;
  scopes?: string[];             // optional override; defaults to provider's default scopes
  redirect_uri?: string;         // optional override for callback URL
  display_name?: string;         // label for this connection
};

// Response 200
type OAuthStartResponse = {
  ok: true;
  connection_id: string;         // pre-created in "pending" status
  authorize_url: string;         // redirect user's browser here
  expires_in: number;            // seconds before this auth attempt expires
};
```

#### GET /v1/connections/oauth/callback

```
// This is browser-redirected, not called by API consumers.
// Query params: ?code=xxx&state=yyy
// On success: redirects to app with ?connection_id=xxx&status=active
// On failure: redirects to app with ?error=xxx&error_description=yyy
```

#### POST /v1/connections/:connectionId/actions/:actionId

```typescript
// Request
type ActionExecuteRequest = {
  params: Record<string, unknown>;
};

// Response 200
type ActionExecuteResponse = {
  ok: true;
  action_id: string;
  connection_id: string;
  result: Record<string, unknown>;
  duration_ms: number;
};

// Response 401 (token expired, auto-refresh failed)
type ActionAuthError = {
  ok: false;
  error: {
    code: "connection_expired";
    message: string;
    reconnect_url: string;       // URL to re-initiate OAuth
  };
};
```

### 3.4 Router Discrimination: Tool vs Connection

The `/v1/dispatch` endpoint currently only resolves to tools. After separation:

```typescript
type DispatchDecision =
  | { channel: "tool"; tool_id: string; confidence: number }
  | { channel: "action"; provider: ConnectionProvider; action_id: string; confidence: number }
  | { channel: "pipeline"; steps: PipelineStep[]; confidence: number }
  | { channel: "fallback" };
```

The fast-channel router gains a second rule table for connection actions.
Intent keywords like "send to feishu", "upload to drive", "post to slack"
route to the action channel. File-processing keywords route to the tool channel.

---

## 4. Engine Layer Refactoring

### 4.1 Registry Split

**Before**: Single `ToolRegistry` holds everything.

**After**: Two registries, one concern each.

```
lib/server/
  tool-catalog.ts          # existing, unchanged. Reads tools/ manifests.
  connection-registry.ts   # NEW. Manages ConnectionProvider definitions + actions.
```

```typescript
// connection-registry.ts

type ProviderDefinition = {
  provider: ConnectionProvider;
  region: ConnectionRegion;
  display_name: string;
  description: string;
  icon_url: string;
  oauth: {
    auth_url: string;
    token_url: string;
    default_scopes: string[];
    pkce: boolean;
  };
  actions: ConnectionAction[];
};

class ConnectionRegistry {
  private readonly providers = new Map<string, ProviderDefinition>();

  register(definition: ProviderDefinition): void;
  getProvider(provider: ConnectionProvider): ProviderDefinition | undefined;
  listProviders(region?: ConnectionRegion): ProviderDefinition[];
  getAction(provider: ConnectionProvider, actionId: string): ConnectionAction | undefined;
  listActions(provider: ConnectionProvider): ConnectionAction[];
}

export const connectionRegistry = new ConnectionRegistry();
```

### 4.2 Router Enhancement

```
lib/server/
  fast-channel-router.ts   # existing. Add action-intent rules alongside tool-intent rules.
```

The router's `RULES` array gains entries for connection actions:

```typescript
// Additional rules in fast-channel-router.ts
const ACTION_RULES: IntentRule[] = [
  {
    actionId: "feishu.send_message",
    provider: "feishu",
    terms: [
      { token: "feishu", weight: 0.3, reason: "mentions feishu" },
      { token: "飞书", weight: 0.35, reason: "mentions 飞书" },
      { token: "send", weight: 0.25, reason: "mentions send" },
      { token: "message", weight: 0.2, reason: "mentions message" },
      { token: "发消息", weight: 0.4, reason: "mentions 发消息" },
    ],
  },
  // ... more action rules
];
```

The `analyzeFastChannel` function returns a discriminated union:

```typescript
type FastChannelDecision =
  | { matched: true; channel: "tool"; toolId: string; confidence: number; /* ... */ }
  | { matched: true; channel: "action"; provider: ConnectionProvider; actionId: string; confidence: number; /* ... */ }
  | { matched: false; /* ... */ };
```

### 4.3 Runner Split

**Before**: Single `executeTool()` function.

**After**: Two execution paths.

```
lib/server/
  tool-executor.ts         # existing, unchanged. Executes tools.
  action-executor.ts       # NEW. Executes connection actions.
```

```typescript
// action-executor.ts

type ActionExecuteResult = {
  actionId: string;
  connectionId: string;
  durationMs: number;
  result: Record<string, unknown>;
};

class ActionExecutionError extends Error {
  readonly code: string;
  readonly status: number;
  readonly reconnect?: boolean;    // true = token expired, suggest re-auth
}

const executeAction = async (
  connectionId: string,
  actionId: string,
  params: Record<string, unknown>,
): Promise<ActionExecuteResult>;
```

Internally, `executeAction` does:

```
1. Load connection from store (get token)
2. Validate connection status == "active"
3. If expired, attempt auto-refresh
4. If refresh fails, throw ActionExecutionError with reconnect=true
5. Look up ActionHandler from connectionRegistry
6. Call handler with (token, params)
7. Return result
```

### 4.4 ConnectionManager (New)

```
lib/server/
  connection-manager.ts    # NEW. Manages connection lifecycle.
```

```typescript
// connection-manager.ts

class ConnectionManager {
  // OAuth flow
  startOAuth(tenantId: string, provider: ConnectionProvider, opts?: OAuthOptions): Promise<OAuthStartResult>;
  handleCallback(code: string, state: string): Promise<Connection>;

  // CRUD
  list(tenantId: string): Promise<Connection[]>;
  get(connectionId: string): Promise<Connection | undefined>;
  update(connectionId: string, patch: ConnectionPatch): Promise<Connection>;
  revoke(connectionId: string): Promise<void>;

  // Token lifecycle
  verify(connectionId: string): Promise<boolean>;
  refreshToken(connectionId: string): Promise<boolean>;

  // Internal
  private encryptToken(token: string): string;
  private decryptToken(encrypted: string): string;
}

export const connectionManager = new ConnectionManager();
```

### 4.5 File Layout After Refactoring

```
lib/server/
  access-control.ts             # unchanged
  artifact-store.ts             # unchanged
  billing-policy.ts             # unchanged
  billing-webhook.ts            # unchanged
  connection-manager.ts         # NEW: connection lifecycle
  connection-registry.ts        # NEW: provider + action definitions
  action-executor.ts            # NEW: execute actions through connections
  env.ts                        # add connection-related env vars
  fast-channel-router.ts        # MODIFIED: add action intent rules
  job-registry.ts               # unchanged
  llm-provider.ts               # unchanged
  observability.ts              # unchanged
  quota-governor.ts             # unchanged
  run-registry.ts               # unchanged
  security-controls.ts          # unchanged
  subagent-registry.ts          # unchanged
  tool-catalog.ts               # unchanged
  tool-executor.ts              # unchanged
  tool-job-registry.ts          # unchanged
  usage-ledger.ts               # MODIFIED: add action usage tracking
```

---

## 5. Three Execution Scenarios

### 5.1 Pure Tool (No Connection)

```
Client                         OmniAgent
  |                               |
  |  POST /v1/execute             |
  |  { tool: "pdf.compress",     |
  |    params: { quality: 50 } }  |
  |------------------------------>|
  |                               |---> ToolExecutor
  |                               |     (ghostscript)
  |                               |<--- result + artifact URL
  |  { status: "success",        |
  |    result: { output_url } }   |
  |<------------------------------|
```

No connection involved. Existing path. Zero changes.

### 5.2 Pure Connection Action

```
Client                         OmniAgent                     Feishu API
  |                               |                              |
  |  POST /v1/connections         |                              |
  |    /:connId/actions           |                              |
  |    /feishu.send_message       |                              |
  |  { params: {                  |                              |
  |      chat_id: "xxx",          |                              |
  |      text: "hello" } }       |                              |
  |------------------------------>|                              |
  |                               |---> ConnectionManager        |
  |                               |     load token               |
  |                               |---> ActionExecutor           |
  |                               |     POST /open-apis/im/v1   |
  |                               |---------------------------->|
  |                               |<----------------------------|
  |                               |<--- result                  |
  |  { ok: true,                  |                              |
  |    result: { msg_id } }       |                              |
  |<------------------------------|                              |
```

### 5.3 Mixed Pipeline (Tool + Connection)

```
Client                         OmniAgent
  |                               |
  |  POST /v1/dispatch            |
  |  { prompt: "compress this     |
  |    PDF and send to feishu",   |
  |    params: { file_url: "..." ,|
  |    chat_id: "xxx" } }        |
  |------------------------------>|
  |                               |
  |    Router detects: pipeline   |
  |    Step 1: pdf.compress       |
  |    Step 2: feishu.upload_file |
  |                               |
  |                               |---> ToolExecutor (step 1)
  |                               |<--- compressed PDF URL
  |                               |
  |                               |---> ActionExecutor (step 2)
  |                               |     uses compressed PDF URL as input
  |                               |<--- feishu file_key
  |                               |
  |  { ok: true,                  |
  |    channel: "pipeline",       |
  |    steps: [                   |
  |      { tool: "pdf.compress",  |
  |        status: "success" },   |
  |      { action: "feishu.upload"|
  |        status: "success" }    |
  |    ] }                        |
  |<------------------------------|
```

**Pipeline execution is always synchronous and sequential.** Each step's output
feeds the next step's input. If any step fails, the pipeline stops and returns
partial results.

---

## 6. Security & Storage

### 6.1 Token Storage

```
PostgreSQL table: omni_connections

+------------------+------------+--------------------------------------+
| Column           | Type       | Notes                                |
+------------------+------------+--------------------------------------+
| id               | uuid       | PK                                   |
| tenant_id        | varchar    | FK to tenant, indexed                |
| provider         | varchar    | "feishu", "gmail", etc.              |
| region           | varchar    | "cn" | "intl"                        |
| status           | varchar    | "pending"|"active"|"expired"|...     |
| display_name     | varchar    |                                      |
| scopes           | jsonb      | ["im:read", "im:write"]              |
| access_token_enc | bytea      | AES-256-GCM encrypted                |
| refresh_token_enc| bytea      | AES-256-GCM encrypted                |
| token_expires_at | timestamptz|                                      |
| oauth_state      | varchar    | nonce for CSRF prevention            |
| metadata         | jsonb      | provider-specific data               |
| created_at       | timestamptz|                                      |
| updated_at       | timestamptz|                                      |
+------------------+------------+--------------------------------------+

Indexes:
  - (tenant_id, provider) for "list my feishu connections"
  - (oauth_state) for callback lookup
  - (status, token_expires_at) for background refresh sweeper
```

### 6.2 Token Encryption

```typescript
// Encryption key from env: CONNECTION_ENCRYPTION_KEY (32 bytes, hex-encoded)
// Algorithm: AES-256-GCM
// Each token gets a unique 12-byte IV, stored as prefix to ciphertext

const encrypt = (plaintext: string, key: Buffer): Buffer => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);  // 12 + 16 + N bytes
};

const decrypt = (blob: Buffer, key: Buffer): string => {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ciphertext = blob.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final("utf8");
};
```

### 6.3 Token Refresh

```
Background job (runs every 5 minutes):
  1. SELECT * FROM omni_connections WHERE status='active' AND token_expires_at < NOW() + INTERVAL '10 minutes'
  2. For each: attempt refresh using refresh_token
  3. On success: update access_token_enc, token_expires_at, status='active'
  4. On failure: set status='expired', notify tenant via webhook
```

### 6.4 Tenant Isolation

```
Rule: Every connection query includes WHERE tenant_id = :callerTenantId

- Connection listing: only shows caller's connections
- Action execution: verifies connection.tenant_id == caller.tenant_id before loading token
- No cross-tenant access, even for admin:* scope (admin can list all, but not use others' tokens)
```

---

## 7. Maton Integration Strategy

### 7.1 What is Maton

Maton is a unified API layer for international SaaS (Gmail, Slack, Notion, Linear, etc.).
It handles OAuth flow, token management, and provides a normalized API.

### 7.2 Integration Decision Matrix

```
+------------------+-----------+------------------------------------------+
| Provider         | Region    | Strategy                                 |
+------------------+-----------+------------------------------------------+
| Feishu           | cn        | Self-built. Feishu SDK + our OAuth flow.  |
| DingTalk         | cn        | Self-built. DingTalk SDK.                 |
| WeCom            | cn        | Self-built. WeCom SDK.                    |
| Gmail            | intl      | Maton. Use their OAuth + unified API.     |
| Slack            | intl      | Maton. Use their OAuth + unified API.     |
| Notion           | intl      | Maton. Use their OAuth + unified API.     |
| Google Drive     | intl      | Maton. Use their OAuth + unified API.     |
| Dropbox          | intl      | Maton. Use their OAuth + unified API.     |
| GitHub           | intl      | Maton. Use their OAuth + unified API.     |
| Linear           | intl      | Maton. Use their OAuth + unified API.     |
+------------------+-----------+------------------------------------------+
```

**Rule**: China SaaS = self-built (regulatory + API differences). International SaaS = Maton
(saves OAuth maintenance for 20+ providers).

### 7.3 Unified Abstraction Layer

Both self-built and Maton-proxied connections implement the same interface:

```typescript
type ConnectionAdapter = {
  provider: ConnectionProvider;

  // OAuth
  getAuthUrl(scopes: string[], state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<TokenSet>;
  refreshToken(refreshToken: string): Promise<TokenSet>;

  // Actions
  executeAction(
    actionId: string,
    accessToken: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
};

type TokenSet = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;         // seconds
  scope: string;
};
```

For Maton-backed providers, the adapter delegates to Maton's API:

```typescript
class MatonAdapter implements ConnectionAdapter {
  constructor(private matonApiKey: string) {}

  getAuthUrl(scopes, state, redirectUri) {
    // Returns Maton's OAuth initiation URL
    return `https://api.maton.ai/oauth/${this.provider}/authorize?...`;
  }

  exchangeCode(code, redirectUri) {
    // POST https://api.maton.ai/oauth/${this.provider}/token
  }

  executeAction(actionId, accessToken, params) {
    // POST https://api.maton.ai/v1/${this.provider}/${actionId}
    // Authorization: Bearer ${accessToken}
  }
}
```

For self-built providers, the adapter calls the SaaS API directly:

```typescript
class FeishuAdapter implements ConnectionAdapter {
  getAuthUrl(scopes, state, redirectUri) {
    return `https://open.feishu.cn/open-apis/authen/v1/authorize?...`;
  }

  exchangeCode(code, redirectUri) {
    // POST https://open.feishu.cn/open-apis/authen/v1/oidc/access_token
  }

  executeAction(actionId, accessToken, params) {
    // Direct Feishu API call based on actionId
    switch (actionId) {
      case "feishu.send_message":
        // POST https://open.feishu.cn/open-apis/im/v1/messages
        break;
      case "feishu.upload_file":
        // POST https://open.feishu.cn/open-apis/im/v1/images
        break;
    }
  }
}
```

### 7.4 Adapter Registry

```typescript
// lib/server/connection-adapters/index.ts

const adapters = new Map<ConnectionProvider, ConnectionAdapter>();

// Self-built
adapters.set("feishu", new FeishuAdapter());
adapters.set("dingtalk", new DingTalkAdapter());
adapters.set("wecom", new WeComAdapter());

// Maton-backed
const matonKey = process.env.MATON_API_KEY;
if (matonKey) {
  for (const provider of ["gmail", "slack", "notion", "google_drive", "dropbox", "github", "linear"]) {
    adapters.set(provider as ConnectionProvider, new MatonAdapter(provider, matonKey));
  }
}

export const getAdapter = (provider: ConnectionProvider): ConnectionAdapter | undefined => {
  return adapters.get(provider);
};
```

---

## 8. Full System Diagram

```
+-----------------------------------------------------------------------+
|                           Client / Agent                               |
+---+------------------+-------------------+-----------------+----------+
    |                  |                   |                 |
    | GET /v1/tools    | POST /v1/execute  | Connection APIs | POST /v1/dispatch
    |                  |                   |                 |
+---v------------------v---+   +-----------v-----------+    |
|    Tool Subsystem         |   |  Connection Subsystem  |    |
|                           |   |                       |    |
| +---------------------+  |   | +-------------------+ |    |
| | ToolCatalog         |  |   | | ConnectionRegistry| |    |
| | (reads tools/ dir)  |  |   | | (provider defs)   | |    |
| +---------------------+  |   | +-------------------+ |    |
|                           |   |                       |    |
| +---------------------+  |   | +-------------------+ |    |
| | ToolExecutor        |  |   | | ConnectionManager | |    |
| | (runs tool logic)   |  |   | | (OAuth + CRUD)    | |    |
| +---------------------+  |   | +-------------------+ |    |
|                           |   |                       |    |
| +---------------------+  |   | +-------------------+ |    |
| | FastAPI Executor    |  |   | | ActionExecutor    | |    |
| | (Python sandbox)    |  |   | | (proxies to SaaS) | |    |
| +---------------------+  |   | +-------------------+ |    |
|                           |   |                       |    |
+---------------------------+   | +-------------------+ |    |
                                | | Adapters          | |    |
                                | | FeishuAdapter     | |    |
                                | | MatonAdapter      | |    |
                                | | DingTalkAdapter   | |    |
                                | +-------------------+ |    |
                                |                       |    |
                                | +-------------------+ |    |
                                | | TokenVault        | |    |
                                | | (PostgreSQL + AES)| |    |
                                | +-------------------+ |    |
                                +-----------------------+    |
                                                             |
+------------------------------------------------------------v----------+
|                     Dispatch Router (Enhanced)                         |
|                                                                        |
|  Input: { prompt, tool?, params }                                      |
|                                                                        |
|  Decision:                                                             |
|    - "tool"     -> ToolExecutor                                        |
|    - "action"   -> ActionExecutor (requires connection_id)             |
|    - "pipeline" -> ToolExecutor then ActionExecutor                    |
|    - "fallback" -> LLM agent                                          |
+------------------------------------------------------------------------+
```

---

## 9. Migration Path

### Phase 1: Foundation (Week 1-2)

1. Create `omni_connections` table in PostgreSQL
2. Implement `ConnectionManager` (CRUD + token encryption)
3. Implement `ConnectionRegistry` with `FeishuAdapter` as first provider
4. Add `/v1/connections` API routes (OAuth flow + CRUD)
5. No changes to existing tool paths

### Phase 2: Actions (Week 3)

1. Implement `ActionExecutor`
2. Add `/v1/connections/:id/actions` routes
3. Define first set of Feishu actions (send_message, upload_file, list_chats)
4. Add action-intent rules to `fast-channel-router.ts`

### Phase 3: Pipeline (Week 4)

1. Enhance `/v1/dispatch` to detect pipeline intents
2. Implement sequential pipeline executor
3. Add composite test cases (compress + send)

### Phase 4: Maton + Scale (Week 5-6)

1. Integrate Maton for international providers
2. Add Gmail, Slack, Notion adapters via MatonAdapter
3. Add DingTalk and WeCom self-built adapters

---

## 10. Design Principles Summary

| Principle | Application |
|-----------|-------------|
| Tools are pure functions | No auth, no state, no side effects beyond file I/O |
| Connections are auth channels | OAuth token + scoped API proxy, no data processing |
| Composition over inheritance | Pipeline chains tools and actions, neither knows about the other |
| Encryption at rest | All OAuth tokens AES-256-GCM encrypted in PostgreSQL |
| Tenant isolation | Every query scoped by tenant_id, no cross-tenant token access |
| Adapter pattern for providers | Self-built and Maton-backed providers share one interface |
| Router stays zero-token | Action intents resolved by keyword rules, not LLM calls |
