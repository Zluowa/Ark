// @input: MediaInfo (smtc), spectrum bars, playback state
// @output: Compact music overlay for the Dynamic Island pill
// @position: Activity module; draw_compact used by render.rs Idle state overlay

use crate::core::smtc::MediaInfo;
use crate::ui::utils::{draw_visualizer, get_cached_media_image, get_media_palette};
use skia_safe::{Canvas, ClipOp, Color, Paint, RRect, Rect};
use skia_safe::{FilterMode, MipmapMode, SamplingOptions};

pub struct MusicSceneState {
    pub media: MediaInfo,
    pub spectrum: [f32; 6],
    pub is_playing: bool,
}

pub fn draw_compact(canvas: &Canvas, rect: Rect, state: &MusicSceneState, scale: f32) {
    let h = rect.height();
    let art_size = 20.0 * scale;
    let art_x = rect.left() + 8.0 * scale;
    let art_y = rect.top() + (h - art_size) / 2.0;
    draw_album_art(canvas, &state.media, art_x, art_y, art_size, art_size / 2.0);

    let viz_cx = rect.right() - 18.0 * scale;
    let viz_cy = rect.top() + h / 2.0;
    let palette = get_media_palette(&state.media);
    draw_visualizer(
        canvas,
        viz_cx,
        viz_cy,
        179,
        state.is_playing,
        &palette,
        &state.spectrum,
        0.55,
        0.45,
        (0.6, 0.08),
    );
}

fn draw_album_art(canvas: &Canvas, media: &MediaInfo, x: f32, y: f32, size: f32, corner: f32) {
    let art_rect = Rect::from_xywh(x, y, size, size);
    canvas.save();
    canvas.clip_rrect(
        RRect::new_rect_xy(art_rect, corner, corner),
        ClipOp::Intersect,
        true,
    );
    if let Some(image) = get_cached_media_image(media) {
        let mut p = Paint::default();
        p.set_anti_alias(true);
        let sampling = SamplingOptions::new(FilterMode::Linear, MipmapMode::Linear);
        canvas.draw_image_rect_with_sampling_options(&image, None, art_rect, sampling, &p);
    } else {
        let mut p = Paint::default();
        p.set_anti_alias(true);
        p.set_color(Color::from_rgb(60, 60, 60));
        canvas.draw_rect(art_rect, &p);
    }
    canvas.restore();
}
