// @input: BubbleState (phase + text + animation), canvas, pill rect
// @output: Floating response bubble rendered above the island pill
// @position: Independent render layer, drawn outside pill clip

use skia_safe::{Canvas, Color, FontStyle, Paint, RRect, Rect};

#[derive(Debug, Clone, PartialEq)]
#[allow(dead_code)]
pub enum BubblePhase {
    Hidden,
    Thinking,
    Streaming,
    Complete,
    Error,
    FadeOut,
}

pub struct BubbleState {
    pub phase: BubblePhase,
    pub text: String,
    pub opacity: f32,
    pub frame_count: u64,
    pub complete_at: Option<u64>,
}

impl Default for BubbleState {
    fn default() -> Self {
        Self {
            phase: BubblePhase::Hidden,
            text: String::new(),
            opacity: 0.0,
            frame_count: 0,
            complete_at: None,
        }
    }
}

impl BubbleState {
    #[allow(dead_code)]
    pub fn thinking() -> Self {
        Self {
            phase: BubblePhase::Thinking,
            text: String::new(),
            opacity: 1.0,
            frame_count: 0,
            complete_at: None,
        }
    }
    #[allow(dead_code)]
    pub fn streaming(text: String) -> Self {
        Self {
            phase: BubblePhase::Streaming,
            text,
            opacity: 1.0,
            frame_count: 0,
            complete_at: None,
        }
    }
    pub fn complete(text: String, frame: u64) -> Self {
        Self {
            phase: BubblePhase::Complete,
            text,
            opacity: 1.0,
            frame_count: 0,
            complete_at: Some(frame),
        }
    }
    pub fn error(text: String) -> Self {
        Self {
            phase: BubblePhase::Error,
            text,
            opacity: 1.0,
            frame_count: 0,
            complete_at: None,
        }
    }

    pub fn tick(&mut self, frame: u64) {
        self.frame_count += 1;
        match self.phase {
            BubblePhase::Complete => {
                if let Some(at) = self.complete_at {
                    if frame.saturating_sub(at) > 180 {
                        // 3 seconds at 60fps
                        self.phase = BubblePhase::FadeOut;
                    }
                }
            }
            BubblePhase::Error => {
                if self.frame_count > 180 {
                    self.phase = BubblePhase::FadeOut;
                }
            }
            BubblePhase::FadeOut => {
                self.opacity = (self.opacity - 0.03).max(0.0);
                if self.opacity < 0.01 {
                    self.phase = BubblePhase::Hidden;
                }
            }
            _ => {}
        }
    }
}

pub fn draw_bubble(canvas: &Canvas, pill_rect: Rect, bubble: &BubbleState, scale: f32) {
    let alpha = (bubble.opacity * 255.0) as u8;
    if alpha < 2 {
        return;
    }

    let bubble_w = pill_rect.width();
    let text_pad = 10.0 * scale;
    let max_text_w = bubble_w - text_pad * 2.0;
    let font_size = 11.0 * scale;

    let content_h = match bubble.phase {
        BubblePhase::Thinking => 24.0 * scale,
        _ => estimate_text_height(&bubble.text, font_size, max_text_w).max(20.0 * scale),
    };
    let bubble_h = content_h + text_pad * 2.0;
    let gap = 6.0 * scale;
    let bubble_rect = Rect::from_xywh(
        pill_rect.left(),
        pill_rect.top() - gap - bubble_h,
        bubble_w,
        bubble_h,
    );

    // Background
    let mut bg = Paint::default();
    bg.set_anti_alias(true);
    bg.set_color(Color::from_argb(alpha_scale(alpha, 0.9), 30, 30, 30));
    canvas.draw_rrect(
        RRect::new_rect_xy(bubble_rect, 12.0 * scale, 12.0 * scale),
        &bg,
    );

    match bubble.phase {
        BubblePhase::Thinking => {
            draw_thinking_dots(canvas, bubble_rect, alpha, scale, bubble.frame_count)
        }
        BubblePhase::Error => draw_text(
            canvas,
            &bubble.text,
            bubble_rect,
            text_pad,
            font_size,
            max_text_w,
            alpha_scale(alpha, 0.85),
            (255, 100, 100),
        ),
        _ => draw_text(
            canvas,
            &bubble.text,
            bubble_rect,
            text_pad,
            font_size,
            max_text_w,
            alpha,
            (255, 255, 255),
        ),
    }
}

fn draw_thinking_dots(canvas: &Canvas, rect: Rect, alpha: u8, scale: f32, frame: u64) {
    let cy = rect.center_y();
    let cx = rect.center_x();
    let spacing = 10.0 * scale;
    for i in 0..3u64 {
        let x = cx + (i as f32 - 1.0) * spacing;
        let bounce = (frame as f32 * 0.15 + i as f32 * 1.0).sin() * 3.0 * scale;
        let r = 3.0 * scale;
        let mut p = Paint::default();
        p.set_anti_alias(true);
        p.set_color(Color::from_argb(alpha_scale(alpha, 0.7), 255, 255, 255));
        canvas.draw_circle((x, cy + bounce), r, &p);
    }
}

fn draw_text(
    canvas: &Canvas,
    text: &str,
    rect: Rect,
    pad: f32,
    font_size: f32,
    max_w: f32,
    alpha: u8,
    rgb: (u8, u8, u8),
) {
    if text.is_empty() {
        return;
    }
    let mut paint = Paint::default();
    paint.set_anti_alias(true);
    paint.set_color(Color::from_argb(alpha, rgb.0, rgb.1, rgb.2));
    let x = rect.left() + pad;
    let y = rect.top() + pad + font_size;
    crate::ui::utils::draw_text_cached(
        canvas,
        text,
        (x, y),
        font_size,
        FontStyle::normal(),
        &paint,
        false,
        max_w,
    );
}

fn estimate_text_height(text: &str, font_size: f32, max_w: f32) -> f32 {
    if text.is_empty() {
        return font_size;
    }
    let char_w: f32 = text
        .chars()
        .map(|c| {
            if c.is_ascii() {
                font_size * 0.6
            } else {
                font_size
            }
        })
        .sum();
    let lines = (char_w / max_w).ceil().max(1.0).min(4.0);
    lines * font_size * 1.4
}

fn alpha_scale(base: u8, factor: f32) -> u8 {
    (base as f32 * factor) as u8
}
