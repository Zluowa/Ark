# OmniAgent UI Design Specification

> Version: 1.0 | Date: 2026-02-28
> Author: MOSS Design System
> Status: Draft for Review

---

## 0. Design Philosophy

OmniAgent is "the tool backend for all Agents." Its core promise is
**100 tokens to do what others need 10,000 for.**

The UI must communicate two fundamentally different capabilities:

| Concept      | Nature            | Auth Required | Metaphor         |
|-------------|-------------------|---------------|------------------|
| **Tools**   | Stateless compute | No            | Swiss army knife |
| **Connections** | OAuth channels | Yes           | Power outlet     |

These two concepts were previously conflated under a single "Tools" page.
This spec separates them cleanly, following Maton's minimalism and
ChatGPT's conversational execution model.

---

## 1. Global Information Architecture

### 1.1 Route Tree

```
/                          → redirect to /dashboard
/dashboard                 → Home (overview + quick stats)
/dashboard/tools           → Tool Catalog (stateless utilities)
/dashboard/connections     → Service Connections (OAuth integrations)
/dashboard/settings        → API Key + Account Settings
/dashboard/usage           → Plan + Usage Metrics
/agent                     → C-end execution interface (standalone, no sidebar)
```

### 1.2 Navigation Model

```
+---------------------------------------------+
|  Sidebar (persistent, 208px)                |
|                                              |
|  [Logo] OmniAgent                           |
|                                              |
|  MENU                                        |
|  > Home          /dashboard                  |
|  > Tools         /dashboard/tools            |
|  > Connections   /dashboard/connections       |
|  > Settings      /dashboard/settings         |
|  > Usage         /dashboard/usage            |
|                                              |
|  ─────────────────────────                   |
|  user@example.com                            |
+---------------------------------------------+
```

**Key changes from current:**
- Add `Connections` nav item (icon: `Plug` from lucide)
- Remove "SaaS" from tool categories entirely
- Sidebar items: Home, Tools, Connections, Settings, Usage (5 items)
- Header bar retains `Agent` quick-link and `Docs` external link

### 1.3 Page Function Matrix

| Page           | Purpose                                       | Primary Action             |
|---------------|-----------------------------------------------|----------------------------|
| Home          | At-a-glance status: API key, stats, quick links | Copy API key              |
| Tools         | Browse/search stateless tool catalog           | View tool details          |
| Connections   | Manage OAuth service integrations              | Connect / Disconnect       |
| Settings      | API key management, account preferences        | Rotate key                 |
| Usage         | Plan tier, request quotas, billing             | Upgrade plan               |
| Agent         | Natural-language tool execution (C-end)        | Submit task + download     |

---

## 2. Page Wireframes

### 2.1 Dashboard Home

```
+--[ Sidebar ]--+--[ Header: Home                    Agent | Docs ]--+
|               |                                                      |
|  [O] Omni..   |  +----------------------------------------------+   |
|               |  |  API Key                                      |   |
|  MENU         |  |  Your key for all OmniAgent services.        |   |
|  > Home  *    |  |                                               |   |
|  > Tools      |  |  [oa_sk_RYhy ··· h1Ie]  [Eye] [Copy] [Reset] |   |
|  > Connections|  +----------------------------------------------+   |
|  > Settings   |                                                      |
|  > Usage      |  +--- Stats Row (3 cards) -----------------------+   |
|               |  |                                               |   |
|               |  | +----------+ +----------+ +----------+       |   |
|               |  | | Tools    | | Conns    | | Requests |       |   |
|               |  | | 13       | | 0/5      | | 1,247    |       |   |
|               |  | | available| | connected| | this mo  |       |   |
|               |  | +----------+ +----------+ +----------+       |   |
|               |  +-----------------------------------------------+   |
|               |                                                      |
|               |  +--- Quick Actions --------------------------------+|
|               |  |                                                   ||
|               |  |  [Try Agent ->]    [Browse Tools ->]              ||
|               |  |  [Connect Gmail ->] [Read Docs ->]               ||
|               |  +---------------------------------------------------+|
|               |                                                      |
|  ───────────  |                                                      |
|  user@...     |                                                      |
+---------------+------------------------------------------------------+
```

