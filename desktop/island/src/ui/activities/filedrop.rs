// @input: FileDropSceneState (phase, file info, timing), canvas, scale
// @output: Island文件拖拽感知→悬停→吸入→缩略图预览 全过程分层动画渲染
// @position: ui/activities层，文件拖拽场景 — 灵动岛作为"一切入口"的核心体验

use crate::ui::utils::draw_text_cached;
use skia_safe::{
    image_filters, Canvas, ClipOp, Color, Data, FilterMode, Image, MipmapMode, Paint, PathBuilder,
    Point, RRect, Rect, SamplingOptions,
};
use std::path::Path as FsPath;

// ---- 颜色常量 ----
const COLOR_GLOW_BLUE: Color = Color::from_argb(60, 59, 130, 246);

// ---- 动画时长常量 ----
const ABSORB_DURATION_FRAMES: u64 = 18; // 吸入动画 300ms @ 60fps
const PROCESS_HOLD_FRAMES: u64 = 150; // 预览停留 2.5s @ 60fps

// ---- 文件类型数据表 ----
const IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "png", "gif", "bmp", "webp", "ico", "svg"];

/// (前缀列表, RGB颜色) — 按匹配优先级排列，无需 if-else
const EXT_COLOR_TABLE: &[(&[&str], (u8, u8, u8))] = &[
    (&["pdf"], (229, 57, 53)),                         // red
    (&["mp4", "mov", "avi", "mkv"], (142, 36, 170)),   // purple
    (&["mp3", "wav", "flac", "aac"], (0, 137, 123)),   // teal
    (&["zip", "rar", "7z", "tar"], (244, 81, 30)),     // orange
    (&["js", "ts", "py", "rs", "go"], (30, 136, 229)), // blue
    (&["doc", "docx", "txt", "md"], (84, 110, 122)),   // gray-blue
];

pub fn file_ext_color(ext: &str) -> (u8, u8, u8) {
    EXT_COLOR_TABLE
        .iter()
        .find(|(exts, _)| exts.contains(&ext))
        .map(|(_, rgb)| *rgb)
        .unwrap_or((117, 117, 117)) // default gray
}

// ---- 状态机 ----

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DropPhase {
    Idle,
    #[allow(dead_code)]
    Sensing,
    Hovering,
    Absorbing,
    Processing,
}

pub struct FileDropSceneState {
    pub phase: DropPhase,
    pub file_count: usize,
    pub phase_start_frame: u64,
    pub frame_count: u64,
    pub file_name: String,
    pub file_ext: String,
    pub thumbnail: Option<Image>,
}

impl FileDropSceneState {
    pub fn new() -> Self {
        Self {
            phase: DropPhase::Idle,
            file_count: 0,
            phase_start_frame: 0,
            frame_count: 0,
            file_name: String::new(),
            file_ext: String::new(),
            thumbnail: None,
        }
    }

    pub fn phase_elapsed(&self) -> u64 {
        self.frame_count.saturating_sub(self.phase_start_frame)
    }

    pub fn absorb_progress(&self) -> f32 {
        (self.phase_elapsed() as f32 / ABSORB_DURATION_FRAMES as f32).clamp(0.0, 1.0)
    }

    pub fn absorb_done(&self) -> bool {
        self.phase == DropPhase::Absorbing && self.phase_elapsed() >= ABSORB_DURATION_FRAMES
    }

    pub fn process_done(&self) -> bool {
        self.phase == DropPhase::Processing && self.phase_elapsed() >= PROCESS_HOLD_FRAMES
    }

    pub fn set_dropped_file(&mut self, path: &str) {
        let p = FsPath::new(path);
        self.file_name = p
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        self.file_ext = p
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        self.file_count += 1;
        self.thumbnail = if IMAGE_EXTS.contains(&self.file_ext.as_str()) {
            load_thumbnail(path)
        } else {
            None
        };
    }

    pub fn transition_to(&mut self, phase: DropPhase, frame: u64) {
        if phase == DropPhase::Hovering && self.phase == DropPhase::Idle {
            self.file_count = 0;
            self.file_name.clear();
            self.file_ext.clear();
            self.thumbnail = None;
        }
        self.phase = phase;
        self.phase_start_frame = frame;
    }

    pub fn tick(&mut self, frame: u64) {
        self.frame_count = frame;
        if self.absorb_done() {
            self.transition_to(DropPhase::Processing, frame);
        } else if self.process_done() {
            self.phase = DropPhase::Idle;
            self.file_name.clear();
            self.file_ext.clear();
            self.thumbnail = None;
            self.file_count = 0;
        }
    }
}

fn load_thumbnail(path: &str) -> Option<Image> {
    let bytes = std::fs::read(path).ok()?;
    Image::from_encoded(Data::new_copy(&bytes))
}

// ---- 主入口 ----

