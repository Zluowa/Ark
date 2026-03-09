// @input: omniagent-shared pipe server + IpcState sender channel
// @output: Routes Island messages to window actions + Tauri events
// @position: Bridge between Named Pipe and Tauri window/event system

use crate::{state::IpcState, window_mgr};
use omniagent_shared::ipc::{AiState, IslandToTauri, TauriToIsland};
use omniagent_shared::pipe::PipeServerHandle;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;

pub async fn run(app: AppHandle) -> std::io::Result<()> {
    loop {
        if let Err(e) = run_session(&app).await {
            eprintln!("[tauri-ipc] session ended: {e}, reconnecting in 1s...");
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
}

async fn run_session(app: &AppHandle) -> std::io::Result<()> {
    let mut server = PipeServerHandle::create().await?;
    println!("[tauri-ipc] pipe server ready, waiting for island...");
    server.wait_for_client().await?;
    println!("[tauri-ipc] island connected");

    let (tx, mut rx) = mpsc::channel::<TauriToIsland>(32);
    if let Some(state) = app.try_state::<IpcState>() {
        state.set_sender(tx).await;
    }

    loop {
        tokio::select! {
            result = server.recv::<IslandToTauri>() => {
                let msg = result?;
                handle_msg(app, &mut server, msg).await?;
            }
            Some(msg) = rx.recv() => {
                server.send(&msg).await?;
            }
        }
    }
}

async fn handle_msg(
    app: &AppHandle,
    server: &mut PipeServerHandle,
    msg: IslandToTauri,
) -> std::io::Result<()> {
    match msg {
        IslandToTauri::Ping { seq } => {
            server.send(&TauriToIsland::Pong { seq }).await?;
        }
        IslandToTauri::ExpandRequested => {
            window_mgr::show_and_focus(app);
            let _ = app.emit("island-expand", ());
            let _ = app.emit("focus-chat-input", ());
        }
        IslandToTauri::CollapseRequested => {
            window_mgr::hide(app);
            let _ = app.emit("island-collapse", ());
        }
        IslandToTauri::ToolSelected { tool_id } => {
            window_mgr::show_and_focus(app);
            let _ = app.emit("island-tool-selected", tool_id);
        }
        IslandToTauri::GlobalHotkeyPressed => {
            window_mgr::toggle(app);
            let _ = app.emit("island-hotkey", ());
        }
        IslandToTauri::ChatInputSubmitted { text } => {
            let _ = app.emit("island-chat-input", &text);
            if let Some(state) = app.try_state::<IpcState>() {
                let _ = state
                    .send(TauriToIsland::AiUpdate {
                        state: AiState::Thinking,
                        snippet: None,
                    })
                    .await;
            }
        }
        IslandToTauri::FileDropped { paths } => {
            eprintln!("[tauri-ipc] file dropped: {:?}", paths);
            window_mgr::show_and_focus(app);
            let _ = app.emit("island-file-dropped", paths);
            let _ = app.emit("focus-chat-input", ());
        }
        IslandToTauri::DragHovering { .. } => {
            // Island handles visual feedback; no window action needed
        }
        IslandToTauri::RequestToolGrid => {
            // Tool grid removed — send empty list to avoid client hang
            server
                .send(&TauriToIsland::ToolGridData { tools: vec![] })
                .await?;
        }
        IslandToTauri::LongPressExpand => {
            window_mgr::show_and_focus(app);
            let _ = app.emit("island-expand", ());
        }
        IslandToTauri::TapOpenApp => {
            window_mgr::show_and_focus(app);
            let _ = app.emit("island-tap-open", ());
        }
        IslandToTauri::NotificationAction { id, action } => {
            let _ = app.emit("island-notification-action", (id, action));
        }
    }
    Ok(())
}