**Components:**
- `ApiKeyCard` (reuse existing, no changes)
- `StatsRow` (NEW) -- 3 mini stat cards in a horizontal row
- `QuickActions` (NEW) -- 2x2 link grid to primary destinations

### 2.2 Tools Page (Tool Catalog)

```
+--[ Sidebar ]--+--[ Header: Tools                   Agent | Docs ]--+
|               |                                                      |
|               |  Tools                                               |
|               |  13 stateless utilities, always available.           |
|               |                                                      |
|               |  +--[ Search 13 tools... ]-------+ [Sort: Popular v] |
|               |                                                      |
|               |  [All] [PDF] [Image] [Video] [Audio] [Data]         |
|               |                                                      |
|               |  +-------- Tool Grid (3 columns) -------------------+|
|               |  |                                                   ||
|               |  | +- Tool Card ------+  +- Tool Card ------+      ||
|               |  | | [PDF icon]       |  | [IMG icon]       |      ||
|               |  | |                  |  |                  |      ||
|               |  | | PDF Compressor   |  | Image Converter  |      ||
|               |  | | Compress PDF...  |  | Convert images.. |      ||
|               |  | |                  |  |                  |      ||
|               |  | | [Try in Agent->] |  | [Try in Agent->] |      ||
|               |  | +-----------------+  +-----------------+      ||
|               |  |                                                   ||
|               |  | +- Tool Card ------+  +- Tool Card ------+      ||
|               |  | | [VID icon]       |  | [DAT icon]       |      ||
|               |  | |                  |  |                  |      ||
|               |  | | Video to GIF     |  | JSON Formatter   |      ||
|               |  | | Convert video... |  | Format, valid... |      ||
|               |  | |                  |  |                  |      ||
|               |  | | [Try in Agent->] |  | [Try in Agent->] |      ||
|               |  | +-----------------+  +-----------------+      ||
|               |  +---------------------------------------------------+|
|               |                                                      |
+---------------+------------------------------------------------------+
```

**Key changes from current:**
- `SaaS` category REMOVED from filter tabs (SaaS items move to Connections)
- No `Connected/Available` status on tool cards (tools are always available)
- Each tool card gets a `Try in Agent ->` link instead of `+ Connect` button
- Categories: PDF, Image, Video, Audio, Data (5 categories, no SaaS)
- Subtitle line: "{count} stateless utilities, always available."

**Tool Card (redesigned):**
```
+-----------------------------------+
|  [Category Icon]     [Category]   |
|                                   |
|  Tool Name                        |
|  Brief description text that      |
|  can wrap to two lines max.       |
|                                   |
|  [Try in Agent ->]                |
+-----------------------------------+
```

- No status indicator (tools are always "ready")
- Bottom-left: text link to `/agent?tool={toolId}`
- Hover: border brightens (`zinc-700`), subtle lift

### 2.3 Connections Page (Service Connections)

