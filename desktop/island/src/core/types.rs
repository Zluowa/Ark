// @input: None (pure data definitions)
// @output: AiState, ToolStatus, VoiceState enums
// @position: Internal type definitions for pill content states

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiState {
    Idle,
    Thinking,
    Streaming,
    Complete,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolStatus {
    Running,
    Complete,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VoiceState {
    Recording,
    Recognizing,
    Speaking,
    Idle,
}
