// @input: None
// @output: SharedConfig with pipe name + API URL
// @position: Single source of truth for cross-process configuration

pub const PIPE_NAME: &str = r"\\.\pipe\omniagent-desktop";
pub const HEARTBEAT_INTERVAL_MS: u64 = 2000;
pub const MAX_MESSAGE_SIZE: usize = 1024 * 64; // 64 KB