```
+--[ Sidebar ]--+--[ Header: Connections              Agent | Docs ]--+
|               |                                                      |
|               |  Connections                                         |
|               |  Authorize third-party services to use via API.      |
|               |                                                      |
|               |  [All] [Connected] [Available]                       |
|               |                                                      |
|               |  +-------- Connection Grid (3 columns) -------------+|
|               |  |                                                   ||
|               |  | +- Conn Card ------+  +- Conn Card ------+      ||
|               |  | | [Gmail logo]     |  | [Slack logo]     |      ||
|               |  | |                  |  |                  |      ||
|               |  | | Gmail            |  | Slack            |      ||
|               |  | | Send, read and   |  | Send messages    |      ||
|               |  | | manage emails... |  | and files to...  |      ||
|               |  | |                  |  |                  |      ||
|               |  | | [+ Connect]      |  | [+ Connect]      |      ||
|               |  | +-----------------+  +-----------------+      ||
|               |  |                                                   ||
|               |  | +- Conn Card ------+  +- Conn Card ------+      ||
|               |  | | [Notion logo]    |  | [Feishu logo]    |      ||
|               |  | |                  |  |                  |      ||
|               |  | | Notion           |  | Feishu           |      ||
|               |  | | Create pages,    |  | Send messages,   |      ||
|               |  | | add content...   |  | create docs...   |      ||
|               |  | |                  |  |                  |      ||
|               |  | | [+ Connect]      |  | [+ Connect]      |      ||
|               |  | +-----------------+  +-----------------+      ||
|               |  |                                                   ||
|               |  | +- Conn Card ------+                             ||
|               |  | | [GDrive logo]    |                             ||
|               |  | | *CONNECTED*      |                             ||
|               |  | | Google Drive     |                             ||
|               |  | | Upload, download |                             ||
|               |  | | and organize...  |                             ||
|               |  | |                  |                             ||
|               |  | | [Disconnect]     |                             ||
|               |  | +-----------------+                             ||
|               |  +---------------------------------------------------+|
|               |                                                      |
+---------------+------------------------------------------------------+
```

**Connection Card (NEW component):**
```
+-----------------------------------+
|  [Service Logo/Icon]              |
|                  [Status Badge]   |
|                                   |
|  Service Name                     |
|  Brief description text.         |
|                                   |
|  [+ Connect]  or  [Disconnect]   |
+-----------------------------------+
```

- **Not connected:** muted card, `+ Connect` button (starts OAuth flow)
- **Connected:** green top-border accent, green dot badge, `Disconnect` button
- **Connecting:** spinner animation during OAuth redirect
- Filter tabs: All / Connected / Available (same logic as current tools page)

### 2.4 Agent Page (C-end Execution)

```
+----------------------------------------------------------------------+
|                                                                      |
|                                                                      |
|                                                                      |
|                     [Zap icon]                                       |
|                                                                      |
|              What do you want to do?                                 |
|     Describe the task, OmniAgent picks the best tool.                |
|                                                                      |
|         +---------------------------------------------+              |
|         |                                             |              |
|         | Describe what you want to do, or upload a   |              |
|         | file...                                     |              |
|         |                                             |              |
|         | [Paperclip]                         [Send]  |              |
|         +---------------------------------------------+              |
|                                                                      |
|         [Compress PDF] [Convert Image] [Video to GIF]                |
|         [Format JSON] [Generate QR] [Hash Text]                      |
|                                                                      |
|                                                                      |
+----------------------------------------------------------------------+
|                                                    | History sidebar |
|     (result card appears here after execution)     | (appears when  |
|                                                    | history > 0)   |
+----------------------------------------------------------------------+
```

**No changes to Agent page.** It remains standalone (no dashboard sidebar).
One minor addition: hot tags should be generated from the actual tool catalog
rather than hardcoded. This is a data concern, not a UI layout change.

### 2.5 Settings Page

```
+--[ Sidebar ]--+--[ Header: Settings                Agent | Docs ]--+
|               |                                                      |
|               |  Settings                                            |
|               |                                                      |
|               |  +--- API Key ----------------------------------------+|
|               |  |  (same ApiKeyCard as Home page)                   ||
|               |  +---------------------------------------------------+|
|               |                                                      |
|               |  +--- Account ----------------------------------------+|
|               |  |                                                   ||
|               |  |  Email         user@omniagent.dev                 ||
|               |  |  Plan          Hobby (Free)    [Manage ->]        ||
|               |  |  Created       2026-01-15                         ||
|               |  |                                                   ||
|               |  +---------------------------------------------------+|
|               |                                                      |
|               |  +--- Danger Zone -----------------------------------+|
|               |  |                                                   ||
|               |  |  [Delete Account]                                 ||
|               |  |                                                   ||
|               |  +---------------------------------------------------+|
|               |                                                      |
+---------------+------------------------------------------------------+
```

**Changes from current:**
- Add `Account` section with basic profile info
- Add `Danger Zone` section with delete account
- Keep `ApiKeyCard` component unchanged

