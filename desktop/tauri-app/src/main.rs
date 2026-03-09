// @input: Tauri runtime + omniagent-shared IPC
// @output: WebView window + IPC bridge to Island process
// @position: Main Tauri v2 desktop application entry point

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod ipc_bridge;
mod state;
mod window_mgr;

use state::IpcState;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(IpcState::new())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = ipc_bridge::run(handle).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::show_main_window,
            commands::send_to_island,
            commands::collapse_panel,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri app");
}
