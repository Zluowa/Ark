// @input: None (pure data definitions)
// @output: IslandToTauri + TauriToIsland message enums covering all Live Activity scenarios
// @position: IPC protocol contract between Island (Skia) and Tauri (WebView) processes

use serde::{Deserialize, Serialize};

// === AI State ===
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiState {
    Idle,
    Thinking,
    Streaming,
    Complete,
    Error,
}

// === Activity Type: which Live Activity is displayed on the Island ===
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActivityType {
    Ai,
    Music,
    Notification,
    Tool,
    Voice,
    Timer,
}

// === Tool execution status ===
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolStatus {
    Running,
    Complete,
    Error,
}

// === Voice input/output state ===
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VoiceState {
    Recording,
    Recognizing,
    Speaking,
    Idle,
}

// === Tool grid item sent from Tauri to Island ===
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolGridItem {
    pub id: String,
    pub name: String,
    pub icon: String,         // lucide icon name
    pub accent_color: String, // hex color
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolMeta {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub accent_color: String,
}

// === Island → Tauri ===
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IslandToTauri {
    // --- kept (backward compatible) ---
    Ping { seq: u64 },
    ExpandRequested,
    CollapseRequested,
    ToolSelected { tool_id: String },
    ChatInputSubmitted { text: String },
    FileDropped { paths: Vec<String> },
    DragHovering { active: bool },
    GlobalHotkeyPressed,
    RequestToolGrid,
    // --- new gesture events ---
    LongPressExpand, // 500ms long-press → expand to Expanded state
    TapOpenApp,      // short tap → open Tauri main window
    NotificationAction { id: String, action: String }, // notification button clicked
}

// === Tauri → Island ===
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TauriToIsland {
    // --- kept (backward compatible) ---
    Pong {
        seq: u64,
    },
    Shutdown,
    FlashIsland,
    CollapsePanel,
    ToolGridData {
        tools: Vec<ToolGridItem>,
    },
    AiStateChanged {
        state: AiState,
    }, // kept for compat; prefer AiUpdate
    ChatSnippet {
        text: String,
    }, // kept for compat; prefer AiUpdate

    // --- unified AI update (replaces AiStateChanged + ChatSnippet) ---
    AiUpdate {
        state: AiState,
        snippet: Option<String>,
    },

    // --- notification ---
    ShowNotification {
        id: String,
        title: String,
        body: String,
        icon: Option<String>,
        ttl_ms: u64,
    },
    DismissNotification {
        id: String,
    },

    // --- tool execution progress ---
    ToolProgress {
        tool_id: String,
        name: String,
        icon: String,
        progress: f32,
        status: ToolStatus,
    },

    // --- voice ---
    VoiceUpdate {
        state: VoiceState,
        duration_ms: u64,
        waveform: Option<Vec<f32>>,
    },

    // --- timer / countdown ---
    TimerUpdate {
        label: String,
        remaining_ms: u64,
        total_ms: u64,
    },

    // --- multi-task split: declare which activities are active ---
    SetActivity {
        primary: ActivityType,
        secondary: Option<ActivityType>,
    },
}