### 2.6 Usage Page

```
+--[ Sidebar ]--+--[ Header: Usage                   Agent | Docs ]--+
|               |                                                      |
|               |  Usage                                               |
|               |  View your current plan here.                        |
|               |                                                      |
|               |  +--- Usage Meter -----------------------------------+|
|               |  |                                                   ||
|               |  |  Requests this month                              ||
|               |  |  [================================--------] 75%   ||
|               |  |  1,247 / unlimited                                ||
|               |  |                                                   ||
|               |  |  Rate limit: 10 req/s                             ||
|               |  +---------------------------------------------------+|
|               |                                                      |
|               |  +--- Plans (2 cards side-by-side) ------------------+|
|               |  |                                                   ||
|               |  |  +--- Hobby -------+  +--- Enterprise ---+       ||
|               |  |  | Free /month     |  | Custom /month    |       ||
|               |  |  |                 |  |                  |       ||
|               |  |  | * Unlimited req |  | * Custom plans   |       ||
|               |  |  | * 10 req/s     |  | * Dedicated mgr  |       ||
|               |  |  | * Community    |  | * Priority       |       ||
|               |  |  | * Free forever |  | * 24/7 support   |       ||
|               |  |  |                 |  |                  |       ||
|               |  |  | [Current Plan]  |  | [Talk to us]     |       ||
|               |  |  +----------------+  +-----------------+       ||
|               |  +---------------------------------------------------+|
|               |                                                      |
+---------------+------------------------------------------------------+
```

**Changes from current:**
- Add `UsageMeter` component above plan cards (progress bar + numbers)
- Plans section unchanged

---

## 3. Key User Flows

### 3.1 Using a Tool (Stateless Execution)

```
User lands on /dashboard
     |
     v
Sees "Quick Actions" -> clicks "Try Agent"
     |
     v
Arrives at /agent (standalone page)
     |
     v
Types "Compress this PDF" + attaches file
     |
     v
Agent auto-selects "PDF Compressor" tool
     |
     v
Shows progress spinner in input area
     |
     v
ResultCard appears with:
  - Summary: "10.5 MB -> 2.1 MB (80% reduction)"
  - [Download] button (signed S3 URL)
  - [Run again] button
     |
     v
History sidebar logs the execution
```

**Alternative entry point:**
```
User on /dashboard/tools
     |
     v
Clicks "Try in Agent ->" on a tool card
     |
     v
Redirects to /agent?tool=pdf-compressor
     |
     v
Input pre-filled with tool name, user adds file
     |
     v
(same flow as above)
```

### 3.2 Connecting an OAuth Service

```
User navigates to /dashboard/connections
     |
     v
Sees grid of available services (Gmail, Slack, etc.)
     |
     v
Clicks "+ Connect" on Gmail card
     |
     v
Card shows "Connecting..." spinner state
     |
     v
Browser opens OAuth popup/redirect to Google
     |
     v
User authorizes OmniAgent
     |
     v
Redirect back to /dashboard/connections?callback=gmail
     |
     v
Gmail card now shows:
  - Green top border
  - Green dot + "Connected"
  - "Disconnect" button replaces "+ Connect"
     |
     v
Stats on Home page update: "1/5 connected"
```

### 3.3 Disconnecting a Service

```
User on /dashboard/connections
     |
     v
Clicks "Disconnect" on a connected service
     |
     v
Confirmation dialog: "Disconnect Gmail? Agents will
  no longer be able to access your Gmail."
     |
     v
[Cancel] [Disconnect]
     |
     v
Card reverts to "Available" state with "+ Connect" button
```

### 3.4 Developer Integration Flow (API Key)

```
User on /dashboard (Home)
     |
     v
Sees API Key card at top
     |
     v
Clicks [Copy] -> key copied to clipboard
     |
     v
Uses key in their Agent's HTTP header:
  Authorization: Bearer oa_sk_...
     |
     v
Agent calls POST /api/v1/execute with tool payload
     |
     v
(Backend handles tool routing, execution, artifact storage)
```

