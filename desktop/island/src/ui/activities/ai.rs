// @input: AiState + frame_count + scale
// @output: Breathing dot animation (shared by Idle/Input/Thinking states)
// @position: Core visual element, called by render.rs

use crate::core::types::AiState;
use skia_safe::{Canvas, Color, Paint};

#[allow(dead_code)]
fn orb_params(ai: &AiState) -> (u8, u8, u8, f32, f32) {
    match ai {
        AiState::Idle => (200, 200, 200, 0.015, 0.06),
        AiState::Thinking => (59, 130, 246, 0.055, 0.35),
        AiState::Streaming => (59, 130, 246, 0.025, 0.20),
        AiState::Complete => (34, 197, 94, 0.035, 0.20),
        AiState::Error => (239, 68, 68, 0.070, 0.30),
    }
}

#[allow(dead_code)]
fn organic_breath(frame: u64, spd: f32) -> f32 {
    let f = frame as f32;
    let primary = (f * spd).sin();
    let secondary = (f * spd * 0.7).sin() * 0.3;
    (primary + secondary) / 1.3 * 0.5 + 0.5
}

/// Breathing dot — per-state color + alpha pulsing
#[allow(dead_code)]
pub fn draw_breathing_dot(canvas: &Canvas, x: f32, y: f32, r: f32, ai: &AiState, frame: u64) {
    let (cr, cg, cb, spd, amp) = orb_params(ai);
    let breath = organic_breath(frame, spd);
    let (lo, hi): (f32, f32) = match ai {
        AiState::Idle => (40.0, 60.0),
        AiState::Thinking => (100.0, 220.0),
        AiState::Streaming => (180.0, 220.0),
        AiState::Complete => (200.0, 240.0),
        AiState::Error => (140.0, 220.0),
    };
    let a = (lo + breath * (hi - lo)) as u8;
    let mut p = Paint::default();
    p.set_anti_alias(true);
    p.set_color(Color::from_argb(a, cr, cg, cb));
    canvas.draw_circle((x, y), r * (1.0 + breath * amp), &p);
}