pub fn draw_drop_overlay(canvas: &Canvas, rect: Rect, state: &FileDropSceneState, scale: f32) {
    match state.phase {
        DropPhase::Idle => {}
        DropPhase::Sensing => draw_sensing(canvas, rect, scale),
        DropPhase::Hovering => draw_hovering(canvas, rect, state, scale),
        DropPhase::Absorbing => draw_absorbing(canvas, rect, state, scale),
        DropPhase::Processing => draw_processing(canvas, rect, state, scale),
    }
}

// ---- 阶段渲染 ----

fn draw_sensing(canvas: &Canvas, rect: Rect, scale: f32) {
    draw_glow(canvas, rect, scale, 0.15, COLOR_GLOW_BLUE);
}

fn draw_hovering(canvas: &Canvas, rect: Rect, state: &FileDropSceneState, scale: f32) {
    let breath = (state.phase_elapsed() as f32 * 0.08).sin() * 0.5 + 0.5;
    draw_drop_glow(canvas, rect, scale, breath);
}

fn draw_absorbing(canvas: &Canvas, rect: Rect, state: &FileDropSceneState, scale: f32) {
    let p = state.absorb_progress();
    draw_drop_glow(canvas, rect, scale, 1.0 - p);
    if p > 0.5 {
        let thumb_alpha = (((p - 0.5) / 0.5) * 255.0) as u8;
        draw_file_preview(canvas, rect, state, scale, thumb_alpha, 0.0);
    }
    if p > 0.7 {
        draw_center_flash(canvas, rect, scale, (p - 0.7) / 0.3);
    }
}

fn draw_processing(canvas: &Canvas, rect: Rect, state: &FileDropSceneState, scale: f32) {
    let elapsed = state.phase_elapsed();
    // 残留辉光在最初20帧消散
    let glow_fade = (1.0 - elapsed as f32 / 20.0).max(0.0);
    if glow_fade > 0.0 {
        draw_glow(canvas, rect, scale, glow_fade * 0.3, COLOR_GLOW_BLUE);
    }
    // 内容在最后30帧淡出
    let alpha = if elapsed < PROCESS_HOLD_FRAMES - 30 {
        255u8
    } else {
        let t = (PROCESS_HOLD_FRAMES - elapsed) as f32 / 30.0;
        (t * 255.0).clamp(0.0, 255.0) as u8
    };
    // checkmark 在 800ms (48帧) 后开始绘制
    let check_progress = if elapsed > 48 {
        ((elapsed - 48) as f32 / 20.0).clamp(0.0, 1.0)
    } else {
        0.0
    };
    draw_file_preview(canvas, rect, state, scale, alpha, check_progress);
}

// ---- 文件预览（图片或彩色图标 + 文件名 + 状态）----

fn draw_file_preview(
    canvas: &Canvas,
    rect: Rect,
    state: &FileDropSceneState,
    scale: f32,
    alpha: u8,
    check_progress: f32,
) {
    let cx = rect.center_x();
    let cy = rect.center_y();
    let thumb_size = 32.0 * scale;
    let thumb_cy = cy - 8.0 * scale;

    match &state.thumbnail {
        Some(img) => draw_thumbnail(canvas, img, cx, thumb_cy, thumb_size, alpha),
        None => draw_ext_badge(canvas, cx, thumb_cy, thumb_size, &state.file_ext, alpha),
    }

    if !state.file_name.is_empty() {
        draw_file_name(
            canvas,
            rect,
            cx,
            thumb_cy + thumb_size * 0.5 + 10.0 * scale,
            &state.file_name,
            scale,
            alpha,
        );
    }
    if check_progress > 0.0 {
        let check_cx = cx + 18.0 * scale;
        let check_cy = thumb_cy - 18.0 * scale;
        draw_checkmark(canvas, check_cx, check_cy, scale, check_progress, alpha);
    }
}

fn draw_file_name(canvas: &Canvas, rect: Rect, cx: f32, y: f32, name: &str, scale: f32, alpha: u8) {
    let mut paint = Paint::default();
    paint.set_anti_alias(true);
    paint.set_color(Color::from_argb(alpha, 255, 255, 255));
    draw_text_cached(
        canvas,
        name,
        (cx, y),
        10.0 * scale,
        skia_safe::FontStyle::normal(),
        &paint,
        true,
        rect.width() - 32.0 * scale,
    );
}

// ---- 非图片文件彩色徽章 ----

fn draw_ext_badge(canvas: &Canvas, cx: f32, cy: f32, size: f32, ext: &str, alpha: u8) {
    let (r, g, b) = file_ext_color(ext);
    let rect = Rect::from_xywh(cx - size / 2.0, cy - size / 2.0, size, size);
    let corner = size * 0.15;
    let mut fill = Paint::default();
    fill.set_anti_alias(true);
    fill.set_color(Color::from_argb(alpha, r, g, b));
    canvas.draw_round_rect(rect, corner, corner, &fill);

    let label = ext.to_uppercase();
    let mut tp = Paint::default();
    tp.set_anti_alias(true);
    tp.set_color(Color::from_argb(alpha, 255, 255, 255));
    let font_size = (size * 0.22).max(8.0);
    draw_text_cached(
        canvas,
        &label,
        (cx, cy + font_size * 0.35),
        font_size,
        skia_safe::FontStyle::bold(),
        &tp,
        true,
        size - 4.0,
    );
}