---

## 4. Component Architecture

### 4.1 New Components

| Component             | Location                                     | Scope    | Purpose                                    |
|-----------------------|----------------------------------------------|----------|--------------------------------------------|
| `StatsRow`            | `components/dashboard/stats-row.tsx`         | Home     | 3 mini stat cards (tools, conns, requests) |
| `StatCard`            | `components/dashboard/stat-card.tsx`         | Shared   | Single stat with label + value             |
| `QuickActions`        | `components/dashboard/quick-actions.tsx`     | Home     | 2x2 link grid to primary destinations      |
| `ConnectionCard`      | `components/connections/connection-card.tsx`  | Conns    | OAuth service card with connect/disconnect |
| `ConnectionGrid`      | `components/connections/connection-grid.tsx`  | Conns    | Filterable grid of ConnectionCards         |
| `ConnectionStatusFilter` | `components/connections/status-filter.tsx` | Conns    | All/Connected/Available toggle             |
| `UsageMeter`          | `components/dashboard/usage-meter.tsx`       | Usage    | Progress bar with request count            |
| `AccountSection`      | `components/dashboard/account-section.tsx`   | Settings | Email, plan, created date display          |
| `DangerZone`          | `components/dashboard/danger-zone.tsx`       | Settings | Delete account section with confirmation   |
| `ConfirmDialog`       | `components/ui/confirm-dialog.tsx`           | Shared   | Reusable confirmation modal                |

### 4.2 Components to Modify

| Component      | File                                       | Change                                              |
|---------------|--------------------------------------------|------------------------------------------------------|
| `Sidebar`     | `components/dashboard/sidebar.tsx`         | Add "Connections" nav item with `Plug` icon          |
| `ToolCard`    | `components/dashboard/tool-card.tsx`       | Remove `connected` status, add "Try in Agent" link   |
| `ToolGrid`    | `components/dashboard/tool-grid.tsx`       | Remove SaaS items from MOCK_TOOLS array              |
| `SearchBar`   | `components/dashboard/search-bar.tsx`      | Remove "SaaS" from CATEGORIES array                  |
| `DashLayout`  | `app/dashboard/layout.tsx`                 | Add `/dashboard/connections` to pageTitles           |
| `HomePage`    | `app/dashboard/page.tsx`                   | Replace ToolGrid with StatsRow + QuickActions        |

### 4.3 Components to Delete

| Component           | File                                        | Reason                                           |
|--------------------|---------------------------------------------|--------------------------------------------------|
| (none deleted)     |                                             | All existing components are retained or modified |

### 4.4 Data Model Changes

**Current `Tool` interface:**
```typescript
interface Tool {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  connected: boolean;          // <-- REMOVE
}
```

**New `Tool` interface (tools only):**
```typescript
type ToolCategory = "PDF" | "Image" | "Video" | "Audio" | "Data";

interface Tool {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  endpoint: string;            // API endpoint for this tool
}
```

**New `Connection` interface:**
```typescript
type ConnectionProvider =
  | "gmail"
  | "google-drive"
  | "slack"
  | "notion"
  | "feishu"
  | "dingtalk"
  | "wechat-work"
  | "alipay";

type ConnectionStatus = "connected" | "available" | "connecting" | "error";

interface Connection {
  id: string;
  provider: ConnectionProvider;
  name: string;                // Display name: "Gmail", "Slack", etc.
  description: string;
  status: ConnectionStatus;
  connectedAt?: string;        // ISO timestamp, only when connected
  icon: string;                // Icon identifier or URL
}
```

### 4.5 Component Hierarchy

