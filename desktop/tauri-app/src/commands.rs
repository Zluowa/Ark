// @input: Tauri invoke from WebView JS + IpcState for outbound pipe
// @output: Window management + island messaging commands
// @position: Tauri command handlers exposed to frontend

use crate::state::IpcState;
use omniagent_shared::ipc::TauriToIsland;
use serde_json::json;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn show_main_window(app: AppHandle) -> Result<(), String> {
    crate::window_mgr::show_and_focus(&app);
    Ok(())
}

#[tauri::command]
pub async fn send_to_island(app: AppHandle, msg: TauriToIsland) -> Result<(), String> {
    let state = app.state::<IpcState>();
    match state.send(msg.clone()).await {
        Ok(()) => Ok(()),
        Err(pipe_error) => send_http_fallback(&msg)
            .map_err(|http_error| format!("pipe={pipe_error}; http={http_error}")),
    }
}

#[tauri::command]
pub async fn collapse_panel(app: AppHandle) -> Result<(), String> {
    crate::window_mgr::hide(&app);
    let state = app.state::<IpcState>();
    match state.send(TauriToIsland::CollapsePanel).await {
        Ok(()) => Ok(()),
        Err(_) => send_http_fallback(&TauriToIsland::CollapsePanel),
    }
}

fn send_http_fallback(msg: &TauriToIsland) -> Result<(), String> {
    let Some(payload) = to_http_command(msg) else {
        return Err("unsupported message for HTTP fallback".to_string());
    };
    ureq::post("http://127.0.0.1:9800")
        .set("Content-Type", "application/json")
        .send_string(&payload.to_string())
        .map_err(format_ureq_error)?;
    Ok(())
}

fn to_http_command(msg: &TauriToIsland) -> Option<serde_json::Value> {
    match msg {
        TauriToIsland::AiUpdate { state, snippet } => Some(json!({
            "type": "ai_update",
            "state": serde_json::to_value(state).unwrap_or_else(|_| json!("idle")),
            "snippet": snippet,
        })),
        TauriToIsland::AiStateChanged { state } => Some(json!({
            "type": "ai_update",
            "state": serde_json::to_value(state).unwrap_or_else(|_| json!("idle")),
            "snippet": null,
        })),
        TauriToIsland::ChatSnippet { text } => Some(json!({
            "type": "ai_update",
            "state": "streaming",
            "snippet": text,
        })),
        TauriToIsland::ToolProgress {
            name,
            progress,
            status,
            ..
        } => Some(json!({
            "type": "tool_progress",
            "name": name,
            "progress": progress,
            "status": serde_json::to_value(status).unwrap_or_else(|_| json!("running")),
        })),
        TauriToIsland::CollapsePanel => Some(json!({ "type": "collapse" })),
        TauriToIsland::Shutdown => Some(json!({ "type": "shutdown" })),
        _ => None,
    }
}

fn format_ureq_error(err: ureq::Error) -> String {
    match err {
        ureq::Error::Status(code, resp) => {
            let body = resp.into_string().unwrap_or_default();
            if body.is_empty() {
                format!("http status {code}")
            } else {
                format!("http status {code}: {body}")
            }
        }
        ureq::Error::Transport(e) => e.to_string(),
    }
}
