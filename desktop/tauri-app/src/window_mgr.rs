// @input: Tauri AppHandle
// @output: Window show/hide/position/toggle utilities
// @position: Manages Tauri window — overlaps island pill for seamless expansion

use tauri::{AppHandle, Manager};

const ISLAND_TOP: i32 = 10; // matches island config.rs TOP_OFFSET
const PANEL_W: u32 = 380;

pub fn show_and_focus(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        position_at_island(app);
        let _ = win.show();
        let _ = win.set_focus();
    }
}

pub fn hide(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

pub fn toggle(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    match win.is_visible() {
        Ok(true) => hide(app),
        _ => show_and_focus(app),
    }
}

fn position_at_island(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let Ok(Some(monitor)) = win.primary_monitor() else {
        return;
    };
    let screen_w = monitor.size().width as i32;
    let x = (screen_w - PANEL_W as i32) / 2;
    let _ = win.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
        x,
        y: ISLAND_TOP,
    }));
}