```
RootLayout
  |
  +-- / (redirect to /dashboard)
  |
  +-- /dashboard (DashboardLayout)
  |     |
  |     +-- Sidebar
  |     |     +-- Logo
  |     |     +-- NavItem (Home)
  |     |     +-- NavItem (Tools)
  |     |     +-- NavItem (Connections)  <-- NEW
  |     |     +-- NavItem (Settings)
  |     |     +-- NavItem (Usage)
  |     |     +-- UserEmail
  |     |
  |     +-- Header
  |     |     +-- PageTitle
  |     |     +-- AgentLink
  |     |     +-- DocsLink
  |     |
  |     +-- Home (/)
  |     |     +-- ApiKeyCard
  |     |     +-- StatsRow               <-- NEW (replaces ToolGrid)
  |     |     |     +-- StatCard (tools)
  |     |     |     +-- StatCard (connections)
  |     |     |     +-- StatCard (requests)
  |     |     +-- QuickActions           <-- NEW
  |     |
  |     +-- Tools (/tools)
  |     |     +-- SearchBar (modified: no SaaS)
  |     |     +-- ToolGrid (modified: no SaaS items)
  |     |           +-- ToolCard (modified: no status, has "Try" link)
  |     |
  |     +-- Connections (/connections)    <-- NEW PAGE
  |     |     +-- ConnectionStatusFilter
  |     |     +-- ConnectionGrid
  |     |           +-- ConnectionCard
  |     |
  |     +-- Settings (/settings)
  |     |     +-- ApiKeyCard
  |     |     +-- AccountSection         <-- NEW
  |     |     +-- DangerZone             <-- NEW
  |     |
  |     +-- Usage (/usage)
  |           +-- UsageMeter             <-- NEW
  |           +-- PlanCard (Hobby)
  |           +-- PlanCard (Enterprise)
  |
  +-- /agent (standalone, no DashboardLayout)
        +-- ToolInput
        +-- HotTags
        +-- ResultCard
        +-- ExecutionHistory (sidebar)
```

---

## 5. Design Tokens

### 5.1 Color System

**Base palette (unchanged):**
```
Background:       zinc-950  (#09090b)
Surface:          zinc-900  (#18181b)  with /50 opacity
Border:           zinc-800  (#27272a)  with /60 opacity
Text primary:     white
Text secondary:   zinc-400
Text muted:       zinc-500
Text disabled:    zinc-600
Accent:           emerald-500 (#10b981)
```

**Tool category colors (unchanged):**
```
PDF:    bg-red-500/10     text-red-400       border-red-500/20
Image:  bg-blue-500/10    text-blue-400      border-blue-500/20
Video:  bg-purple-500/10  text-purple-400    border-purple-500/20
Audio:  bg-orange-500/10  text-orange-400    border-orange-500/20
Data:   bg-yellow-500/10  text-yellow-400    border-yellow-500/20
```

**Connection status colors (NEW):**
```
Connected:    emerald-500  (#10b981)  -- green dot, green border-top
Available:    zinc-500     (#71717a)  -- muted, no accent
Connecting:   amber-400    (#fbbf24)  -- spinner, pulse animation
Error:        red-400      (#f87171)  -- error icon, red border-top
```

**Connection provider brand colors (for icon backgrounds):**
```
Gmail:        bg-red-500/10       text-red-400
Google Drive: bg-blue-500/10      text-blue-400
Slack:        bg-purple-500/10    text-purple-400
Notion:       bg-zinc-500/10      text-zinc-300
Feishu:       bg-blue-500/10      text-blue-400
DingTalk:     bg-sky-500/10       text-sky-400
WeChat Work:  bg-green-500/10     text-green-400
Alipay:       bg-blue-500/10      text-blue-400
```

### 5.2 Card Style Comparison

**Tool Card:**
```css
/* Clean, informational, no status complexity */
.tool-card {
  border: 1px solid rgb(39 39 42 / 0.6);   /* zinc-800/60 */
  background: rgb(24 24 27 / 0.5);          /* zinc-900/50 */
  border-radius: 12px;                       /* rounded-xl */
  padding: 16px;
  transition: border-color 150ms, background-color 150ms;
}
.tool-card:hover {
  border-color: rgb(63 63 70);              /* zinc-700 */
  background: rgb(24 24 27);                /* zinc-900 */
}
/* No status indicator. Always ready. */
```