// ---- 缩略图（圆角裁剪 + 微妙边框）----

fn draw_thumbnail(canvas: &Canvas, img: &Image, cx: f32, cy: f32, size: f32, alpha: u8) {
    let dst = Rect::from_xywh(cx - size / 2.0, cy - size / 2.0, size, size);
    let corner = size * 0.15;
    let mut p = Paint::default();
    p.set_anti_alias(true);
    p.set_alpha(alpha);
    canvas.save();
    canvas.clip_rrect(
        RRect::new_rect_xy(dst, corner, corner),
        ClipOp::Intersect,
        true,
    );
    let sampling = SamplingOptions::new(FilterMode::Linear, MipmapMode::Linear);
    canvas.draw_image_rect_with_sampling_options(img, None, dst, sampling, &p);
    canvas.restore();
    let mut bp = Paint::default();
    bp.set_anti_alias(true);
    bp.set_color(Color::from_argb(alpha / 3, 255, 255, 255));
    bp.set_style(skia_safe::paint::Style::Stroke);
    bp.set_stroke_width(0.5);
    canvas.draw_round_rect(dst, corner, corner, &bp);
}

// ---- checkmark 动画（绿圆 + 勾路径 stroke 动画）----

fn draw_checkmark(canvas: &Canvas, cx: f32, cy: f32, scale: f32, progress: f32, alpha: u8) {
    let r = 8.0 * scale;
    let effective_alpha = ((alpha as f32) * progress).clamp(0.0, 255.0) as u8;

    // 绿色背景圆
    let mut circle_p = Paint::default();
    circle_p.set_anti_alias(true);
    circle_p.set_color(Color::from_argb(effective_alpha, 34, 197, 94));
    canvas.draw_circle((cx, cy), r, &circle_p);

    // checkmark 路径
    let s = scale;
    let mut pb = PathBuilder::new();
    pb.move_to(Point::new(cx - 4.0 * s, cy));
    pb.line_to(Point::new(cx - 1.0 * s, cy + 3.0 * s));
    pb.line_to(Point::new(cx + 5.0 * s, cy - 3.0 * s));
    let path = pb.snapshot();

    let mut stroke_p = Paint::default();
    stroke_p.set_anti_alias(true);
    stroke_p.set_color(Color::from_argb(effective_alpha, 255, 255, 255));
    stroke_p.set_style(skia_safe::paint::Style::Stroke);
    stroke_p.set_stroke_width(1.5 * scale);
    stroke_p.set_stroke_cap(skia_safe::paint::Cap::Round);
    stroke_p.set_stroke_join(skia_safe::paint::Join::Round);
    canvas.draw_path(&path, &stroke_p);
}

// ---- 发光效果（保持原有实现）----

fn draw_drop_glow(canvas: &Canvas, rect: Rect, scale: f32, intensity: f32) {
    let alpha = (40.0 + intensity * 40.0).clamp(0.0, 255.0) as u8;
    draw_glow(
        canvas,
        rect,
        scale,
        intensity,
        Color::from_argb(alpha, 59, 130, 246),
    );
    let mut paint = Paint::default();
    paint.set_anti_alias(true);
    paint.set_color(Color::from_argb((intensity * 120.0) as u8, 59, 130, 246));
    paint.set_style(skia_safe::paint::Style::Stroke);
    paint.set_stroke_width(1.5 * scale);
    let r = rect.height() / 2.0;
    canvas.draw_rrect(RRect::new_rect_xy(rect, r, r), &paint);
}

fn draw_glow(canvas: &Canvas, rect: Rect, scale: f32, intensity: f32, base_color: Color) {
    let mut paint = Paint::default();
    paint.set_anti_alias(true);
    let alpha = (base_color.a() as f32 * intensity).clamp(0.0, 255.0) as u8;
    paint.set_color(Color::from_argb(
        alpha,
        base_color.r(),
        base_color.g(),
        base_color.b(),
    ));
    paint.set_style(skia_safe::paint::Style::Stroke);
    paint.set_stroke_width(2.5 * scale);
    if let Some(blur) = image_filters::blur((4.0 * scale, 4.0 * scale), None, None, None) {
        paint.set_image_filter(blur);
    }
    let r = rect.height() / 2.0;
    canvas.draw_rrect(RRect::new_rect_xy(rect, r, r), &paint);
}

fn draw_center_flash(canvas: &Canvas, rect: Rect, scale: f32, intensity: f32) {
    let mut paint = Paint::default();
    paint.set_anti_alias(true);
    paint.set_color(Color::from_argb((intensity * 180.0) as u8, 120, 180, 255));
    if let Some(blur) = image_filters::blur((8.0 * scale, 8.0 * scale), None, None, None) {
        paint.set_image_filter(blur);
    }
    canvas.draw_circle((rect.center_x(), rect.center_y()), 12.0 * scale, &paint);
}
