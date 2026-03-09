use skia_safe::Color;
use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};
pub const COLOR_BG: Color = Color::from_rgb(28, 28, 30);
pub const COLOR_CARD: Color = Color::from_rgb(44, 44, 46);
pub const COLOR_CARD_HIGHLIGHT: Color = Color::from_rgb(63, 63, 66);
pub const COLOR_ACCENT: Color = Color::from_rgb(10, 132, 255);
pub const COLOR_TEXT_PRI: Color = Color::WHITE;
pub const COLOR_TEXT_SEC: Color = Color::from_rgb(142, 142, 147);
pub const COLOR_DANGER: Color = Color::from_rgb(255, 69, 58);
pub const COLOR_DISABLED: Color = Color::from_rgb(60, 60, 60);

pub fn get_island_border_weights(cx: i32, cy: i32, w: f32, h: f32) -> [f32; 4] {
    let screen_w = unsafe { GetSystemMetrics(SM_CXSCREEN) } as f32;
    let screen_h = unsafe { GetSystemMetrics(SM_CYSCREEN) } as f32;
    if screen_w <= 1.0 || screen_h <= 1.0 {
        return [0.0, 0.0, 0.0, 0.0];
    }

    let half_w = w * 0.5;
    let half_h = h * 0.5;
    let left = cx as f32 - half_w;
    let right = cx as f32 + half_w;
    let top = cy as f32 - half_h;
    let bottom = cy as f32 + half_h;

    let threshold = 120.0;
    let edge = |distance: f32| -> f32 { (1.0 - (distance / threshold)).clamp(0.0, 1.0) };

    let top_w = edge(top.max(0.0));
    let right_w = edge((screen_w - right).max(0.0));
    let bottom_w = edge((screen_h - bottom).max(0.0));
    let left_w = edge(left.max(0.0));

    [top_w, right_w, bottom_w, left_w]
}