**Connection Card (Available):**
```css
/* Muted, inviting action */
.connection-card--available {
  border: 1px solid rgb(39 39 42 / 0.6);   /* zinc-800/60 */
  background: rgb(24 24 27 / 0.3);          /* zinc-900/30 -- dimmer */
  border-radius: 12px;
  padding: 16px;
}
.connection-card--available:hover {
  border-color: rgb(63 63 70);
  background: rgb(24 24 27 / 0.5);
}
```

**Connection Card (Connected):**
```css
/* Elevated, with green accent */
.connection-card--connected {
  border: 1px solid rgb(39 39 42 / 0.6);
  border-top: 2px solid rgb(16 185 129);    /* emerald-500 top accent */
  background: rgb(24 24 27 / 0.5);
  border-radius: 12px;
  padding: 16px;
}
```

### 5.3 Status Indicators

**Tool status:** None. Tools have no status. They are always available.
This is the entire point of separating tools from connections.

**Connection status badges:**
```
Connected:   [*] Connected     -- green dot + green text
Available:   (no badge)        -- absence of badge = available
Connecting:  [~] Connecting... -- amber spinner + amber text
Error:       [!] Error         -- red icon + red text + retry button
```

### 5.4 Typography

```
Page title:       text-lg  font-semibold  text-white
Section title:    text-sm  font-semibold  text-white
Card title:       text-sm  font-medium    text-white
Card description: text-xs  leading-relaxed text-zinc-500  line-clamp-2
Label:            text-[11px] font-semibold uppercase tracking-wider text-zinc-500
Body text:        text-sm  text-zinc-400
Stat value:       text-2xl font-bold text-white
Stat label:       text-xs  text-zinc-500
```

### 5.5 Spacing

```
Page padding:     px-6 py-8
Card padding:     p-4 (compact) or p-5 (standard)
Card gap:         gap-3 (grid items)
Section gap:      gap-6 (between sections)
Grid columns:     1 col (mobile) / 2 col (sm) / 3 col (lg)
Max content:      max-w-5xl (all dashboard pages)
Sidebar width:    w-52 (208px)
Header height:    h-12 (48px)
```

### 5.6 Icon Mapping

**Sidebar navigation:**
```
Home:          Home         (lucide)
Tools:         Wrench       (lucide)
Connections:   Plug         (lucide)  <-- NEW
Settings:      Settings     (lucide)
Usage:         BarChart3    (lucide)
```

**Tool categories:**
```
PDF:    FileText   (lucide)
Image:  Image      (lucide)
Video:  Video      (lucide)
Audio:  Music      (lucide)
Data:   Database   (lucide)
```

**Connection providers:**
```
Gmail:        Mail        (lucide)  or brand SVG
Google Drive: HardDrive   (lucide)  or brand SVG
Slack:        Hash        (lucide)  or brand SVG
Notion:       BookOpen    (lucide)  or brand SVG
Feishu:       MessageCircle (lucide) or brand SVG
DingTalk:     Bell        (lucide)  or brand SVG
WeChat Work:  MessageSquare (lucide) or brand SVG
Alipay:       CreditCard  (lucide)  or brand SVG
```

> **Note:** For connections, brand SVGs are strongly preferred for
> recognition. Lucide icons are fallbacks only.

---

## 6. Responsive Behavior

### 6.1 Breakpoints

```
Mobile   (<640px):   Sidebar collapses to hamburger menu
                     Grid: 1 column
                     Agent: full width, no history sidebar

Tablet   (640-1024): Sidebar remains visible
                     Grid: 2 columns
                     Agent: full width, no history sidebar

Desktop  (>1024):    Sidebar + content
                     Grid: 3 columns
                     Agent: content + history sidebar
```

### 6.2 Sidebar Collapse

On mobile, the sidebar becomes a slide-over triggered by a hamburger
icon in the header. The header gains a hamburger button on the left.

---

## 7. Implementation Priority

