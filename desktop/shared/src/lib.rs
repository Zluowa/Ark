// @input: None (foundational crate)
// @output: IPC message types + Named Pipe transport + shared config
// @position: Shared kernel between WinIsland and Tauri processes

pub mod config;
pub mod ipc;
pub mod pipe;
