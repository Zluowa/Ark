use crate::core::config::{AppConfig, APP_AUTHOR, APP_HOMEPAGE, APP_VERSION};
use crate::core::persistence::save_config;
use crate::utils::color::*;
use skia_safe::{surfaces, Color, Font, FontMgr, FontStyle, Paint, Rect};
use softbuffer::{Context, Surface};
use std::sync::Arc;
use std::time::Duration;
use windows::core::w;
use windows::Win32::System::Threading::{OpenMutexW, MUTEX_ALL_ACCESS};
use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::{ElementState, MouseButton, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::window::{Window, WindowId};
const SETTINGS_W: f32 = 400.0;
const SETTINGS_H: f32 = 550.0;
use crate::utils::icon::get_app_icon;
pub struct SettingsApp {
    window: Option<Arc<Window>>,
    surface: Option<Surface<Arc<Window>, Arc<Window>>>,
    config: AppConfig,
    active_tab: usize,
    border_switch_pos: f32,
    blur_switch_pos: f32,
    logical_mouse_pos: (f32, f32),
    font_mgr: FontMgr,
    frame_count: u64,
}
impl SettingsApp {
    pub fn new(config: AppConfig) -> Self {
        let initial_border = if config.adaptive_border { 1.0 } else { 0.0 };
        let initial_blur = if config.motion_blur { 1.0 } else { 0.0 };
        Self {
            window: None,
            surface: None,
            config,
            active_tab: 0,
            border_switch_pos: initial_border,
            blur_switch_pos: initial_blur,
            logical_mouse_pos: (0.0, 0.0),
            font_mgr: FontMgr::new(),
            frame_count: 0,
        }
    }
    fn get_font(&self, size: f32, bold: bool) -> Font {
        let style = if bold {
            FontStyle::bold()
        } else {
            FontStyle::normal()
        };
        if let Some(path) = &self.config.custom_font_path {
            if let Ok(data) = std::fs::read(path) {
                if let Some(tf) = self.font_mgr.new_from_data(&data, None) {
                    return Font::from_typeface(tf, size);
                }
            }
        }
        let typeface = self
            .font_mgr
            .match_family_style("Segoe UI", style)
            .unwrap_or_else(|| self.font_mgr.legacy_make_typeface(None, style).unwrap());
        Font::from_typeface(typeface, size)
    }
    fn draw(&mut self) {
        let win = self.window.as_ref().unwrap();
        let scale = win.scale_factor() as f32;
        let p_w = (SETTINGS_W * scale) as i32;
        let p_h = (SETTINGS_H * scale) as i32;
        if p_w <= 0 || p_h <= 0 {
            return;
        }
        let mut sk_surface = surfaces::raster_n32_premul(skia_safe::ISize::new(p_w, p_h)).unwrap();
        let canvas = sk_surface.canvas();
        canvas.clear(COLOR_BG);
        canvas.scale((scale, scale));
        self.draw_tabs(canvas);
        if self.active_tab == 0 {
            self.draw_general(canvas);
        } else {
            self.draw_about(canvas);
        }
        if let Some(surface) = self.surface.as_mut() {
            let mut buffer = surface.buffer_mut().unwrap();
            let info = skia_safe::ImageInfo::new(
                skia_safe::ISize::new(p_w, p_h),
                skia_safe::ColorType::BGRA8888,
                skia_safe::AlphaType::Premul,
                None,
            );
            let dst_row_bytes = (p_w * 4) as usize;
            let u8_buffer: &mut [u8] = bytemuck::cast_slice_mut(&mut *buffer);
            let _ = sk_surface.read_pixels(&info, u8_buffer, dst_row_bytes, (0, 0));
            buffer.present().unwrap();
        }
    }
    fn draw_tabs(&self, canvas: &skia_safe::Canvas) {
        let font = self.get_font(14.0, true);
        let mut paint = Paint::default();
        paint.set_anti_alias(true);
        let center_x = SETTINGS_W / 2.0;
        let tabs = ["General", "About"];
        paint.set_color(COLOR_CARD);
        canvas.draw_round_rect(
            Rect::from_xywh(center_x - 85.0, 20.0, 170.0, 36.0),
            10.0,
            10.0,
            &paint,
        );
        for (i, label) in tabs.iter().enumerate() {
            let bx = center_x - 82.0 + (i as f32 * 82.0);
            if self.active_tab == i {
                paint.set_color(COLOR_CARD_HIGHLIGHT);
                canvas.draw_round_rect(Rect::from_xywh(bx, 23.0, 80.0, 30.0), 8.0, 8.0, &paint);
                paint.set_color(COLOR_TEXT_PRI);
            } else {
                paint.set_color(COLOR_TEXT_SEC);
            }
            let (_, rect) = font.measure_str(label, None);
            canvas.draw_str(
                label,
                (bx + (80.0 - rect.width()) / 2.0, 43.0),
                &font,
                &paint,
            );
        }
    }
    fn draw_general(&self, canvas: &skia_safe::Canvas) {
        let font = self.get_font(14.0, false);
        let mut paint = Paint::default();
        paint.set_anti_alias(true);
        let items = [("Global Scale", format!("{:.2}", self.config.global_scale))];
        let start_y = 90.0;
        for (i, (label, val)) in items.iter().enumerate() {
            let y = start_y + (i as f32 * 50.0);
            paint.set_color(COLOR_CARD);
            canvas.draw_round_rect(
                Rect::from_xywh(20.0, y - 5.0, SETTINGS_W - 40.0, 42.0),
                10.0,
                10.0,
                &paint,
            );
            paint.set_color(COLOR_TEXT_PRI);
            canvas.draw_str(label, (35.0, y + 21.0), &font, &paint);
            self.draw_button(canvas, 270.0, y + 2.0, "-");
            paint.set_color(COLOR_TEXT_PRI);
            let (_, rect) = font.measure_str(&val, None);
            canvas.draw_str(&val, (325.0 - rect.width() / 2.0, y + 21.0), &font, &paint);
            self.draw_button(canvas, 345.0, y + 2.0, "+");
        }
        let sw_border_y = start_y + (items.len() as f32 * 50.0) + 10.0;
        paint.set_color(COLOR_CARD);
        canvas.draw_round_rect(
            Rect::from_xywh(20.0, sw_border_y - 5.0, SETTINGS_W - 40.0, 42.0),
            10.0,
            10.0,
            &paint,
        );
        paint.set_color(COLOR_TEXT_PRI);
        canvas.draw_str("Adaptive Border", (35.0, sw_border_y + 21.0), &font, &paint);
        self.draw_switch(canvas, 326.0, sw_border_y + 3.0, self.border_switch_pos);
        let sw_blur_y = sw_border_y + 50.0;
        paint.set_color(COLOR_CARD);
        canvas.draw_round_rect(
            Rect::from_xywh(20.0, sw_blur_y - 5.0, SETTINGS_W - 40.0, 42.0),
            10.0,
            10.0,
            &paint,
        );
        paint.set_color(COLOR_TEXT_PRI);
        canvas.draw_str("Motion Blur", (35.0, sw_blur_y + 21.0), &font, &paint);
        self.draw_switch(canvas, 326.0, sw_blur_y + 3.0, self.blur_switch_pos);

        let font_y = sw_blur_y + 50.0;
        paint.set_color(COLOR_CARD);
        canvas.draw_round_rect(
            Rect::from_xywh(20.0, font_y - 5.0, SETTINGS_W - 40.0, 42.0),
            10.0,
            10.0,
            &paint,
        );
        paint.set_color(COLOR_TEXT_PRI);
        canvas.draw_str("Custom Font", (35.0, font_y + 21.0), &font, &paint);
        self.draw_text_button(canvas, 310.0, font_y + 3.0, 65.0, 26.0, "Select");
        if self.config.custom_font_path.is_some() {
            self.draw_text_button_danger(canvas, 235.0, font_y + 3.0, 65.0, 26.0, "Reset");
        }

        let download_y = font_y + 50.0;
        paint.set_color(COLOR_CARD);
        canvas.draw_round_rect(
            Rect::from_xywh(20.0, download_y - 5.0, SETTINGS_W - 40.0, 42.0),
            10.0,
            10.0,
            &paint,
        );
        paint.set_color(COLOR_TEXT_PRI);
        canvas.draw_str("Download Folder", (35.0, download_y + 21.0), &font, &paint);
        self.draw_text_button(canvas, 310.0, download_y + 3.0, 65.0, 26.0, "Select");
        self.draw_text_button_danger(canvas, 235.0, download_y + 3.0, 65.0, 26.0, "Default");

        let path_preview = shorten_path(&self.config.download_dir, 40);
        paint.set_color(COLOR_TEXT_SEC);
        canvas.draw_str(&path_preview, (35.0, download_y + 56.0), &font, &paint);

        paint.set_color(COLOR_DANGER);
        let reset_str = "Reset to Defaults";
        let (_, rect) = font.measure_str(reset_str, None);
        canvas.draw_str(
            reset_str,
            ((SETTINGS_W - rect.width()) / 2.0, SETTINGS_H - 40.0),
            &font,
            &paint,
        );
    }
    fn draw_text_button_danger(
        &self,
        canvas: &skia_safe::Canvas,
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        label: &str,
    ) {
        let mut paint = Paint::default();
        paint.set_anti_alias(true);
        paint.set_color(COLOR_CARD_HIGHLIGHT);
        canvas.draw_round_rect(Rect::from_xywh(x, y, w, h), h / 2.0, h / 2.0, &paint);
        let font = self.get_font(12.0, true);
        paint.set_color(COLOR_DANGER);
        let (_, rect) = font.measure_str(label, None);
        canvas.draw_str(
            label,
            (x + (w - rect.width()) / 2.0, y + 17.0),
            &font,
            &paint,
        );
    }
    fn draw_text_button(
        &self,
        canvas: &skia_safe::Canvas,
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        label: &str,
    ) {
        let mut paint = Paint::default();
        paint.set_anti_alias(true);
        paint.set_color(COLOR_CARD_HIGHLIGHT);
        canvas.draw_round_rect(Rect::from_xywh(x, y, w, h), h / 2.0, h / 2.0, &paint);
        let font = self.get_font(12.0, true);
        paint.set_color(COLOR_TEXT_PRI);
        let (_, rect) = font.measure_str(label, None);
        canvas.draw_str(
            label,
            (x + (w - rect.width()) / 2.0, y + 17.0),
            &font,
            &paint,
        );
    }
    fn draw_button(&self, canvas: &skia_safe::Canvas, x: f32, y: f32, label: &str) {
        let mut paint = Paint::default();
        paint.set_anti_alias(true);
        paint.set_color(COLOR_CARD_HIGHLIGHT);
        canvas.draw_round_rect(Rect::from_xywh(x, y, 28.0, 28.0), 14.0, 14.0, &paint);
        paint.set_color(COLOR_TEXT_PRI);
        let font = self.get_font(20.0, false);
        let (_, rect) = font.measure_str(label, None);
        canvas.draw_str(
            label,
            (x + (28.0 - rect.width()) / 2.0, y + 20.0),
            &font,
            &paint,
        );
    }
    fn draw_switch(&self, canvas: &skia_safe::Canvas, x: f32, y: f32, pos: f32) {
        let mut paint = Paint::default();
        paint.set_anti_alias(true);
        let color_off = COLOR_CARD_HIGHLIGHT;
        let color_on = COLOR_ACCENT;
        let r = color_off.r() as f32 + (color_on.r() as f32 - color_off.r() as f32) * pos;
        let g = color_off.g() as f32 + (color_on.g() as f32 - color_off.g() as f32) * pos;
        let b = color_off.b() as f32 + (color_on.b() as f32 - color_off.b() as f32) * pos;
        paint.set_color(Color::from_rgb(r as u8, g as u8, b as u8));
        canvas.draw_round_rect(Rect::from_xywh(x, y, 48.0, 26.0), 13.0, 13.0, &paint);
        paint.set_color(Color::WHITE);
        canvas.draw_round_rect(
            Rect::from_xywh(x + 2.0 + (pos * 22.0), y + 2.0, 22.0, 22.0),
            11.0,
            11.0,
            &paint,
        );
    }
    fn draw_about(&self, canvas: &skia_safe::Canvas) {
        let mut paint = Paint::default();
        paint.set_anti_alias(true);
        paint.set_color(COLOR_TEXT_PRI);
        let font_title = self.get_font(28.0, true);
        let (_, rect1) = font_title.measure_str("WinIsland", None);
        canvas.draw_str(
            "WinIsland",
            ((SETTINGS_W - rect1.width()) / 2.0, 160.0),
            &font_title,
            &paint,
        );
        let font_norm = self.get_font(14.0, false);
        paint.set_color(COLOR_TEXT_SEC);
        let v_str = format!("Version {}", APP_VERSION);
        let (_, rect2) = font_norm.measure_str(&v_str, None);
        canvas.draw_str(
            &v_str,
            ((SETTINGS_W - rect2.width()) / 2.0, 195.0),
            &font_norm,
            &paint,
        );
        let a_str = format!("Created by {}", APP_AUTHOR);
        let (_, rect3) = font_norm.measure_str(&a_str, None);
        canvas.draw_str(
            &a_str,
            ((SETTINGS_W - rect3.width()) / 2.0, 220.0),
            &font_norm,
            &paint,
        );
        paint.set_color(COLOR_ACCENT);
        let link_str = "Visit Project Homepage";
        let (_, rect4) = font_norm.measure_str(link_str, None);
        canvas.draw_str(
            link_str,
            ((SETTINGS_W - rect4.width()) / 2.0, 280.0),
            &font_norm,
            &paint,
        );
    }
    fn handle_click(&mut self) {
        let (mx, my) = self.logical_mouse_pos;
        let mut changed = false;
        let cx = SETTINGS_W / 2.0;
        if my >= 20.0 && my <= 56.0 {
            if mx >= cx - 85.0 && mx <= cx {
                self.active_tab = 0;
                changed = true;
            } else if mx >= cx && mx <= cx + 85.0 {
                self.active_tab = 1;
                changed = true;
            }
        }
        if self.active_tab == 0 {
            let sy = 90.0;
            self.check_btn(
                mx,
                my,
                270.0,
                sy,
                |c| c.global_scale = (c.global_scale - 0.05).max(0.5),
                &mut changed,
            );
            self.check_btn(
                mx,
                my,
                345.0,
                sy,
                |c| c.global_scale = (c.global_scale + 0.05).min(2.0),
                &mut changed,
            );
            // Switch positions match draw_general layout: 1 item → border at sy+60, blur at sy+110, font at sy+160
            let border_y = sy + 60.0;
            let blur_y = border_y + 50.0;
            let font_y = blur_y + 50.0;
            let download_y = font_y + 50.0;
            if mx >= 320.0 && mx <= 380.0 && my >= border_y && my <= border_y + 40.0 {
                self.config.adaptive_border = !self.config.adaptive_border;
                changed = true;
            }
            if mx >= 320.0 && mx <= 380.0 && my >= blur_y && my <= blur_y + 40.0 {
                self.config.motion_blur = !self.config.motion_blur;
                changed = true;
            }
            if mx >= 310.0 && mx <= 375.0 && my >= font_y && my <= font_y + 30.0 {
                if let Some(path) = rfd::FileDialog::new()
                    .add_filter("Fonts", &["ttf", "otf"])
                    .pick_file()
                {
                    self.config.custom_font_path = Some(path.to_string_lossy().into_owned());
                    changed = true;
                }
            }
            if self.config.custom_font_path.is_some()
                && mx >= 235.0
                && mx <= 300.0
                && my >= font_y
                && my <= font_y + 30.0
            {
                self.config.custom_font_path = None;
                changed = true;
            }
            if mx >= 310.0 && mx <= 375.0 && my >= download_y && my <= download_y + 30.0 {
                if let Some(path) = rfd::FileDialog::new().pick_folder() {
                    self.config.download_dir = path.to_string_lossy().into_owned();
                    changed = true;
                }
            }
            if mx >= 235.0 && mx <= 300.0 && my >= download_y && my <= download_y + 30.0 {
                self.config.download_dir = AppConfig::default().download_dir;
                changed = true;
            }
            if my >= SETTINGS_H - 60.0
                && my <= SETTINGS_H - 20.0
                && mx >= cx - 100.0
                && mx <= cx + 100.0
            {
                self.config = AppConfig::default();
                changed = true;
            }
        } else if my >= 260.0 && my <= 300.0 && mx >= cx - 100.0 && mx <= cx + 100.0 {
            let _ = open::that(APP_HOMEPAGE);
        }
        if changed {
            save_config(&self.config);
            if let Some(win) = &self.window {
                win.request_redraw();
            }
        }
    }
    fn check_btn<F>(&mut self, mx: f32, my: f32, bx: f32, by: f32, mut f: F, changed: &mut bool)
    where
        F: FnMut(&mut AppConfig),
    {
        if mx >= bx && mx <= bx + 28.0 && my >= by && my <= by + 28.0 {
            f(&mut self.config);
            self.config.global_scale = (self.config.global_scale * 100.0).round() / 100.0;
            *changed = true;
        }
    }
}

fn shorten_path(path: &str, max_chars: usize) -> String {
    if path.chars().count() <= max_chars {
        return path.to_string();
    }
    let keep = max_chars.saturating_sub(3) / 2;
    let start: String = path.chars().take(keep).collect();
    let end: String = path
        .chars()
        .rev()
        .take(keep)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    format!("{start}...{end}")
}

impl ApplicationHandler for SettingsApp {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        let attrs = Window::default_attributes()
            .with_title("Settings")
            .with_inner_size(LogicalSize::new(SETTINGS_W as f64, SETTINGS_H as f64))
            .with_resizable(false)
            .with_window_icon(get_app_icon());
        let window = Arc::new(event_loop.create_window(attrs).unwrap());
        self.window = Some(window.clone());
        let context = Context::new(window.clone()).unwrap();
        let mut surface = Surface::new(&context, window.clone()).unwrap();
        let scale = window.scale_factor();
        surface
            .resize(
                std::num::NonZeroU32::new((SETTINGS_W as f64 * scale) as u32).unwrap(),
                std::num::NonZeroU32::new((SETTINGS_H as f64 * scale) as u32).unwrap(),
            )
            .unwrap();
        self.surface = Some(surface);
    }
    fn window_event(&mut self, _el: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => _el.exit(),
            WindowEvent::CursorMoved { position, .. } => {
                let scale = self.window.as_ref().unwrap().scale_factor() as f32;
                self.logical_mouse_pos = (position.x as f32 / scale, position.y as f32 / scale);
            }
            WindowEvent::MouseInput {
                state: ElementState::Pressed,
                button: MouseButton::Left,
                ..
            } => self.handle_click(),
            WindowEvent::RedrawRequested => self.draw(),
            _ => (),
        }
    }
    fn about_to_wait(&mut self, _el: &ActiveEventLoop) {
        if let Some(win) = &self.window {
            self.frame_count += 1;
            if self.frame_count % 60 == 0 {
                unsafe {
                    let h = OpenMutexW(
                        MUTEX_ALL_ACCESS,
                        false,
                        w!("Global\\WinIsland_SingleInstance_Mutex"),
                    );
                    if h.is_err() {
                        _el.exit();
                        return;
                    }
                    let _ = windows::Win32::Foundation::CloseHandle(h.unwrap());
                }
            }
            let mut redraw = false;
            let tb = if self.config.adaptive_border {
                1.0
            } else {
                0.0
            };
            if (tb - self.border_switch_pos).abs() > 0.01 {
                self.border_switch_pos += (tb - self.border_switch_pos) * 0.2;
                redraw = true;
            }
            let tbu = if self.config.motion_blur { 1.0 } else { 0.0 };
            if (tbu - self.blur_switch_pos).abs() > 0.01 {
                self.blur_switch_pos += (tbu - self.blur_switch_pos) * 0.2;
                redraw = true;
            }
            if redraw {
                win.request_redraw();
            }
            std::thread::sleep(Duration::from_millis(16));
        }
    }
}
pub fn run_settings(config: AppConfig) {
    let el = EventLoop::new().unwrap();
    let mut app = SettingsApp::new(config);
    el.run_app(&mut app).unwrap();
}