### Phase 1: Structural Split (Must-have)
1. Create `/dashboard/connections` route + page
2. Create `ConnectionCard` and `ConnectionGrid` components
3. Modify `Sidebar` to add Connections nav item
4. Remove SaaS items from `MOCK_TOOLS`, move to `MOCK_CONNECTIONS`
5. Remove `connected` field from `Tool` interface
6. Remove `+ Connect` button from `ToolCard`
7. Add "Try in Agent" link to `ToolCard`
8. Update `DashboardLayout` pageTitles

### Phase 2: Home Page Upgrade
1. Create `StatsRow` and `StatCard` components
2. Create `QuickActions` component
3. Replace `ToolGrid` on Home page with new components

### Phase 3: Settings & Usage Polish
1. Create `AccountSection` component
2. Create `DangerZone` component
3. Create `UsageMeter` component
4. Wire usage data to actual API

### Phase 4: Connection OAuth Flow
1. Implement OAuth redirect/callback handler
2. Add connecting/error states to `ConnectionCard`
3. Add `ConfirmDialog` for disconnect action
4. Wire connection status to actual backend state

---

## 8. Migration Checklist

```
[ ] Create app/dashboard/connections/page.tsx
[ ] Create components/connections/connection-card.tsx
[ ] Create components/connections/connection-grid.tsx
[ ] Create components/connections/status-filter.tsx
[ ] Modify components/dashboard/sidebar.tsx (add Connections)
[ ] Modify components/dashboard/tool-card.tsx (remove connected, add Try link)
[ ] Modify components/dashboard/tool-grid.tsx (remove SaaS items)
[ ] Modify components/dashboard/search-bar.tsx (remove SaaS category)
[ ] Modify app/dashboard/layout.tsx (add connections to pageTitles)
[ ] Modify app/dashboard/page.tsx (StatsRow + QuickActions)
[ ] Create components/dashboard/stats-row.tsx
[ ] Create components/dashboard/stat-card.tsx
[ ] Create components/dashboard/quick-actions.tsx
[ ] Create components/dashboard/usage-meter.tsx
[ ] Create components/dashboard/account-section.tsx
[ ] Create components/dashboard/danger-zone.tsx
[ ] Create components/ui/confirm-dialog.tsx
[ ] Update MOCK data: split tools vs connections
[ ] Verify all routes render correctly
[ ] Verify Agent page unchanged and functional
```

---

## 9. Anti-Patterns to Avoid

1. **Do NOT mix tools and connections on the same page.** That is the
   entire problem this redesign solves.

2. **Do NOT add status indicators to tools.** Tools are stateless.
   They do not have a "connected" or "disconnected" state.

3. **Do NOT put a search bar on the Connections page.** With 5-8
   connections, search adds complexity without value.

4. **Do NOT show connection management on the Agent page.** The Agent
   page is for execution, not configuration.

5. **Do NOT add categories/tabs to the Connections page.** Connections
   are a flat list. Categories create false hierarchy when there are
   fewer than 10 items.

---

## 10. Appendix: Current vs New Comparison

```
CURRENT STATE                          NEW STATE
=============                          =========

/dashboard (Home)                      /dashboard (Home)
  ApiKeyCard                             ApiKeyCard
  ToolGrid (ALL items, incl SaaS)        StatsRow (3 stat cards)
                                         QuickActions (4 links)

/dashboard/tools                       /dashboard/tools
  Table view                             Grid view (same as current cards)
  All/Available/Connected filters        Category-only filters
  SaaS mixed with PDF/Image/etc         No SaaS. Pure utility tools.
  "+ Connect" buttons on SaaS            "Try in Agent" links on all

(does not exist)                       /dashboard/connections
                                         Connection grid
                                         All/Connected/Available filter
                                         OAuth connect/disconnect flow

/dashboard/settings                    /dashboard/settings
  ApiKeyCard only                        ApiKeyCard
                                         AccountSection
                                         DangerZone

/dashboard/usage                       /dashboard/usage
  Plan cards only                        UsageMeter (progress bar)
                                         Plan cards

/agent                                 /agent
  (unchanged)                            (unchanged)
```
