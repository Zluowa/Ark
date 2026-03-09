// @input: softbuffer Surface, spring dimensions, PillState, content data
// @output: Skia-rendered pill frame written to pixel buffer
// @position: Single draw call per frame; owns the Skia surface cache

use crate::core::config::{
    FocusCompletionKind, FocusPhase, ImageEditBrushMode, ImageEditTool, ImageMaskStroke,
    ImageOutpaintPreset, PillState, IMAGE_EDIT_ACTION_HEIGHT, IMAGE_EDIT_ACTION_TOP,
    IMAGE_EDIT_CANVAS_BOTTOM_GAP, IMAGE_EDIT_CANVAS_SIDE_PADDING, IMAGE_EDIT_CANVAS_TOP,
    IMAGE_EDIT_PROMPT_HEIGHT, IMAGE_EDIT_PROMPT_TOP, PADDING,
};
use crate::core::music_client::MusicSearchResult;
use crate::core::types::AiState;
use crate::ui::activities::filedrop::DropPhase;
use crate::ui::activities::{filedrop, music};
use crate::ui::bubble::{self, BubblePhase, BubbleState};
use skia_safe::{
    gradient_shader, image_filters, surfaces, Canvas, ClipOp, Color, FontStyle, ISize, Image,
    Paint, PaintStyle, PathBuilder, Point, RRect, Rect, Surface as SkSurface, TileMode,
};
use softbuffer::Surface;
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Arc;
use winit::window::Window;

thread_local! {
    static SK_SURFACE: RefCell<Option<SkSurface>> = RefCell::new(None);
}

/// All data needed to render one frame
#[allow(dead_code)]
pub struct FrameData<'a> {
    pub pill_state: &'a PillState,
    pub content_opacity: f32,
    pub content_scale: f32,
    pub reduce_motion: bool,
    pub state_elapsed_ms: u64,
    pub idle_hover_progress: f32,
    pub ai_state: &'a AiState,
    pub frame_count: u64,
    pub input_text: &'a str,
    pub input_cursor: usize,
    pub input_preedit: &'a str,
    pub input_file_context_active: bool,
    pub input_file_context_name: &'a str,
    pub output_text: &'a str,
    pub output_scroll_offset: f32,
    pub output_at_end: bool,
    pub tools_view_progress: f32,
    pub tool_presses: &'a [f32],
    pub filedrop_state: &'a filedrop::FileDropSceneState,
    pub processing_progress: f32,
    pub processing_label: &'a str,
    pub last_tool_name: &'a str,
    pub last_tool_result: &'a str,
    pub file_input_text: &'a str,
    pub file_input_cursor: usize,
    pub dropped_file_count: usize,
    pub file_ready_image_available: bool,
    pub file_ready_audio_available: bool,
    pub file_ready_text_available: bool,
    pub music_state: Option<&'a music::MusicSceneState>,
    pub music_searching: bool,
    pub music_query: &'a str,
    pub music_search_cursor: usize,
    pub music_results: &'a [MusicSearchResult],
    pub music_results_context_label: &'a str,
    pub music_result_cover_images: &'a HashMap<u64, Image>,
    pub music_results_scroll: f32,
    pub music_queue_len: usize,
    pub music_current_index: Option<usize>,
    pub music_netease_connected: bool,
    pub music_netease_account_name: &'a str,
    pub music_auth_status: &'a str,
    pub music_auth_qr_image: Option<&'a Image>,
    pub music_elapsed_ms: u64,
    pub music_duration_ms: u64,
    pub music_transition_pulse: f32,
    pub current_lyric: &'a str,
    pub old_lyric: &'a str,
    pub lyric_transition: f32,
    pub bubble: &'a BubbleState,
    pub is_pressing: bool,
    pub action_text: &'a str,
    pub action_file_name: &'a str,
    pub action_progress: f32,
    pub action_requires_download: bool,
    pub action_downloading: bool,
    pub action_thumbnail: Option<&'a Image>,
    pub action_is_image: bool,
    pub action_is_video: bool,
    pub action_detail_text: &'a str,
    pub action_editor_available: bool,
    pub focus_phase: FocusPhase,
    pub focus_completion_kind: FocusCompletionKind,
    pub focus_total_ms: u64,
    pub focus_remaining_ms: u64,
    pub focus_selected_total_ms: u64,
    pub focus_running: bool,
    pub focus_label_text: &'a str,
    pub focus_label_cursor: usize,
    pub focus_rounds_completed: u32,
    pub audio_capture_running: bool,
    pub audio_capture_elapsed_ms: u64,
    pub screen_capture_running: bool,
    pub screen_capture_elapsed_ms: u64,
    pub image_edit_prompt: &'a str,
    pub image_edit_cursor: usize,
    pub image_edit_tool: ImageEditTool,
    pub image_edit_brush_mode: ImageEditBrushMode,
    pub image_edit_outpaint_preset: ImageOutpaintPreset,
    pub image_edit_has_mask: bool,
    pub image_edit_mask_preview: Option<&'a Image>,
    pub image_edit_mask_strokes: &'a [ImageMaskStroke],
}

pub fn draw_island(
    surface: &mut Surface<Arc<Window>, Arc<Window>>,
    current_w: f32,
    current_h: f32,
    current_r: f32,
    os_w: u32,
    os_h: u32,
    weights: [f32; 4],
    scale: f32,
    data: &FrameData,
) {
    let mut buffer = surface.buffer_mut().unwrap();
    let mut sk_surface = ensure_sk_surface(os_w, os_h);
    let canvas = sk_surface.canvas();
    canvas.clear(Color::TRANSPARENT);

    let offset_x = (os_w as f32 - current_w) / 2.0;
    let offset_y = PADDING / 2.0;
    let rect = Rect::from_xywh(offset_x, offset_y, current_w, current_h);
    let rrect = RRect::new_rect_xy(rect, current_r, current_r);

    canvas.save();
    canvas.clip_rrect(rrect, ClipOp::Intersect, true);
    let mut bg = Paint::default();
    bg.set_color(Color::BLACK);
    bg.set_anti_alias(true);
    canvas.draw_rrect(rrect, &bg);
    draw_surface_shell(canvas, rect, &rrect, scale);

    // Pressing glow: restrained blue emphasis, no candy gradient.
    if data.is_pressing {
        let glow_r = RRect::new_rect_xy(
            Rect::from_xywh(
                offset_x - 4.0,
                offset_y - 4.0,
                current_w + 8.0,
                current_h + 8.0,
            ),
            current_r + 4.0,
            current_r + 4.0,
        );
        let mut gp = Paint::default();
        gp.set_anti_alias(true);
        gp.set_style(skia_safe::paint::Style::Stroke);
        gp.set_stroke_width(5.0 * scale);
        gp.set_color(Color::from_argb(124, 72, 146, 255));
        canvas.draw_rrect(glow_r, &gp);
        gp.set_stroke_width(9.0 * scale);
        gp.set_color(Color::from_argb(56, 72, 146, 255));
        canvas.draw_rrect(glow_r, &gp);
    }

    if data.content_opacity > 0.01 {
        canvas.save();
        let cx = rect.center_x();
        let cy = rect.center_y();
        let s = if data.is_pressing {
            data.content_scale * 0.96
        } else {
            data.content_scale
        };
        canvas.translate((cx, cy));
        canvas.scale((s, s));
        canvas.translate((-cx, -cy));
        let alpha = (data.content_opacity * 255.0) as u8;
        draw_pill_content(canvas, rect, scale, data, alpha);
        canvas.restore();
    }

    if *data.pill_state == PillState::DragHover {
        let mut gp = Paint::default();
        gp.set_anti_alias(true);
        gp.set_color(Color::from_argb(51, 255, 255, 255));
        gp.set_style(skia_safe::paint::Style::Stroke);
        gp.set_stroke_width(3.0 * scale);
        canvas.draw_rrect(rrect, &gp);
    } else {
        draw_border(
            canvas, &rrect, &weights, current_w, offset_y, current_h, os_w, scale,
        );
    }
    canvas.restore();

    if *data.pill_state == PillState::FileProcessing {
        draw_file_processing_shell_glow(
            canvas,
            rect,
            current_r,
            scale,
            data.frame_count,
            data.content_opacity,
        );
    }

    if data.filedrop_state.phase != DropPhase::Idle {
        filedrop::draw_drop_overlay(canvas, rect, data.filedrop_state, scale);
    }

    if data.bubble.phase != BubblePhase::Hidden {
        bubble::draw_bubble(canvas, rect, data.bubble, scale);
    }

    let info = skia_safe::ImageInfo::new(
        ISize::new(os_w as i32, os_h as i32),
        skia_safe::ColorType::BGRA8888,
        skia_safe::AlphaType::Premul,
        None,
    );
    let u8_buf: &mut [u8] = bytemuck::cast_slice_mut(&mut *buffer);
    let _ = sk_surface.read_pixels(&info, u8_buf, (os_w * 4) as usize, (0, 0));
    buffer.present().unwrap();
}

fn draw_surface_shell(canvas: &Canvas, rect: Rect, rrect: &RRect, scale: f32) {
    let top_colors = [
        Color::from_argb(28, 255, 255, 255),
        Color::from_argb(0, 255, 255, 255),
    ];
    let top_stops = [0.0_f32, 0.34_f32];
    if let Some(shader) = gradient_shader::linear(
        (
            Point::new(rect.left(), rect.top()),
            Point::new(rect.left(), rect.bottom()),
        ),
        top_colors.as_slice(),
        Some(top_stops.as_slice()),
        TileMode::Clamp,
        None,
        None,
    ) {
        let mut top = Paint::default();
        top.set_anti_alias(true);
        top.set_shader(shader);
        canvas.draw_rrect(*rrect, &top);
    }

    let bottom_rect = Rect::from_xywh(
        rect.left(),
        rect.bottom() - rect.height() * 0.42,
        rect.width(),
        rect.height() * 0.42,
    );
    let bottom_colors = [Color::from_argb(0, 0, 0, 0), Color::from_argb(34, 0, 0, 0)];
    if let Some(shader) = gradient_shader::linear(
        (
            Point::new(bottom_rect.left(), bottom_rect.top()),
            Point::new(bottom_rect.left(), bottom_rect.bottom()),
        ),
        bottom_colors.as_slice(),
        None,
        TileMode::Clamp,
        None,
        None,
    ) {
        let mut bottom = Paint::default();
        bottom.set_anti_alias(true);
        bottom.set_shader(shader);
        canvas.draw_rrect(*rrect, &bottom);
    }

    let mut inner_stroke = Paint::default();
    inner_stroke.set_anti_alias(true);
    inner_stroke.set_style(PaintStyle::Stroke);
    inner_stroke.set_stroke_width(1.0 * scale);
    inner_stroke.set_color(Color::from_argb(24, 255, 255, 255));
    canvas.draw_rrect(*rrect, &inner_stroke);

    let inset_rect = Rect::from_xywh(
        rect.left() + 1.2 * scale,
        rect.top() + 1.2 * scale,
        (rect.width() - 2.4 * scale).max(1.0),
        (rect.height() - 2.4 * scale).max(1.0),
    );
    let inset_r = ((rrect.rect().width().min(rrect.rect().height())) * 0.5).min(36.0 * scale);
    let inset = RRect::new_rect_xy(inset_rect, inset_r, inset_r);
    inner_stroke.set_stroke_width(0.8 * scale);
    inner_stroke.set_color(Color::from_argb(14, 255, 255, 255));
    canvas.draw_rrect(inset, &inner_stroke);
}

fn draw_pill_content(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    match data.pill_state {
        PillState::Idle => draw_idle(canvas, rect, scale, data, alpha),
        PillState::FocusSetup => draw_focus_setup(canvas, rect, scale, data, alpha),
        PillState::FocusRun => draw_focus_run(canvas, rect, scale, data, alpha),
        PillState::AudioRun => draw_audio_run(canvas, rect, scale, data, alpha),
        PillState::AudioExpand => draw_audio_expand(canvas, rect, scale, data, alpha),
        PillState::ScreenRun => draw_screen_run(canvas, rect, scale, data, alpha),
        PillState::ScreenExpand => draw_screen_expand(canvas, rect, scale, data, alpha),
        PillState::MusicAuth => draw_music_auth(canvas, rect, scale, data, alpha),
        PillState::FocusExpand => draw_focus_expand(canvas, rect, scale, data, alpha),
        PillState::FocusComplete => draw_focus_complete(canvas, rect, scale, data, alpha),
        PillState::MusicSearch => draw_music_search(canvas, rect, scale, data, alpha),
        PillState::MusicResults => draw_music_results(canvas, rect, scale, data, alpha),
        PillState::MusicWave => draw_music_wave(canvas, rect, scale, data, alpha),
        PillState::MusicLyric => draw_music_lyric(canvas, rect, scale, data, alpha),
        PillState::MusicExpand => draw_music_expand(canvas, rect, scale, data, alpha),
        PillState::ToolPanel => draw_tool_panel(canvas, rect, scale, data, alpha),
        PillState::Input => draw_input(canvas, rect, scale, data, alpha),
        PillState::Thinking => draw_thinking(canvas, rect, scale, data, alpha),
        PillState::Output => draw_output(canvas, rect, scale, data, alpha),
        PillState::DragHover => draw_drag_hover(canvas, rect, scale, alpha),
        PillState::FileReady => draw_file_ready(canvas, rect, scale, data, alpha),
        PillState::FileProcessing => draw_file_processing(canvas, rect, scale, data, alpha),
        PillState::Processing => draw_processing(canvas, rect, scale, data, alpha),
        PillState::ImageProcessing => draw_processing(canvas, rect, scale, data, alpha),
        PillState::Action => draw_action(canvas, rect, scale, data, alpha),
        PillState::FileAction => draw_file_action(canvas, rect, scale, data, alpha),
        PillState::VideoAction => draw_action(canvas, rect, scale, data, alpha),
        PillState::ImageAction => draw_action(canvas, rect, scale, data, alpha),
        PillState::ImagePreview => draw_image_preview(canvas, rect, scale, data, alpha),
        PillState::ImageEdit => draw_image_edit(canvas, rect, scale, data, alpha),
    }
}

fn draw_idle(_canvas: &Canvas, _rect: Rect, _scale: f32, _data: &FrameData, _alpha: u8) {
    // Pure idle island: no foreground UI.
}

fn draw_focus_setup(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let (primary, _, _) = focus_palette(FocusPhase::Work);
    let info_x = rect.left() + 18.0 * scale;
    draw_focus_status_chip(
        canvas,
        Rect::from_xywh(
            info_x,
            rect.top() + 18.0 * scale,
            60.0 * scale,
            20.0 * scale,
        ),
        "FOCUS",
        primary,
        alpha,
        scale,
    );

    let mut title = Paint::default();
    title.set_anti_alias(true);
    title.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        "Start a round",
        (info_x, rect.top() + 50.0 * scale),
        15.8 * scale,
        FontStyle::bold(),
        &title,
        false,
        rect.width() - 36.0 * scale,
    );

    let mut helper = Paint::default();
    helper.set_anti_alias(true);
    helper.set_color(Color::from_argb((alpha as f32 * 0.64) as u8, 188, 192, 200));
    crate::ui::utils::draw_text_cached(
        canvas,
        "Choose the length, then keep the label short.",
        (info_x, rect.top() + 70.0 * scale),
        10.6 * scale,
        FontStyle::normal(),
        &helper,
        false,
        rect.width() - 36.0 * scale,
    );

    for (index, total_ms) in [25_u64, 50, 90].iter().enumerate() {
        let chip_w = (rect.width() - 32.0 * scale - 16.0 * scale) / 3.0;
        let chip_x = rect.left() + 16.0 * scale + index as f32 * (chip_w + 8.0 * scale);
        let chip_rect = Rect::from_xywh(chip_x, rect.top() + 92.0 * scale, chip_w, 30.0 * scale);
        draw_focus_selection_chip(
            canvas,
            chip_rect,
            &format!("{total_ms}m"),
            data.focus_selected_total_ms == *total_ms * 60 * 1000,
            primary,
            alpha,
            scale,
        );
    }

    draw_focus_label_box(
        canvas,
        Rect::from_xywh(
            rect.left() + 16.0 * scale,
            rect.top() + 128.0 * scale,
            rect.width() - 32.0 * scale,
            40.0 * scale,
        ),
        scale,
        data,
        alpha,
    );

    draw_focus_action_button(
        canvas,
        Rect::from_xywh(
            rect.left() + 16.0 * scale,
            rect.bottom() - 40.0 * scale,
            68.0 * scale,
            28.0 * scale,
        ),
        "Close",
        false,
        primary,
        alpha,
        scale,
    );
    draw_focus_action_button(
        canvas,
        Rect::from_xywh(
            rect.right() - 84.0 * scale,
            rect.bottom() - 40.0 * scale,
            68.0 * scale,
            28.0 * scale,
        ),
        "Start",
        true,
        primary,
        alpha,
        scale,
    );
}

fn draw_focus_run(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let (accent, secondary, _) = focus_palette(data.focus_phase);
    let remaining = format_focus_time(data.focus_remaining_ms);
    let progress = focus_progress_fraction(data.focus_remaining_ms, data.focus_total_ms);
    let status = if data.focus_phase == FocusPhase::Break {
        "BREAK"
    } else if data.focus_running {
        "FOCUS"
    } else {
        "PAUSED"
    };

    draw_focus_timer_disc(
        canvas,
        Point::new(rect.left() + 21.0 * scale, rect.center_y()),
        10.2 * scale,
        scale,
        alpha,
        data.focus_phase,
        progress.max(0.04),
        None,
        false,
    );

    let mut status_p = Paint::default();
    status_p.set_anti_alias(true);
    status_p.set_color(Color::from_argb(
        (alpha as f32 * 0.78) as u8,
        accent.r(),
        accent.g(),
        accent.b(),
    ));
    crate::ui::utils::draw_text_cached(
        canvas,
        status,
        (rect.left() + 38.0 * scale, rect.top() + 15.0 * scale),
        8.6 * scale,
        FontStyle::bold(),
        &status_p,
        false,
        56.0 * scale,
    );

    let label = if data.focus_label_text.trim().is_empty() {
        if data.focus_phase == FocusPhase::Break {
            "Reset and breathe"
        } else {
            "Single-task mode"
        }
    } else {
        data.focus_label_text
    };
    let mut label_p = Paint::default();
    label_p.set_anti_alias(true);
    label_p.set_color(Color::from_argb((alpha as f32 * 0.9) as u8, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        label,
        (rect.left() + 38.0 * scale, rect.center_y() + 5.0 * scale),
        12.6 * scale,
        FontStyle::bold(),
        &label_p,
        false,
        rect.width() - 130.0 * scale,
    );

    let mut time_p = Paint::default();
    time_p.set_anti_alias(true);
    time_p.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        &remaining,
        (rect.right() - 16.0 * scale, rect.center_y() + 5.0 * scale),
        14.4 * scale,
        FontStyle::bold(),
        &time_p,
        true,
        74.0 * scale,
    );

    let track_rect = Rect::from_xywh(
        rect.left() + 30.0 * scale,
        rect.bottom() - 8.0 * scale,
        rect.width() - 46.0 * scale,
        3.0 * scale,
    );
    let mut track = Paint::default();
    track.set_anti_alias(true);
    track.set_color(Color::from_argb((alpha as f32 * 0.12) as u8, 255, 255, 255));
    canvas.draw_round_rect(track_rect, 1.5 * scale, 1.5 * scale, &track);

    let progress_rect = Rect::from_xywh(
        track_rect.left(),
        track_rect.top(),
        (track_rect.width() * progress).max(6.0 * scale),
        track_rect.height(),
    );
    let mut fill = Paint::default();
    fill.set_anti_alias(true);
    fill.set_color(Color::from_argb(
        (alpha as f32 * 0.88) as u8,
        secondary.r(),
        secondary.g(),
        secondary.b(),
    ));
    canvas.draw_round_rect(progress_rect, 1.5 * scale, 1.5 * scale, &fill);
}

fn draw_focus_expand(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let phase_label = if data.focus_phase == FocusPhase::Break {
        "BREAK"
    } else if data.focus_running {
        "FOCUS"
    } else {
        "PAUSED"
    };
    let (accent, secondary, _) = focus_palette(data.focus_phase);
    let progress = focus_progress_fraction(data.focus_remaining_ms, data.focus_total_ms);
    let pad_x = 18.0 * scale;
    let info_x = rect.left() + pad_x;
    let info_right = rect.right() - pad_x;
    draw_focus_status_chip(
        canvas,
        Rect::from_xywh(
            info_x,
            rect.top() + 18.0 * scale,
            64.0 * scale,
            20.0 * scale,
        ),
        phase_label,
        accent,
        alpha,
        scale,
    );

    let mut rounds = Paint::default();
    rounds.set_anti_alias(true);
    rounds.set_color(Color::from_argb((alpha as f32 * 0.56) as u8, 186, 190, 198));
    crate::ui::utils::draw_text_cached(
        canvas,
        &format!("Round {}", data.focus_rounds_completed.saturating_add(1)),
        (info_right, rect.top() + 30.0 * scale),
        9.2 * scale,
        FontStyle::bold(),
        &rounds,
        true,
        62.0 * scale,
    );

    let label = if data.focus_label_text.trim().is_empty() {
        if data.focus_phase == FocusPhase::Break {
            "Step away and reset"
        } else {
            "Single-task mode"
        }
    } else {
        data.focus_label_text
    };

    let mut label_p = Paint::default();
    label_p.set_anti_alias(true);
    label_p.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        label,
        (info_x, rect.top() + 62.0 * scale),
        14.4 * scale,
        FontStyle::bold(),
        &label_p,
        false,
        (info_right - info_x - 98.0 * scale).max(1.0),
    );

    let mut subtitle = Paint::default();
    subtitle.set_anti_alias(true);
    subtitle.set_color(Color::from_argb((alpha as f32 * 0.56) as u8, 186, 190, 198));
    let subtitle_text = if data.focus_phase == FocusPhase::Break {
        if data.focus_running {
            "Short break running"
        } else {
            "Short break paused"
        }
    } else if data.focus_running {
        "Work session running"
    } else {
        "Work session paused"
    };
    crate::ui::utils::draw_text_cached(
        canvas,
        subtitle_text,
        (info_x, rect.top() + 82.0 * scale),
        10.8 * scale,
        FontStyle::normal(),
        &subtitle,
        false,
        rect.width() - pad_x * 2.0,
    );

    let mut time = Paint::default();
    time.set_anti_alias(true);
    time.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        &format_focus_time(data.focus_remaining_ms),
        (info_right, rect.top() + 62.0 * scale),
        22.4 * scale,
        FontStyle::bold(),
        &time,
        true,
        88.0 * scale,
    );

    let track_rect = Rect::from_xywh(
        rect.left() + pad_x,
        rect.top() + 108.0 * scale,
        rect.width() - pad_x * 2.0,
        6.0 * scale,
    );
    let mut track = Paint::default();
    track.set_anti_alias(true);
    track.set_color(Color::from_argb((alpha as f32 * 0.12) as u8, 255, 255, 255));
    canvas.draw_round_rect(track_rect, 3.0 * scale, 3.0 * scale, &track);
    let progress_rect = Rect::from_xywh(
        track_rect.left(),
        track_rect.top(),
        (track_rect.width() * progress).max(8.0 * scale),
        track_rect.height(),
    );
    let mut fill = Paint::default();
    fill.set_anti_alias(true);
    fill.set_color(Color::from_argb(
        alpha,
        secondary.r(),
        secondary.g(),
        secondary.b(),
    ));
    canvas.draw_round_rect(progress_rect, 3.0 * scale, 3.0 * scale, &fill);

    draw_focus_action_button(
        canvas,
        Rect::from_xywh(
            rect.left() + 16.0 * scale,
            rect.bottom() - 42.0 * scale,
            86.0 * scale,
            30.0 * scale,
        ),
        if data.focus_running {
            "Pause"
        } else {
            "Resume"
        },
        true,
        accent,
        alpha,
        scale,
    );
    draw_focus_action_button(
        canvas,
        Rect::from_xywh(
            rect.center_x() - 36.0 * scale,
            rect.bottom() - 42.0 * scale,
            72.0 * scale,
            30.0 * scale,
        ),
        "+5m",
        false,
        accent,
        alpha,
        scale,
    );
    draw_focus_action_button(
        canvas,
        Rect::from_xywh(
            rect.right() - 88.0 * scale,
            rect.bottom() - 42.0 * scale,
            72.0 * scale,
            30.0 * scale,
        ),
        "Skip",
        false,
        accent,
        alpha,
        scale,
    );
}

fn draw_focus_complete(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let work_done = data.focus_completion_kind == FocusCompletionKind::WorkFinished;
    let phase = if work_done {
        FocusPhase::Work
    } else {
        FocusPhase::Break
    };
    let (accent, _, _) = focus_palette(phase);
    let title = if work_done {
        "Focus complete"
    } else {
        "Break complete"
    };
    let subtitle = if work_done {
        "Choose the next move while the context is still warm."
    } else {
        "Reset is over. Step back in cleanly."
    };

    let pad_x = 18.0 * scale;
    let info_x = rect.left() + pad_x;
    draw_focus_status_chip(
        canvas,
        Rect::from_xywh(
            info_x,
            rect.top() + 18.0 * scale,
            62.0 * scale,
            20.0 * scale,
        ),
        if work_done { "DONE" } else { "BREAK" },
        accent,
        alpha,
        scale,
    );

    let mut title_p = Paint::default();
    title_p.set_anti_alias(true);
    title_p.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        title,
        (info_x, rect.top() + 50.0 * scale),
        15.2 * scale,
        FontStyle::bold(),
        &title_p,
        false,
        rect.width() - pad_x * 2.0,
    );

    let mut sub = Paint::default();
    sub.set_anti_alias(true);
    sub.set_color(Color::from_argb((alpha as f32 * 0.68) as u8, 190, 194, 202));
    crate::ui::utils::draw_text_cached(
        canvas,
        subtitle,
        (info_x, rect.top() + 70.0 * scale),
        10.4 * scale,
        FontStyle::normal(),
        &sub,
        false,
        rect.width() - pad_x * 2.0,
    );

    if !data.focus_label_text.trim().is_empty() {
        let mut label = Paint::default();
        label.set_anti_alias(true);
        label.set_color(Color::from_argb((alpha as f32 * 0.88) as u8, 232, 234, 240));
        crate::ui::utils::draw_text_cached(
            canvas,
            data.focus_label_text,
            (rect.left() + 18.0 * scale, rect.top() + 92.0 * scale),
            11.0 * scale,
            FontStyle::normal(),
            &label,
            false,
            rect.width() - 36.0 * scale,
        );
    }

    draw_focus_action_button(
        canvas,
        Rect::from_xywh(
            rect.left() + 14.0 * scale,
            rect.bottom() - 40.0 * scale,
            84.0 * scale,
            28.0 * scale,
        ),
        "Again",
        false,
        accent,
        alpha,
        scale,
    );
    draw_focus_action_button(
        canvas,
        Rect::from_xywh(
            rect.center_x() - 44.0 * scale,
            rect.bottom() - 40.0 * scale,
            88.0 * scale,
            28.0 * scale,
        ),
        if work_done { "Break" } else { "Close" },
        true,
        accent,
        alpha,
        scale,
    );
    draw_focus_action_button(
        canvas,
        Rect::from_xywh(
            rect.right() - 94.0 * scale,
            rect.bottom() - 40.0 * scale,
            80.0 * scale,
            28.0 * scale,
        ),
        "Log",
        false,
        accent,
        alpha,
        scale,
    );
}

fn draw_audio_run(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let accent = Color::from_rgb(255, 82, 82);
    let mic_accent = Color::from_rgb(92, 224, 168);
    let pulse = ((data.frame_count as f32 / 18.0).sin() * 0.5 + 0.5).clamp(0.0, 1.0);
    let center = Point::new(rect.left() + 18.0 * scale, rect.center_y());
    draw_music_glow(
        canvas,
        center,
        8.0 * scale,
        accent,
        Color::from_rgb(255, 62, 62),
        alpha,
        0.48 + pulse * 0.2,
    );

    let mut dot = Paint::default();
    dot.set_anti_alias(true);
    dot.set_color(Color::from_argb(alpha, accent.r(), accent.g(), accent.b()));
    canvas.draw_circle(center, 4.2 * scale, &dot);

    let mic_center = Point::new(rect.left() + 34.0 * scale, rect.center_y());
    let mut mic = Paint::default();
    mic.set_anti_alias(true);
    mic.set_color(Color::from_argb(
        alpha,
        mic_accent.r(),
        mic_accent.g(),
        mic_accent.b(),
    ));
    canvas.draw_round_rect(
        Rect::from_xywh(
            mic_center.x - 2.6 * scale,
            mic_center.y - 5.2 * scale,
            5.2 * scale,
            8.4 * scale,
        ),
        2.6 * scale,
        2.6 * scale,
        &mic,
    );
    canvas.draw_round_rect(
        Rect::from_xywh(
            mic_center.x - 1.3 * scale,
            mic_center.y + 2.8 * scale,
            2.6 * scale,
            4.2 * scale,
        ),
        1.3 * scale,
        1.3 * scale,
        &mic,
    );
    canvas.draw_round_rect(
        Rect::from_xywh(
            mic_center.x - 4.6 * scale,
            mic_center.y + 6.0 * scale,
            9.2 * scale,
            1.6 * scale,
        ),
        0.8 * scale,
        0.8 * scale,
        &mic,
    );

    let mut time = Paint::default();
    time.set_anti_alias(true);
    time.set_color(Color::from_argb(alpha, accent.r(), accent.g(), accent.b()));
    crate::ui::utils::draw_text_cached(
        canvas,
        &format_capture_time(data.audio_capture_elapsed_ms),
        (rect.right() - 12.0 * scale, rect.center_y() + 4.6 * scale),
        12.0 * scale,
        FontStyle::bold(),
        &time,
        true,
        74.0 * scale,
    );
}

fn draw_audio_expand(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let accent = Color::from_rgb(255, 82, 82);
    let secondary = Color::from_rgb(255, 62, 62);
    let mic_accent = Color::from_rgb(92, 224, 168);
    let lead_center = Point::new(rect.left() + 44.0 * scale, rect.top() + 43.0 * scale);
    draw_music_glow(
        canvas,
        lead_center,
        18.0 * scale,
        accent,
        secondary,
        alpha,
        0.64,
    );

    let mut ring = Paint::default();
    ring.set_anti_alias(true);
    ring.set_color(Color::from_argb(
        (alpha as f32 * 0.12) as u8,
        accent.r(),
        accent.g(),
        accent.b(),
    ));
    canvas.draw_circle(lead_center, 18.0 * scale, &ring);
    let mut mic = Paint::default();
    mic.set_anti_alias(true);
    mic.set_color(Color::from_argb(alpha, 255, 255, 255));
    canvas.draw_round_rect(
        Rect::from_xywh(
            lead_center.x - 4.0 * scale,
            lead_center.y - 9.0 * scale,
            8.0 * scale,
            14.0 * scale,
        ),
        4.0 * scale,
        4.0 * scale,
        &mic,
    );
    canvas.draw_round_rect(
        Rect::from_xywh(
            lead_center.x - 2.0 * scale,
            lead_center.y + 5.0 * scale,
            4.0 * scale,
            7.0 * scale,
        ),
        2.0 * scale,
        2.0 * scale,
        &mic,
    );
    canvas.draw_round_rect(
        Rect::from_xywh(
            lead_center.x - 7.0 * scale,
            lead_center.y + 11.0 * scale,
            14.0 * scale,
            2.0 * scale,
        ),
        1.0 * scale,
        1.0 * scale,
        &mic,
    );

    let mut title = Paint::default();
    title.set_anti_alias(true);
    title.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        "Audio Notes",
        (rect.left() + 82.0 * scale, rect.top() + 44.0 * scale),
        15.6 * scale,
        FontStyle::bold(),
        &title,
        false,
        150.0 * scale,
    );

    let mut subtitle = Paint::default();
    subtitle.set_anti_alias(true);
    subtitle.set_color(Color::from_argb((alpha as f32 * 0.58) as u8, 202, 206, 214));
    crate::ui::utils::draw_text_cached(
        canvas,
        "Microphone live 鈥?AI transcript after stop",
        (rect.left() + 82.0 * scale, rect.top() + 64.0 * scale),
        10.4 * scale,
        FontStyle::normal(),
        &subtitle,
        false,
        168.0 * scale,
    );

    let mut timer = Paint::default();
    timer.set_anti_alias(true);
    timer.set_color(Color::from_argb(alpha, accent.r(), accent.g(), accent.b()));
    crate::ui::utils::draw_text_cached(
        canvas,
        &format_capture_time(data.audio_capture_elapsed_ms),
        (rect.right() - 18.0 * scale, rect.top() + 46.0 * scale),
        26.0 * scale,
        FontStyle::normal(),
        &timer,
        true,
        92.0 * scale,
    );

    draw_focus_status_chip(
        canvas,
        Rect::from_xywh(
            rect.left() + 20.0 * scale,
            rect.bottom() - 40.0 * scale,
            74.0 * scale,
            24.0 * scale,
        ),
        "MIC ON",
        mic_accent,
        alpha,
        scale,
    );

    let stop_rect = Rect::from_xywh(
        rect.right() - 110.0 * scale,
        rect.bottom() - 42.0 * scale,
        92.0 * scale,
        30.0 * scale,
    );
    let mut stop_bg = Paint::default();
    stop_bg.set_anti_alias(true);
    stop_bg.set_color(Color::from_argb(
        (alpha as f32 * 0.26) as u8,
        accent.r(),
        accent.g(),
        accent.b(),
    ));
    canvas.draw_round_rect(
        stop_rect,
        stop_rect.height() * 0.5,
        stop_rect.height() * 0.5,
        &stop_bg,
    );
    let mut stop_border = Paint::default();
    stop_border.set_anti_alias(true);
    stop_border.set_style(PaintStyle::Stroke);
    stop_border.set_stroke_width(1.0 * scale);
    stop_border.set_color(Color::from_argb(
        (alpha as f32 * 0.62) as u8,
        accent.r(),
        accent.g(),
        accent.b(),
    ));
    canvas.draw_round_rect(
        stop_rect,
        stop_rect.height() * 0.5,
        stop_rect.height() * 0.5,
        &stop_border,
    );

    let square = Rect::from_xywh(
        stop_rect.left() + 16.0 * scale,
        stop_rect.center_y() - 4.8 * scale,
        9.6 * scale,
        9.6 * scale,
    );
    let mut square_paint = Paint::default();
    square_paint.set_anti_alias(true);
    square_paint.set_color(Color::from_argb(alpha, 255, 255, 255));
    canvas.draw_round_rect(square, 2.4 * scale, 2.4 * scale, &square_paint);

    let mut stop_text = Paint::default();
    stop_text.set_anti_alias(true);
    stop_text.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        "Stop",
        (
            stop_rect.left() + 56.0 * scale,
            stop_rect.center_y() + 4.0 * scale,
        ),
        11.0 * scale,
        FontStyle::bold(),
        &stop_text,
        true,
        44.0 * scale,
    );
}

fn draw_screen_run(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let accent = Color::from_rgb(255, 82, 82);
    let pulse = ((data.frame_count as f32 / 18.0).sin() * 0.5 + 0.5).clamp(0.0, 1.0);
    let center = Point::new(rect.left() + 18.0 * scale, rect.center_y());
    draw_music_glow(
        canvas,
        center,
        8.0 * scale,
        accent,
        Color::from_rgb(255, 56, 56),
        alpha,
        0.48 + pulse * 0.18,
    );
    let mut dot = Paint::default();
    dot.set_anti_alias(true);
    dot.set_color(Color::from_argb(alpha, accent.r(), accent.g(), accent.b()));
    canvas.draw_circle(center, 4.2 * scale, &dot);

    let mut time = Paint::default();
    time.set_anti_alias(true);
    time.set_color(Color::from_argb(alpha, accent.r(), accent.g(), accent.b()));
    crate::ui::utils::draw_text_cached(
        canvas,
        &format_capture_time(data.screen_capture_elapsed_ms),
        (rect.right() - 12.0 * scale, rect.center_y() + 4.6 * scale),
        12.0 * scale,
        FontStyle::bold(),
        &time,
        true,
        74.0 * scale,
    );
}

fn draw_screen_expand(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let accent = Color::from_rgb(255, 82, 82);
    let pulse = ((data.frame_count as f32 / 18.0).sin() * 0.5 + 0.5).clamp(0.0, 1.0);
    let mut title = Paint::default();
    title.set_anti_alias(true);
    title.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        "Screen Recording",
        (rect.center_x(), rect.top() + 30.0 * scale),
        14.5 * scale,
        FontStyle::normal(),
        &title,
        true,
        180.0 * scale,
    );

    let dot_center = Point::new(rect.center_x() - 52.0 * scale, rect.top() + 58.0 * scale);
    draw_music_glow(
        canvas,
        dot_center,
        10.0 * scale,
        accent,
        Color::from_rgb(255, 56, 56),
        alpha,
        0.52 + pulse * 0.18,
    );
    let mut dot = Paint::default();
    dot.set_anti_alias(true);
    dot.set_color(Color::from_argb(alpha, accent.r(), accent.g(), accent.b()));
    canvas.draw_circle(dot_center, 5.0 * scale, &dot);

    let mut timer = Paint::default();
    timer.set_anti_alias(true);
    timer.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        &format_capture_time(data.screen_capture_elapsed_ms),
        (rect.center_x() + 28.0 * scale, rect.top() + 68.0 * scale),
        27.0 * scale,
        FontStyle::normal(),
        &timer,
        true,
        110.0 * scale,
    );

    let button_center = Point::new(rect.center_x(), rect.bottom() - 24.0 * scale);
    let mut button_bg = Paint::default();
    button_bg.set_anti_alias(true);
    button_bg.set_color(Color::from_argb((alpha as f32 * 0.12) as u8, 255, 255, 255));
    canvas.draw_circle(button_center, 21.0 * scale, &button_bg);

    let mut button_border = Paint::default();
    button_border.set_anti_alias(true);
    button_border.set_style(PaintStyle::Stroke);
    button_border.set_stroke_width(1.0 * scale);
    button_border.set_color(Color::from_argb((alpha as f32 * 0.18) as u8, 255, 255, 255));
    canvas.draw_circle(button_center, 21.0 * scale, &button_border);

    let square_rect = Rect::from_xywh(
        button_center.x - 5.5 * scale,
        button_center.y - 5.5 * scale,
        11.0 * scale,
        11.0 * scale,
    );
    let mut square = Paint::default();
    square.set_anti_alias(true);
    square.set_color(Color::from_argb(alpha, accent.r(), accent.g(), accent.b()));
    canvas.draw_round_rect(square_rect, 3.0 * scale, 3.0 * scale, &square);
}

fn format_capture_time(elapsed_ms: u64) -> String {
    let total_seconds = elapsed_ms / 1000;
    let minutes = total_seconds / 60;
    let seconds = total_seconds % 60;
    format!("{minutes}:{seconds:02}")
}

fn focus_palette(phase: FocusPhase) -> (Color, Color, Color) {
    if phase == FocusPhase::Break {
        (
            Color::from_rgb(118, 187, 255),
            Color::from_rgb(86, 136, 255),
            Color::from_rgb(205, 230, 255),
        )
    } else {
        (
            Color::from_rgb(255, 176, 82),
            Color::from_rgb(255, 122, 86),
            Color::from_rgb(255, 231, 194),
        )
    }
}

fn draw_focus_timer_disc(
    canvas: &Canvas,
    center: Point,
    radius: f32,
    scale: f32,
    alpha: u8,
    phase: FocusPhase,
    progress: f32,
    center_text: Option<&str>,
    complete: bool,
) {
    let (accent, secondary, soft) = focus_palette(phase);
    draw_music_glow(
        canvas,
        center,
        radius * 1.18,
        accent,
        secondary,
        alpha,
        0.62,
    );

    let disc_rect = Rect::from_xywh(
        center.x - radius,
        center.y - radius,
        radius * 2.0,
        radius * 2.0,
    );
    let disc_colors = [
        Color::from_argb((alpha as f32 * 0.16) as u8, 255, 255, 255),
        Color::from_argb(
            (alpha as f32 * 0.08) as u8,
            accent.r(),
            accent.g(),
            accent.b(),
        ),
    ];
    if let Some(shader) = gradient_shader::linear(
        (
            Point::new(disc_rect.left(), disc_rect.top()),
            Point::new(disc_rect.right(), disc_rect.bottom()),
        ),
        disc_colors.as_slice(),
        None,
        TileMode::Clamp,
        None,
        None,
    ) {
        let mut fill = Paint::default();
        fill.set_anti_alias(true);
        fill.set_shader(shader);
        canvas.draw_circle(center, radius, &fill);
    }

    let mut inner = Paint::default();
    inner.set_anti_alias(true);
    inner.set_color(Color::from_argb((alpha as f32 * 0.28) as u8, 0, 0, 0));
    canvas.draw_circle(center, radius * 0.86, &inner);

    let mut ring = Paint::default();
    ring.set_anti_alias(true);
    ring.set_style(PaintStyle::Stroke);
    ring.set_stroke_width(2.2 * scale);
    ring.set_stroke_cap(skia_safe::paint::Cap::Round);
    ring.set_color(Color::from_argb((alpha as f32 * 0.18) as u8, 255, 255, 255));
    canvas.draw_circle(center, radius - 1.8 * scale, &ring);

    ring.set_stroke_width(2.6 * scale);
    ring.set_color(Color::from_argb(alpha, soft.r(), soft.g(), soft.b()));
    let oval = Rect::from_xywh(
        center.x - radius + 1.8 * scale,
        center.y - radius + 1.8 * scale,
        (radius - 1.8 * scale) * 2.0,
        (radius - 1.8 * scale) * 2.0,
    );
    canvas.draw_arc(oval, -90.0, progress.clamp(0.0, 1.0) * 360.0, false, &ring);

    if complete {
        draw_checkmark_icon(
            canvas,
            center.x,
            center.y,
            (radius * 0.78).max(9.0 * scale),
            Color::from_argb(alpha, 255, 255, 255),
        );
        return;
    }

    if let Some(text_value) = center_text {
        let mut text = Paint::default();
        text.set_anti_alias(true);
        text.set_color(Color::from_argb(alpha, 255, 255, 255));
        crate::ui::utils::draw_text_cached(
            canvas,
            text_value,
            (center.x, center.y + 4.2 * scale),
            13.6 * scale,
            FontStyle::bold(),
            &text,
            true,
            radius * 1.3,
        );
        let mut unit = Paint::default();
        unit.set_anti_alias(true);
        unit.set_color(Color::from_argb((alpha as f32 * 0.58) as u8, 226, 230, 238));
        crate::ui::utils::draw_text_cached(
            canvas,
            "m",
            (center.x, center.y + 14.0 * scale),
            8.8 * scale,
            FontStyle::bold(),
            &unit,
            true,
            radius,
        );
        return;
    }

    let mut core = Paint::default();
    core.set_anti_alias(true);
    core.set_color(Color::from_argb(alpha, accent.r(), accent.g(), accent.b()));
    canvas.draw_circle(center, radius * 0.16, &core);
}

fn draw_focus_status_chip(
    canvas: &Canvas,
    rect: Rect,
    label: &str,
    accent: Color,
    alpha: u8,
    scale: f32,
) {
    let mut bg = Paint::default();
    bg.set_anti_alias(true);
    bg.set_color(Color::from_argb(
        (alpha as f32 * 0.14) as u8,
        accent.r(),
        accent.g(),
        accent.b(),
    ));
    canvas.draw_round_rect(rect, rect.height() * 0.5, rect.height() * 0.5, &bg);

    let mut stroke = Paint::default();
    stroke.set_anti_alias(true);
    stroke.set_style(PaintStyle::Stroke);
    stroke.set_stroke_width(1.0 * scale);
    stroke.set_color(Color::from_argb(
        (alpha as f32 * 0.28) as u8,
        accent.r(),
        accent.g(),
        accent.b(),
    ));
    canvas.draw_round_rect(rect, rect.height() * 0.5, rect.height() * 0.5, &stroke);

    let mut text = Paint::default();
    text.set_anti_alias(true);
    text.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        label,
        (rect.center_x(), rect.center_y() + 3.0 * scale),
        8.6 * scale,
        FontStyle::bold(),
        &text,
        true,
        rect.width() - 8.0 * scale,
    );
}

fn draw_focus_selection_chip(
    canvas: &Canvas,
    rect: Rect,
    label: &str,
    active: bool,
    accent: Color,
    alpha: u8,
    scale: f32,
) {
    let mut bg = Paint::default();
    bg.set_anti_alias(true);
    bg.set_color(if active {
        Color::from_argb(
            (alpha as f32 * 0.18) as u8,
            accent.r(),
            accent.g(),
            accent.b(),
        )
    } else {
        Color::from_argb((alpha as f32 * 0.08) as u8, 255, 255, 255)
    });
    canvas.draw_round_rect(rect, 15.0 * scale, 15.0 * scale, &bg);

    let mut border = Paint::default();
    border.set_anti_alias(true);
    border.set_style(PaintStyle::Stroke);
    border.set_stroke_width(1.0 * scale);
    border.set_color(if active {
        Color::from_argb(
            (alpha as f32 * 0.48) as u8,
            accent.r(),
            accent.g(),
            accent.b(),
        )
    } else {
        Color::from_argb((alpha as f32 * 0.14) as u8, 255, 255, 255)
    });
    canvas.draw_round_rect(rect, 15.0 * scale, 15.0 * scale, &border);

    let mut text = Paint::default();
    text.set_anti_alias(true);
    text.set_color(if active {
        Color::from_argb(alpha, 255, 255, 255)
    } else {
        Color::from_argb((alpha as f32 * 0.78) as u8, 229, 232, 238)
    });
    crate::ui::utils::draw_text_cached(
        canvas,
        label,
        (rect.center_x(), rect.center_y() + 4.0 * scale),
        10.6 * scale,
        FontStyle::bold(),
        &text,
        true,
        rect.width() - 8.0 * scale,
    );
}

fn draw_focus_action_button(
    canvas: &Canvas,
    rect: Rect,
    label: &str,
    primary: bool,
    accent: Color,
    alpha: u8,
    scale: f32,
) {
    let mut bg = Paint::default();
    bg.set_anti_alias(true);
    bg.set_color(if primary {
        Color::from_argb(
            (alpha as f32 * 0.22) as u8,
            accent.r(),
            accent.g(),
            accent.b(),
        )
    } else {
        Color::from_argb((alpha as f32 * 0.08) as u8, 255, 255, 255)
    });
    canvas.draw_round_rect(rect, rect.height() * 0.5, rect.height() * 0.5, &bg);

    let mut border = Paint::default();
    border.set_anti_alias(true);
    border.set_style(PaintStyle::Stroke);
    border.set_stroke_width(1.0 * scale);
    border.set_color(if primary {
        Color::from_argb(
            (alpha as f32 * 0.58) as u8,
            accent.r(),
            accent.g(),
            accent.b(),
        )
    } else {
        Color::from_argb((alpha as f32 * 0.18) as u8, 255, 255, 255)
    });
    canvas.draw_round_rect(rect, rect.height() * 0.5, rect.height() * 0.5, &border);

    let mut text = Paint::default();
    text.set_anti_alias(true);
    text.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        label,
        (rect.center_x(), rect.center_y() + 4.0 * scale),
        10.6 * scale,
        FontStyle::bold(),
        &text,
        true,
        rect.width() - 8.0 * scale,
    );
}

// Input: text field state.
fn draw_input(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let pad = 16.0 * scale;
    let text_x = rect.left() + pad;
    let text_w = (rect.width() - pad * 2.0).max(1.0);
    let text_fs = 15.0 * scale;
    let line_h = text_fs * 1.42;
    let has_file_context = data.input_file_context_active && !data.input_file_context_name.is_empty();
    let display = format!("{}{}", data.input_text, data.input_preedit);
    let layout = wrap_text_layout(&display, text_fs, text_w, None).0;
    let chip_h = if has_file_context { 18.0 * scale } else { 0.0 };
    let chip_gap = if has_file_context { 8.0 * scale } else { 0.0 };
    let visible_lines =
        ((rect.height() - 24.0 * scale - chip_h - chip_gap) / line_h).floor().max(1.0) as usize;
    let cursor_index = data.input_cursor.min(data.input_text.len()) + data.input_preedit.len();
    let cursor_line = find_line_for_cursor(&layout, cursor_index);
    let visible_start = cursor_line
        .saturating_add(1)
        .saturating_sub(visible_lines)
        .min(layout.len().saturating_sub(visible_lines));
    let top_pad = if layout.len() <= 1 && rect.height() <= 52.0 * scale {
        ((rect.height() - line_h) * 0.5).max(10.0 * scale)
    } else {
        12.0 * scale + chip_h + chip_gap
    };
    let content_rect = Rect::from_xywh(
        rect.left() + pad,
        rect.top() + top_pad,
        text_w,
        (rect.height() - top_pad - 12.0 * scale).max(line_h),
    );

    if has_file_context {
        draw_focus_status_chip(
            canvas,
            Rect::from_xywh(
                rect.left() + pad,
                rect.top() + 12.0 * scale,
                122.0 * scale,
                18.0 * scale,
            ),
            "TRANSCRIPT",
            Color::from_argb(alpha, 95, 175, 255),
            alpha,
            scale,
        );

        let mut attachment = Paint::default();
        attachment.set_anti_alias(true);
        attachment.set_color(Color::from_argb((alpha as f32 * 0.62) as u8, 190, 194, 202));
        crate::ui::utils::draw_text_cached(
            canvas,
            data.input_file_context_name,
            (rect.left() + pad + 132.0 * scale, rect.top() + 25.0 * scale),
            9.4 * scale,
            FontStyle::normal(),
            &attachment,
            false,
            (text_w - 132.0 * scale).max(1.0),
        );
    }

    let mut text_paint = Paint::default();
    text_paint.set_anti_alias(true);
    if display.is_empty() {
        let cy = if has_file_context {
            content_rect.top() + text_fs
        } else {
            rect.center_y() + 4.0 * scale
        };
        text_paint.set_color(Color::from_argb((alpha as f32 * 0.42) as u8, 190, 190, 196));
        crate::ui::utils::draw_text_cached(
            canvas,
            if has_file_context {
                "Ask AI what to do with this transcript..."
            } else {
                "\u{804a}\u{5929}\u{6216}\u{751f}\u{56fe}\u{ff1a}16:9 \u{6d77}\u{62a5} / 9:16 \u{7ad6}\u{7248} / 4:5 \u{5c01}\u{9762}..."
            },
            (text_x, cy + 4.0 * scale),
            text_fs,
            FontStyle::normal(),
            &text_paint,
            false,
            text_w,
        );
    } else {
        text_paint.set_color(Color::from_argb(alpha, 255, 255, 255));
        canvas.save();
        canvas.clip_rect(content_rect, ClipOp::Intersect, true);
        for (visible_idx, line) in layout
            .iter()
            .skip(visible_start)
            .take(visible_lines)
            .enumerate()
        {
            crate::ui::utils::draw_text_cached(
                canvas,
                &line.text,
                (
                    text_x,
                    content_rect.top() + text_fs + visible_idx as f32 * line_h,
                ),
                text_fs,
                FontStyle::normal(),
                &text_paint,
                false,
                text_w,
            );
        }
        canvas.restore();
    }

    if data.frame_count % 60 < 30 {
        let line = layout
            .get(cursor_line)
            .or_else(|| layout.last())
            .cloned()
            .unwrap_or_else(|| WrappedLine::empty());
        let visible_cursor_line = cursor_line.saturating_sub(visible_start);
        let prefix_end = cursor_index.clamp(line.start, line.end);
        let prefix = display.get(line.start..prefix_end).unwrap_or_default();
        let cx = text_x + measure_text_width(prefix, text_fs);
        let caret_y = content_rect.top() + visible_cursor_line as f32 * line_h;
        let mut cp = Paint::default();
        cp.set_anti_alias(true);
        cp.set_color(Color::from_argb(alpha, 10, 132, 255));
        cp.set_stroke_width(1.2 * scale);
        cp.set_style(skia_safe::paint::Style::Stroke);
        canvas.draw_line(
            (cx, caret_y + 2.0 * scale),
            (cx, caret_y + line_h - 4.0 * scale),
            &cp,
        );
    }
}

fn draw_thinking(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let pad = 16.0 * scale;
    let cy = rect.center_y();

    draw_breathing_orb(
        canvas,
        rect.left() + pad + 7.0 * scale,
        cy,
        7.0 * scale,
        255,
        255,
        255,
        data.frame_count,
        alpha,
    );

    let label = "\u{6b63}\u{5728}\u{68c0}\u{7d22}\u{77e5}\u{8bc6}\u{5e93}";
    let fs = 13.6 * scale;
    let tw = measure_text_width(label, fs);
    let mut p = Paint::default();
    p.set_anti_alias(true);
    p.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        label,
        (rect.right() - pad - tw, cy + 4.8 * scale),
        fs,
        FontStyle::bold(),
        &p,
        false,
        tw + 4.0,
    );
}

// Output: long text reading surface with bottom energy affordance.
fn draw_output(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let pad_x = 22.0 * scale;
    let pad_top = 40.0 * scale;
    let pad_bottom = 36.0 * scale;
    let content_rect = Rect::from_xywh(
        rect.left() + pad_x,
        rect.top() + pad_top,
        rect.width() - pad_x * 2.0,
        rect.height() - pad_top - pad_bottom,
    );

    let fs = 15.0 * scale;
    let line_h = fs * 1.6;
    let lines = wrap_text_layout(data.output_text, fs, content_rect.width(), None).0;
    let content_h = lines.len() as f32 * line_h;
    let max_scroll = (content_h - content_rect.height()).max(0.0);
    let scroll_offset = data.output_scroll_offset.clamp(0.0, max_scroll);
    let progress_pct = if max_scroll <= 1.0 {
        100
    } else {
        ((scroll_offset / max_scroll) * 100.0)
            .round()
            .clamp(0.0, 100.0) as i32
    };
    let top_label = match data.ai_state {
        AiState::Streaming => "LIVE STREAM",
        _ if data.output_at_end || max_scroll <= 1.0 => "READY TO CONTINUE",
        _ => "READ MODE",
    };

    let mut chip = Paint::default();
    chip.set_anti_alias(true);
    chip.set_color(Color::from_argb((alpha as f32 * 0.16) as u8, 255, 255, 255));
    let chip_w = if matches!(data.ai_state, AiState::Streaming) {
        98.0 * scale
    } else if data.output_at_end || max_scroll <= 1.0 {
        126.0 * scale
    } else {
        84.0 * scale
    };
    let chip_rect = Rect::from_xywh(
        rect.left() + pad_x,
        rect.top() + 14.0 * scale,
        chip_w,
        17.0 * scale,
    );
    canvas.draw_round_rect(chip_rect, 9.0 * scale, 9.0 * scale, &chip);

    let mut chip_dot = Paint::default();
    chip_dot.set_anti_alias(true);
    chip_dot.set_color(if matches!(data.ai_state, AiState::Streaming) {
        Color::from_argb(alpha, 121, 197, 249)
    } else {
        Color::from_argb((alpha as f32 * 0.72) as u8, 180, 180, 188)
    });
    canvas.draw_circle(
        (chip_rect.left() + 10.0 * scale, chip_rect.center_y()),
        2.4 * scale,
        &chip_dot,
    );

    let mut label_p = Paint::default();
    label_p.set_anti_alias(true);
    label_p.set_color(Color::from_argb((alpha as f32 * 0.84) as u8, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        top_label,
        (
            chip_rect.left() + 17.0 * scale,
            chip_rect.center_y() + 3.3 * scale,
        ),
        8.4 * scale,
        FontStyle::bold(),
        &label_p,
        false,
        chip_rect.width() - 22.0 * scale,
    );

    let mut meter_p = Paint::default();
    meter_p.set_anti_alias(true);
    meter_p.set_color(Color::from_argb((alpha as f32 * 0.58) as u8, 182, 186, 194));
    crate::ui::utils::draw_text_cached(
        canvas,
        &format!("{progress_pct}%"),
        (rect.right() - pad_x, rect.top() + 26.0 * scale),
        8.8 * scale,
        FontStyle::bold(),
        &meter_p,
        true,
        32.0 * scale,
    );

    let mut body_p = Paint::default();
    body_p.set_anti_alias(true);
    body_p.set_color(Color::from_argb((alpha as f32 * 0.95) as u8, 255, 255, 255));

    canvas.save();
    canvas.clip_rect(content_rect, ClipOp::Intersect, true);
    let base_y = content_rect.top() + fs - scroll_offset;
    for (idx, line) in lines.iter().enumerate() {
        crate::ui::utils::draw_text_cached(
            canvas,
            &line.text,
            (content_rect.left(), base_y + idx as f32 * line_h),
            fs,
            FontStyle::normal(),
            &body_p,
            false,
            content_rect.width(),
        );
    }
    canvas.restore();

    let fade_h = (20.0 * scale).min(content_rect.height() * 0.45);
    if fade_h > 1.0 {
        let mut top_fade = Paint::default();
        top_fade.set_anti_alias(true);
        top_fade.set_shader(
            gradient_shader::linear(
                (
                    Point::new(content_rect.left(), content_rect.top()),
                    Point::new(content_rect.left(), content_rect.top() + fade_h),
                ),
                &[
                    Color::from_argb(alpha, 0, 0, 0),
                    Color::from_argb(0, 0, 0, 0),
                ][..],
                None,
                TileMode::Clamp,
                None,
                None,
            )
            .unwrap(),
        );
        canvas.draw_rect(
            Rect::from_xywh(
                content_rect.left(),
                content_rect.top(),
                content_rect.width(),
                fade_h,
            ),
            &top_fade,
        );

        let mut bottom_fade = Paint::default();
        bottom_fade.set_anti_alias(true);
        bottom_fade.set_shader(
            gradient_shader::linear(
                (
                    Point::new(content_rect.left(), content_rect.bottom() - fade_h),
                    Point::new(content_rect.left(), content_rect.bottom()),
                ),
                &[
                    Color::from_argb(0, 0, 0, 0),
                    Color::from_argb(alpha, 0, 0, 0),
                ][..],
                None,
                TileMode::Clamp,
                None,
                None,
            )
            .unwrap(),
        );
        canvas.draw_rect(
            Rect::from_xywh(
                content_rect.left(),
                content_rect.bottom() - fade_h,
                content_rect.width(),
                fade_h,
            ),
            &bottom_fade,
        );
    }

    let highlight = data.output_at_end || max_scroll <= 1.0;
    let pill_w = if highlight {
        96.0 * scale
    } else {
        36.0 * scale
    };
    let pill_h = if highlight { 10.0 * scale } else { 5.0 * scale };
    let pill_x = rect.center_x() - pill_w * 0.5;
    let pill_y = rect.bottom() - 18.0 * scale - pill_h;

    if highlight {
        let mut glow = Paint::default();
        glow.set_anti_alias(true);
        glow.set_color(Color::from_argb((alpha as f32 * 0.14) as u8, 10, 132, 255));
        canvas.draw_round_rect(
            Rect::from_xywh(
                pill_x - 5.0 * scale,
                pill_y - 3.0 * scale,
                pill_w + 10.0 * scale,
                pill_h + 6.0 * scale,
            ),
            10.0 * scale,
            10.0 * scale,
            &glow,
        );
    }

    let mut energy = Paint::default();
    energy.set_anti_alias(true);
    energy.set_color(if highlight {
        Color::from_argb((alpha as f32 * 0.36) as u8, 255, 255, 255)
    } else {
        Color::from_argb((alpha as f32 * 0.25) as u8, 255, 255, 255)
    });
    canvas.draw_round_rect(
        Rect::from_xywh(pill_x, pill_y, pill_w, pill_h),
        pill_h * 0.5,
        pill_h * 0.5,
        &energy,
    );

    if max_scroll > 1.0 {
        let rail_rect = Rect::from_xywh(
            rect.right() - 12.0 * scale,
            content_rect.top() + 2.0 * scale,
            2.4 * scale,
            (content_rect.height() - 4.0 * scale).max(10.0 * scale),
        );
        let mut rail = Paint::default();
        rail.set_anti_alias(true);
        rail.set_color(Color::from_argb((alpha as f32 * 0.18) as u8, 255, 255, 255));
        canvas.draw_round_rect(
            rail_rect,
            rail_rect.width() * 0.5,
            rail_rect.width() * 0.5,
            &rail,
        );

        let thumb_h = (rail_rect.height()
            * (content_rect.height() / content_h.max(content_rect.height())))
        .clamp(14.0 * scale, rail_rect.height());
        let thumb_y =
            rail_rect.top() + (rail_rect.height() - thumb_h) * (progress_pct as f32 / 100.0);
        let mut thumb = Paint::default();
        thumb.set_anti_alias(true);
        thumb.set_color(Color::from_argb((alpha as f32 * 0.72) as u8, 121, 197, 249));
        canvas.draw_round_rect(
            Rect::from_xywh(rail_rect.left(), thumb_y, rail_rect.width(), thumb_h),
            rail_rect.width() * 0.5,
            rail_rect.width() * 0.5,
            &thumb,
        );
    }
}

fn draw_drag_hover(canvas: &Canvas, rect: Rect, scale: f32, alpha: u8) {
    let cx = rect.center_x();
    let cy = rect.center_y();

    draw_upload_icon(
        canvas,
        cx,
        cy - 12.0 * scale,
        20.0 * scale,
        Color::from_argb(alpha, 255, 255, 255),
        2.0 * scale,
    );

    let mut p = Paint::default();
    p.set_anti_alias(true);
    p.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        "Release to drop into the island",
        (cx, cy + 16.0 * scale),
        14.0 * scale,
        FontStyle::bold(),
        &p,
        true,
        rect.width() - 32.0 * scale,
    );
}

fn draw_file_ready(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let pad = 16.0 * scale;
    let icon_size = 34.0 * scale;
    let icon_x = rect.left() + pad;
    let top_y = rect.top() + 12.0 * scale;
    let icon_y = top_y + 8.0 * scale;
    let quick_action_h = 24.0 * scale;
    let quick_action_w = 78.0 * scale;
    let quick_action_bottom = 15.0 * scale;
    let quick_action_gap = 10.0 * scale;
    let icon_rect = Rect::from_xywh(icon_x, icon_y, icon_size, icon_size);
    draw_file_preview_symbol(
        canvas,
        icon_rect,
        data.filedrop_state.thumbnail.as_ref(),
        &data.filedrop_state.file_name,
        &data.filedrop_state.file_ext,
        alpha,
    );
    if data.dropped_file_count > 1 {
        let badge_w = 16.0 * scale;
        let badge_h = 16.0 * scale;
        let badge_rect = Rect::from_xywh(
            icon_rect.right() - badge_w * 0.8,
            icon_rect.top() - badge_h * 0.1,
            badge_w,
            badge_h,
        );
        let mut badge = Paint::default();
        badge.set_anti_alias(true);
        badge.set_color(Color::from_argb((alpha as f32 * 0.9) as u8, 255, 255, 255));
        canvas.draw_round_rect(badge_rect, 8.0 * scale, 8.0 * scale, &badge);

        let mut count_p = Paint::default();
        count_p.set_anti_alias(true);
        count_p.set_color(Color::from_argb(alpha, 0, 0, 0));
        crate::ui::utils::draw_text_cached(
            canvas,
            &data.dropped_file_count.to_string(),
            (
                badge_rect.left() + 4.2 * scale,
                badge_rect.center_y() + 3.0 * scale,
            ),
            9.4 * scale,
            FontStyle::bold(),
            &count_p,
            false,
            badge_rect.width(),
        );
    }

    let show_audio_button = data.file_ready_audio_available && data.file_input_text.is_empty();
    let show_text_button = data.file_ready_text_available && data.file_input_text.is_empty();
    let show_quick_action = show_audio_button || show_text_button;
    let quick_action_label = if show_audio_button { "To Text" } else { "Ask AI" };
    let text_x = icon_rect.right() + 10.0 * scale;
    let text_w = (rect.right()
        - text_x
        - pad
        - if show_quick_action {
            quick_action_w + quick_action_gap
        } else {
            0.0
        })
        .max(1.0);
    let is_single_image = data.dropped_file_count == 1 && data.filedrop_state.thumbnail.is_some();
    let is_single_audio = data.dropped_file_count == 1 && data.file_ready_audio_available;
    let is_single_text = data.dropped_file_count == 1 && data.file_ready_text_available;
    let status = if data.dropped_file_count > 1 {
        "Files"
    } else if is_single_audio {
        "Audio"
    } else if is_single_text {
        "Transcript"
    } else if is_single_image {
        "Image"
    } else {
        "File"
    };
    let placeholder = if data.dropped_file_count > 1 {
        "Describe the bundle"
    } else if is_single_audio {
        "Describe audio"
    } else if is_single_text {
        "Describe text"
    } else if is_single_image {
        "Describe the edit"
    } else {
        "Describe the change"
    };

    let mut status_p = Paint::default();
    status_p.set_anti_alias(true);
    status_p.set_color(Color::from_argb((alpha as f32 * 0.34) as u8, 176, 181, 190));
    crate::ui::utils::draw_text_cached(
        canvas,
        status,
        (text_x, top_y + 8.5 * scale),
        8.4 * scale,
        FontStyle::bold(),
        &status_p,
        false,
        text_w,
    );

    let fs = 14.0 * scale;
    let line_h = fs * 1.42;
    let display = if data.file_input_text.is_empty() {
        placeholder.to_string()
    } else {
        data.file_input_text.to_string()
    };
    let layout = if data.file_input_text.is_empty() {
        vec![WrappedLine {
            text: display.clone(),
            start: 0,
            end: display.len(),
        }]
    } else {
        wrap_text_layout(&display, fs, text_w, None).0
    };
    let visible_lines = ((rect.bottom() - (top_y + 18.0 * scale) - 12.0 * scale) / line_h)
        .floor()
        .max(1.0) as usize;
    let cursor_index = data.file_input_cursor.min(data.file_input_text.len());
    let cursor_line = if data.file_input_text.is_empty() {
        0
    } else {
        find_line_for_cursor(&layout, cursor_index)
    };
    let visible_start = cursor_line
        .saturating_add(1)
        .saturating_sub(visible_lines)
        .min(layout.len().saturating_sub(visible_lines));
    let footer_reserved = if data.file_input_text.is_empty() {
        if show_quick_action {
            30.0 * scale
        } else {
            16.0 * scale
        }
    } else {
        12.0 * scale
    };
    let content_rect = Rect::from_xywh(
        text_x,
        top_y + 18.0 * scale,
        text_w,
        (rect.bottom() - (top_y + 18.0 * scale) - footer_reserved).max(line_h),
    );

    let mut input_text = Paint::default();
    input_text.set_anti_alias(true);
    input_text.set_color(if data.file_input_text.is_empty() {
        Color::from_argb((alpha as f32 * 0.64) as u8, 178, 181, 188)
    } else {
        Color::from_argb(alpha, 255, 255, 255)
    });

    canvas.save();
    canvas.clip_rect(content_rect, ClipOp::Intersect, true);
    for (visible_idx, line) in layout
        .iter()
        .skip(visible_start)
        .take(visible_lines)
        .enumerate()
    {
        crate::ui::utils::draw_text_cached(
            canvas,
            &line.text,
            (
                text_x,
                content_rect.top() + fs + visible_idx as f32 * line_h,
            ),
            fs,
            FontStyle::normal(),
            &input_text,
            false,
            text_w,
        );
    }
    canvas.restore();

    if data.file_input_text.is_empty() {
        let rail_w = (text_w * 0.44).clamp(48.0 * scale, 120.0 * scale);
        let rail_y = rect.bottom() - 14.0 * scale;
        let mut rail = Paint::default();
        rail.set_anti_alias(true);
        rail.set_color(Color::from_argb((alpha as f32 * 0.10) as u8, 255, 255, 255));
        canvas.draw_round_rect(
            Rect::from_xywh(text_x, rail_y, rail_w, 1.8 * scale),
            0.9 * scale,
            0.9 * scale,
            &rail,
        );
        if is_single_image {
            rail.set_color(Color::from_argb((alpha as f32 * 0.48) as u8, 245, 247, 250));
            canvas.draw_circle(
                (text_x + rail_w + 10.0 * scale, rail_y + 1.0 * scale),
                2.2 * scale,
                &rail,
            );
        }
        if show_quick_action {
            let button_rect = Rect::from_xywh(
                rect.right() - pad - quick_action_w,
                rect.bottom() - quick_action_bottom - quick_action_h,
                quick_action_w,
                quick_action_h,
            );
            draw_focus_action_button(
                canvas,
                button_rect,
                quick_action_label,
                true,
                Color::from_argb(alpha, 95, 175, 255),
                alpha,
                scale,
            );
        }
    }

    if !data.file_input_text.is_empty() && data.frame_count % 60 < 30 {
        let line = layout
            .get(cursor_line)
            .or_else(|| layout.last())
            .cloned()
            .unwrap_or_else(WrappedLine::empty);
        let visible_cursor_line = cursor_line.saturating_sub(visible_start);
        let prefix_end = cursor_index.clamp(line.start, line.end);
        let prefix = data
            .file_input_text
            .get(line.start..prefix_end)
            .unwrap_or_default();
        let cursor_x = text_x + measure_text_width(prefix, fs);
        let caret_y = content_rect.top() + visible_cursor_line as f32 * line_h;
        let mut cursor = Paint::default();
        cursor.set_anti_alias(true);
        cursor.set_style(skia_safe::paint::Style::Stroke);
        cursor.set_stroke_width(1.3 * scale);
        cursor.set_color(Color::from_argb(alpha, 120, 197, 249));
        canvas.draw_line(
            (cursor_x, caret_y + 2.0 * scale),
            (cursor_x, caret_y + line_h - 4.0 * scale),
            &cursor,
        );
    }
}

fn draw_file_processing(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let pulse = ((data.frame_count as f32 * 0.10).sin() * 0.5 + 0.5).clamp(0.0, 1.0);
    let icon_size = (24.0 + pulse * 3.6) * scale;
    let icon_rect = Rect::from_xywh(
        rect.center_x() - icon_size * 0.5,
        rect.center_y() - icon_size * 0.5,
        icon_size,
        icon_size,
    );
    draw_file_preview_symbol(
        canvas,
        icon_rect,
        data.filedrop_state.thumbnail.as_ref(),
        &data.filedrop_state.file_name,
        &data.filedrop_state.file_ext,
        ((alpha as f32) * (0.82 + 0.18 * pulse)) as u8,
    );
}

fn draw_processing(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let pad = 16.0 * scale;
    let cy = rect.center_y();
    let raw_title = if data.processing_label.is_empty() {
        "Processing..."
    } else {
        data.processing_label
    };
    let spec = resolve_processing_spec(raw_title);
    let p = data.processing_progress.clamp(0.0, 1.0);
    let stage_idx = if p < 0.34 {
        0
    } else if p < 0.68 {
        1
    } else {
        2
    };

    if matches!(spec.kind, ProcessingVisualKind::ImageGenerate) {
        draw_processing_image_flow(canvas, rect, scale, data, alpha, &spec, stage_idx);
        return;
    }

    draw_breathing_orb(
        canvas,
        rect.left() + pad + 6.0 * scale,
        cy,
        6.6 * scale,
        10,
        132,
        255,
        data.frame_count,
        alpha,
    );

    let label = if data.processing_label.is_empty() {
        "Processing...".to_string()
    } else if data.processing_label.contains("tool:")
        || data.processing_label.contains('.')
        || data.processing_label.contains('_')
    {
        spec.stages[stage_idx].to_string()
    } else {
        let clean = clean_processing_title(data.processing_label);
        if clean.is_empty() {
            "Processing...".to_string()
        } else {
            clean
        }
    };

    let text_x = rect.left() + pad + 20.0 * scale;
    let mut text = Paint::default();
    text.set_anti_alias(true);
    text.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        &label,
        (text_x, cy + 4.8 * scale),
        13.6 * scale,
        FontStyle::bold(),
        &text,
        false,
        (rect.right() - text_x - 26.0 * scale).max(1.0),
    );

    let pulse = ((data.frame_count as f32 * 0.11).sin() * 0.5 + 0.5).clamp(0.0, 1.0);
    let dots_x0 = rect.right() - pad - 14.0 * scale;
    for idx in 0..3 {
        let x = dots_x0 + idx as f32 * 4.6 * scale;
        let mut dot = Paint::default();
        dot.set_anti_alias(true);
        let reached = stage_idx > idx;
        let current = stage_idx == idx;
        dot.set_color(if reached {
            Color::from_argb((alpha as f32 * 0.88) as u8, 255, 255, 255)
        } else if current {
            Color::from_argb((alpha as f32 * (0.55 + 0.35 * pulse)) as u8, 10, 132, 255)
        } else {
            Color::from_argb((alpha as f32 * 0.30) as u8, 170, 170, 176)
        });
        let r = if current {
            (1.15 + pulse * 0.22) * scale
        } else {
            1.0 * scale
        };
        canvas.draw_circle((x, cy), r, &dot);
    }
}

fn draw_processing_image_flow(
    canvas: &Canvas,
    rect: Rect,
    scale: f32,
    data: &FrameData,
    alpha: u8,
    spec: &ResolvedProcessingSpec,
    stage_idx: usize,
) {
    let pad = 16.0 * scale;
    let cy = rect.center_y();
    let shimmer = ((data.frame_count as f32 * 0.11).sin() * 0.5 + 0.5).clamp(0.0, 1.0);

    draw_breathing_orb(
        canvas,
        rect.left() + pad + 6.0 * scale,
        cy,
        6.2 * scale,
        10,
        132,
        255,
        data.frame_count,
        alpha,
    );

    let mut text = Paint::default();
    text.set_anti_alias(true);
    let tone = (198.0 + 57.0 * shimmer) as u8;
    text.set_color(Color::from_argb(
        (alpha as f32 * (0.84 + 0.16 * shimmer)) as u8,
        tone,
        tone,
        tone,
    ));
    crate::ui::utils::draw_text_cached(
        canvas,
        spec.stages[stage_idx],
        (rect.left() + pad + 20.0 * scale, cy + 4.7 * scale),
        13.2 * scale,
        FontStyle::bold(),
        &text,
        false,
        (rect.width() - (pad + 16.0 * scale) * 2.0).max(1.0),
    );
}

fn draw_processing_standard(
    canvas: &Canvas,
    rect: Rect,
    scale: f32,
    data: &FrameData,
    alpha: u8,
    spec: &ResolvedProcessingSpec,
    p: f32,
    kr: u8,
    kg: u8,
    kb: u8,
    pad: f32,
    cy: f32,
) {
    let phase = data.frame_count as f32 * 0.086;
    let pulse = (phase.sin() * 0.5 + 0.5).clamp(0.0, 1.0);
    let stage_idx = if p < 0.34 {
        0
    } else if p < 0.68 {
        1
    } else {
        2
    };
    let stage_t = if stage_idx == 0 {
        (p / 0.34).clamp(0.0, 1.0)
    } else if stage_idx == 1 {
        ((p - 0.34) / 0.34).clamp(0.0, 1.0)
    } else {
        ((p - 0.68) / 0.32).clamp(0.0, 1.0)
    };

    let left_w = 24.0 * scale;
    let left_h = 24.0 * scale;
    let left_x = rect.left() + pad;
    let left_y = cy - left_h / 2.0;
    let left_rect = Rect::from_xywh(left_x, left_y, left_w, left_h);

    let right_w = 44.0 * scale;
    let right_h = 24.0 * scale;
    let right_x = rect.right() - pad - right_w;
    let right_y = cy - right_h / 2.0;
    let right_rect = Rect::from_xywh(right_x, right_y, right_w, right_h);

    let text_x = left_rect.right() + 7.0 * scale;
    let text_w = (right_rect.left() - text_x - 6.0 * scale).max(1.0);

    let mut halo = Paint::default();
    halo.set_anti_alias(true);
    halo.set_color(Color::from_argb(
        (alpha as f32 * (0.16 + 0.18 * pulse)) as u8,
        kr,
        kg,
        kb,
    ));
    canvas.draw_round_rect(
        Rect::from_xywh(
            left_rect.left() - 1.4 * scale,
            left_rect.top() - 1.4 * scale,
            left_rect.width() + 2.8 * scale,
            left_rect.height() + 2.8 * scale,
        ),
        8.3 * scale,
        8.3 * scale,
        &halo,
    );

    let mut left_bg = Paint::default();
    left_bg.set_anti_alias(true);
    left_bg.set_color(Color::from_argb((alpha as f32 * 0.24) as u8, 255, 255, 255));
    canvas.draw_round_rect(left_rect, 7.0 * scale, 7.0 * scale, &left_bg);
    draw_processing_icon(
        canvas,
        left_rect.center_x(),
        left_rect.center_y(),
        scale * 0.76,
        data.frame_count,
        alpha,
        spec.kind,
    );

    let mut title_p = Paint::default();
    title_p.set_anti_alias(true);
    title_p.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        spec.title.as_str(),
        (text_x, cy - 2.0 * scale),
        9.7 * scale,
        FontStyle::bold(),
        &title_p,
        false,
        text_w,
    );

    let mut stage_p = Paint::default();
    stage_p.set_anti_alias(true);
    stage_p.set_color(Color::from_argb((alpha as f32 * 0.86) as u8, kr, kg, kb));
    crate::ui::utils::draw_text_cached(
        canvas,
        spec.stages[stage_idx],
        (text_x, cy + 8.0 * scale),
        8.2 * scale,
        FontStyle::normal(),
        &stage_p,
        false,
        text_w,
    );

    let chip_y = cy + 10.2 * scale;
    let chip_w = 8.5 * scale;
    let chip_h = 2.1 * scale;
    let chip_gap = 2.3 * scale;
    for idx in 0..3 {
        let mut chip = Paint::default();
        chip.set_anti_alias(true);
        let x = text_x + idx as f32 * (chip_w + chip_gap);
        let reached = idx < stage_idx;
        let current = idx == stage_idx;
        chip.set_color(if reached {
            Color::from_argb((alpha as f32 * 0.90) as u8, kr, kg, kb)
        } else if current {
            Color::from_argb((alpha as f32 * (0.56 + pulse * 0.32)) as u8, 255, 255, 255)
        } else {
            Color::from_argb((alpha as f32 * 0.28) as u8, 216, 216, 222)
        });
        canvas.draw_round_rect(
            Rect::from_xywh(x, chip_y, chip_w, chip_h),
            1.0 * scale,
            1.0 * scale,
            &chip,
        );
    }

    let mut right_bg = Paint::default();
    right_bg.set_anti_alias(true);
    right_bg.set_color(Color::from_argb((alpha as f32 * 0.15) as u8, 255, 255, 255));
    canvas.draw_round_rect(right_rect, 7.0 * scale, 7.0 * scale, &right_bg);

    let mut right_stroke = Paint::default();
    right_stroke.set_anti_alias(true);
    right_stroke.set_style(skia_safe::paint::Style::Stroke);
    right_stroke.set_stroke_width(1.0 * scale);
    right_stroke.set_color(Color::from_argb((alpha as f32 * 0.30) as u8, kr, kg, kb));
    canvas.draw_round_rect(right_rect, 7.0 * scale, 7.0 * scale, &right_stroke);

    draw_processing_activity_widget(
        canvas, right_rect, scale, data, alpha, spec.kind, p, stage_idx, stage_t, kr, kg, kb,
    );

    let mut pct = Paint::default();
    pct.set_anti_alias(true);
    pct.set_color(Color::from_argb((alpha as f32 * 0.92) as u8, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        &format!("{:>2}%", (p * 100.0).round() as i32),
        (
            right_rect.right() - 2.6 * scale,
            right_rect.top() + 8.1 * scale,
        ),
        7.6 * scale,
        FontStyle::bold(),
        &pct,
        true,
        18.0 * scale,
    );
}

#[allow(clippy::too_many_arguments)]
fn draw_processing_activity_widget(
    canvas: &Canvas,
    rect: Rect,
    scale: f32,
    data: &FrameData,
    alpha: u8,
    kind: ProcessingVisualKind,
    p: f32,
    stage_idx: usize,
    stage_t: f32,
    kr: u8,
    kg: u8,
    kb: u8,
) {
    let cx = rect.center_x();
    let cy = rect.center_y();
    let phase = data.frame_count as f32 * 0.094;
    let pulse = (phase.sin() * 0.5 + 0.5).clamp(0.0, 1.0);

    match kind {
        ProcessingVisualKind::NetworkSearch => {
            let mut ring = Paint::default();
            ring.set_anti_alias(true);
            ring.set_style(skia_safe::paint::Style::Stroke);
            ring.set_stroke_width(0.95 * scale);
            ring.set_color(Color::from_argb((alpha as f32 * 0.40) as u8, 190, 239, 223));
            canvas.draw_circle((cx - 5.0 * scale, cy + 0.5 * scale), 4.8 * scale, &ring);
            canvas.draw_circle((cx - 5.0 * scale, cy + 0.5 * scale), 2.9 * scale, &ring);

            let sweep_t = (phase * 0.55) % 1.0;
            let angle = sweep_t * std::f32::consts::TAU;
            let tip_x = cx - 5.0 * scale + angle.cos() * 4.8 * scale;
            let tip_y = cy + 0.5 * scale + angle.sin() * 4.8 * scale;
            let mut sweep = Paint::default();
            sweep.set_anti_alias(true);
            sweep.set_color(Color::from_argb((alpha as f32 * 0.90) as u8, 117, 234, 202));
            canvas.draw_circle((tip_x, tip_y), (1.1 + pulse * 0.2) * scale, &sweep);

            for i in 0..2 {
                let mut hit = Paint::default();
                hit.set_anti_alias(true);
                hit.set_color(if (p * 2.0).ceil() as i32 > i {
                    Color::from_argb((alpha as f32 * 0.90) as u8, 214, 255, 244)
                } else {
                    Color::from_argb((alpha as f32 * 0.30) as u8, 194, 208, 206)
                });
                canvas.draw_circle(
                    (
                        rect.right() - 15.0 * scale + i as f32 * 4.5 * scale,
                        rect.bottom() - 6.2 * scale,
                    ),
                    1.1 * scale,
                    &hit,
                );
            }
        }
        ProcessingVisualKind::WorkspaceGenerate => {
            let reveal = ((p * 4.0).ceil() as i32).clamp(0, 4);
            for row in 0..2 {
                for col in 0..2 {
                    let idx = row * 2 + col;
                    let x = rect.left() + 5.2 * scale + col as f32 * 10.5 * scale;
                    let y = rect.top() + 5.4 * scale + row as f32 * 7.8 * scale;
                    let mut cell = Paint::default();
                    cell.set_anti_alias(true);
                    cell.set_color(if reveal > idx {
                        Color::from_argb((alpha as f32 * 0.88) as u8, 255, 186, 109)
                    } else {
                        Color::from_argb((alpha as f32 * 0.24) as u8, 255, 255, 255)
                    });
                    canvas.draw_round_rect(
                        Rect::from_xywh(x, y, 8.0 * scale, 5.5 * scale),
                        1.8 * scale,
                        1.8 * scale,
                        &cell,
                    );
                }
            }
            let focus = ((phase * 1.35) as i32).rem_euclid(4);
            let fx = rect.left() + 5.2 * scale + (focus % 2) as f32 * 10.5 * scale;
            let fy = rect.top() + 5.4 * scale + (focus / 2) as f32 * 7.8 * scale;
            let mut focus_p = Paint::default();
            focus_p.set_anti_alias(true);
            focus_p.set_style(skia_safe::paint::Style::Stroke);
            focus_p.set_stroke_width(0.9 * scale);
            focus_p.set_color(Color::from_argb((alpha as f32 * 0.66) as u8, 255, 236, 211));
            canvas.draw_round_rect(
                Rect::from_xywh(fx - 0.7 * scale, fy - 0.7 * scale, 9.4 * scale, 6.9 * scale),
                2.0 * scale,
                2.0 * scale,
                &focus_p,
            );
        }
        ProcessingVisualKind::CodeTransform | ProcessingVisualKind::JsonFormat => {
            let mut bracket = Paint::default();
            bracket.set_anti_alias(true);
            bracket.set_style(skia_safe::paint::Style::Stroke);
            bracket.set_stroke_width(1.2 * scale);
            bracket.set_stroke_cap(skia_safe::paint::Cap::Round);
            bracket.set_color(Color::from_argb((alpha as f32 * 0.86) as u8, 203, 184, 255));
            canvas.draw_line(
                (rect.left() + 6.4 * scale, rect.top() + 7.0 * scale),
                (rect.left() + 4.6 * scale, rect.center_y()),
                &bracket,
            );
            canvas.draw_line(
                (rect.left() + 4.6 * scale, rect.center_y()),
                (rect.left() + 6.4 * scale, rect.bottom() - 7.0 * scale),
                &bracket,
            );
            canvas.draw_line(
                (rect.right() - 6.4 * scale, rect.top() + 7.0 * scale),
                (rect.right() - 4.6 * scale, rect.center_y()),
                &bracket,
            );
            canvas.draw_line(
                (rect.right() - 4.6 * scale, rect.center_y()),
                (rect.right() - 6.4 * scale, rect.bottom() - 7.0 * scale),
                &bracket,
            );

            for i in 0..3 {
                let t = ((phase * 0.52 + i as f32 * 0.34) % 1.0).clamp(0.0, 1.0);
                let mut bit = Paint::default();
                bit.set_anti_alias(true);
                bit.set_color(Color::from_argb(
                    (alpha as f32 * (0.55 + i as f32 * 0.14)) as u8,
                    236,
                    228,
                    255,
                ));
                let x = rect.left() + 10.2 * scale + t * 16.8 * scale;
                let y = rect.top() + 6.8 * scale + i as f32 * 5.2 * scale;
                canvas.draw_round_rect(
                    Rect::from_xywh(x, y, 2.6 * scale, 1.6 * scale),
                    0.7 * scale,
                    0.7 * scale,
                    &bit,
                );
            }
        }
        ProcessingVisualKind::PdfCompress
        | ProcessingVisualKind::PdfMerge
        | ProcessingVisualKind::PdfSplit
        | ProcessingVisualKind::PdfToImage => {
            for i in 0..3 {
                let mut page = Paint::default();
                page.set_anti_alias(true);
                page.set_color(Color::from_argb(
                    (alpha as f32 * (0.42 + i as f32 * 0.18)) as u8,
                    184,
                    215,
                    255,
                ));
                canvas.draw_round_rect(
                    Rect::from_xywh(
                        rect.left() + 7.2 * scale + i as f32 * 1.6 * scale,
                        rect.top() + 6.0 * scale - i as f32 * 0.6 * scale,
                        13.8 * scale,
                        10.4 * scale,
                    ),
                    1.8 * scale,
                    1.8 * scale,
                    &page,
                );
            }
            let scan_t = (phase.sin() * 0.5 + 0.5).clamp(0.0, 1.0);
            let scan_y = rect.top() + 7.2 * scale + scan_t * 8.2 * scale;
            let mut scan = Paint::default();
            scan.set_anti_alias(true);
            scan.set_style(skia_safe::paint::Style::Stroke);
            scan.set_stroke_width(1.1 * scale);
            scan.set_color(Color::from_argb((alpha as f32 * 0.84) as u8, 76, 163, 255));
            canvas.draw_line(
                (rect.left() + 9.0 * scale, scan_y),
                (rect.left() + 23.0 * scale, scan_y),
                &scan,
            );

            let mut mark = Paint::default();
            mark.set_anti_alias(true);
            mark.set_style(skia_safe::paint::Style::Stroke);
            mark.set_stroke_width(1.0 * scale);
            mark.set_stroke_cap(skia_safe::paint::Cap::Round);
            mark.set_color(Color::from_argb((alpha as f32 * 0.82) as u8, 229, 242, 255));
            match kind {
                ProcessingVisualKind::PdfMerge => {
                    canvas.draw_line(
                        (rect.right() - 11.0 * scale, rect.top() + 8.0 * scale),
                        (rect.right() - 7.2 * scale, rect.top() + 8.0 * scale),
                        &mark,
                    );
                    canvas.draw_line(
                        (rect.right() - 9.1 * scale, rect.top() + 6.1 * scale),
                        (rect.right() - 9.1 * scale, rect.top() + 9.9 * scale),
                        &mark,
                    );
                }
                ProcessingVisualKind::PdfSplit => {
                    canvas.draw_line(
                        (rect.right() - 10.4 * scale, rect.top() + 6.5 * scale),
                        (rect.right() - 10.4 * scale, rect.top() + 10.0 * scale),
                        &mark,
                    );
                    canvas.draw_line(
                        (rect.right() - 8.0 * scale, rect.top() + 6.5 * scale),
                        (rect.right() - 8.0 * scale, rect.top() + 10.0 * scale),
                        &mark,
                    );
                }
                ProcessingVisualKind::PdfToImage => {
                    canvas.draw_circle(
                        (rect.right() - 9.2 * scale, rect.top() + 8.2 * scale),
                        1.5 * scale,
                        &mark,
                    );
                }
                _ => {
                    canvas.draw_line(
                        (rect.right() - 10.8 * scale, rect.top() + 6.8 * scale),
                        (rect.right() - 8.2 * scale, rect.top() + 9.8 * scale),
                        &mark,
                    );
                }
            }
        }
        ProcessingVisualKind::VideoTranscode
        | ProcessingVisualKind::VideoExtractAudio
        | ProcessingVisualKind::VideoClip => {
            let x0 = rect.left() + 7.0 * scale;
            let x1 = rect.right() - 7.0 * scale;
            let y = rect.center_y() + 2.0 * scale;
            let mut rail = Paint::default();
            rail.set_anti_alias(true);
            rail.set_style(skia_safe::paint::Style::Stroke);
            rail.set_stroke_width(1.2 * scale);
            rail.set_stroke_cap(skia_safe::paint::Cap::Round);
            rail.set_color(Color::from_argb((alpha as f32 * 0.34) as u8, 207, 223, 239));
            canvas.draw_line((x0, y), (x1, y), &rail);

            rail.set_color(Color::from_argb((alpha as f32 * 0.88) as u8, 151, 208, 255));
            canvas.draw_line((x0, y), (x0 + (x1 - x0) * p, y), &rail);

            let play_x = x0 + (x1 - x0) * ((phase * 0.45) % 1.0);
            let mut play = Paint::default();
            play.set_anti_alias(true);
            play.set_color(Color::from_argb((alpha as f32 * 0.92) as u8, 235, 247, 255));
            canvas.draw_circle((play_x, y), (1.3 + pulse * 0.2) * scale, &play);

            if matches!(kind, ProcessingVisualKind::VideoExtractAudio) {
                for i in 0..4 {
                    let h = (2.0 + (phase + i as f32 * 0.7).sin().abs() * 2.6) * scale;
                    let bx = rect.left() + 9.0 * scale + i as f32 * 4.0 * scale;
                    let mut bar = Paint::default();
                    bar.set_anti_alias(true);
                    bar.set_color(Color::from_argb((alpha as f32 * 0.78) as u8, 191, 226, 255));
                    canvas.draw_round_rect(
                        Rect::from_xywh(bx, rect.top() + 5.4 * scale, 2.0 * scale, h),
                        0.8 * scale,
                        0.8 * scale,
                        &bar,
                    );
                }
            }
            if matches!(kind, ProcessingVisualKind::VideoClip) {
                let mut cut = Paint::default();
                cut.set_anti_alias(true);
                cut.set_style(skia_safe::paint::Style::Stroke);
                cut.set_stroke_width(1.0 * scale);
                cut.set_color(Color::from_argb((alpha as f32 * 0.86) as u8, 234, 243, 255));
                canvas.draw_line(
                    (rect.right() - 11.0 * scale, rect.top() + 6.2 * scale),
                    (rect.right() - 11.0 * scale, rect.top() + 10.6 * scale),
                    &cut,
                );
                canvas.draw_line(
                    (rect.right() - 7.5 * scale, rect.top() + 6.2 * scale),
                    (rect.right() - 7.5 * scale, rect.top() + 10.6 * scale),
                    &cut,
                );
            }
        }
        ProcessingVisualKind::AudioConvert | ProcessingVisualKind::Music => {
            for i in 0..5 {
                let h = (2.4 + (phase * 1.35 + i as f32 * 0.9).sin().abs() * 6.1) * scale;
                let x = rect.left() + 7.2 * scale + i as f32 * 5.6 * scale;
                let y = rect.bottom() - 5.0 * scale - h;
                let mut bar = Paint::default();
                bar.set_anti_alias(true);
                bar.set_color(Color::from_argb(
                    (alpha as f32 * (0.56 + i as f32 * 0.08)) as u8,
                    255,
                    132,
                    177,
                ));
                canvas.draw_round_rect(
                    Rect::from_xywh(x, y, 3.4 * scale, h),
                    1.2 * scale,
                    1.2 * scale,
                    &bar,
                );
            }
        }
        ProcessingVisualKind::ImageCompress | ProcessingVisualKind::ImageConvert => {
            for i in 0..2 {
                let mut px = Paint::default();
                px.set_anti_alias(true);
                px.set_color(Color::from_argb((alpha as f32 * 0.84) as u8, 148, 232, 188));
                canvas.draw_round_rect(
                    Rect::from_xywh(
                        rect.left() + 7.5 * scale,
                        rect.top() + 6.0 * scale + i as f32 * 6.4 * scale,
                        6.4 * scale,
                        4.8 * scale,
                    ),
                    1.4 * scale,
                    1.4 * scale,
                    &px,
                );
            }
            let mut arrow = Paint::default();
            arrow.set_anti_alias(true);
            arrow.set_style(skia_safe::paint::Style::Stroke);
            arrow.set_stroke_width(1.2 * scale);
            arrow.set_stroke_cap(skia_safe::paint::Cap::Round);
            arrow.set_color(Color::from_argb((alpha as f32 * 0.88) as u8, 223, 255, 238));
            canvas.draw_line(
                (rect.left() + 16.2 * scale, rect.center_y()),
                (rect.right() - 12.0 * scale, rect.center_y()),
                &arrow,
            );
            canvas.draw_line(
                (rect.right() - 13.8 * scale, rect.center_y() - 1.8 * scale),
                (rect.right() - 12.0 * scale, rect.center_y()),
                &arrow,
            );
            canvas.draw_line(
                (rect.right() - 13.8 * scale, rect.center_y() + 1.8 * scale),
                (rect.right() - 12.0 * scale, rect.center_y()),
                &arrow,
            );
            let w = if matches!(kind, ProcessingVisualKind::ImageCompress) {
                4.6 * scale
            } else {
                7.2 * scale
            };
            let mut out = Paint::default();
            out.set_anti_alias(true);
            out.set_color(Color::from_argb((alpha as f32 * 0.86) as u8, 172, 244, 208));
            canvas.draw_round_rect(
                Rect::from_xywh(
                    rect.right() - 9.8 * scale,
                    rect.top() + 9.0 * scale,
                    w,
                    6.0 * scale,
                ),
                1.6 * scale,
                1.6 * scale,
                &out,
            );
        }
        ProcessingVisualKind::AiReasoning => {
            let points = [
                (rect.left() + 10.0 * scale, rect.center_y() + 3.0 * scale),
                (rect.left() + 18.0 * scale, rect.top() + 7.0 * scale),
                (rect.right() - 10.0 * scale, rect.center_y() + 3.0 * scale),
            ];
            let mut link = Paint::default();
            link.set_anti_alias(true);
            link.set_style(skia_safe::paint::Style::Stroke);
            link.set_stroke_width(1.0 * scale);
            link.set_color(Color::from_argb((alpha as f32 * 0.46) as u8, 160, 210, 255));
            canvas.draw_line(points[0], points[1], &link);
            canvas.draw_line(points[1], points[2], &link);
            canvas.draw_line(points[0], points[2], &link);

            for (i, &(x, y)) in points.iter().enumerate() {
                let mut node = Paint::default();
                node.set_anti_alias(true);
                node.set_color(Color::from_argb(
                    (alpha as f32 * (0.68 + i as f32 * 0.08)) as u8,
                    130,
                    203,
                    255,
                ));
                canvas.draw_circle((x, y), (1.6 + pulse * 0.25) * scale, &node);
            }

            let t = (phase * 0.45) % 1.0;
            let px = points[0].0 + (points[2].0 - points[0].0) * t;
            let py = points[0].1 + (points[2].1 - points[0].1) * t;
            let mut packet = Paint::default();
            packet.set_anti_alias(true);
            packet.set_color(Color::from_argb((alpha as f32 * 0.95) as u8, 236, 248, 255));
            canvas.draw_circle((px, py), 1.2 * scale, &packet);
        }
        ProcessingVisualKind::FileTransfer | ProcessingVisualKind::ImageGenerate => {}
        ProcessingVisualKind::Generic => {
            let mut star = Paint::default();
            star.set_anti_alias(true);
            star.set_style(skia_safe::paint::Style::Stroke);
            star.set_stroke_width(1.1 * scale);
            star.set_stroke_cap(skia_safe::paint::Cap::Round);
            star.set_color(Color::from_argb((alpha as f32 * 0.86) as u8, kr, kg, kb));
            let r = 5.0 * scale;
            for k in 0..4 {
                let a = phase + k as f32 * std::f32::consts::FRAC_PI_2;
                canvas.draw_line(
                    (cx + a.cos() * r * 0.2, cy + a.sin() * r * 0.2),
                    (cx + a.cos() * r, cy + a.sin() * r),
                    &star,
                );
            }
        }
    }

    let marker_x = rect.left() + 4.2 * scale + stage_idx as f32 * 5.2 * scale;
    let marker_y = rect.bottom() - 4.0 * scale;
    let mut marker = Paint::default();
    marker.set_anti_alias(true);
    marker.set_color(Color::from_argb(
        (alpha as f32 * (0.42 + stage_t * 0.46)) as u8,
        248,
        248,
        252,
    ));
    canvas.draw_circle(
        (marker_x, marker_y),
        (0.9 + stage_t * 0.22) * scale,
        &marker,
    );
}

fn draw_processing_file_transfer(
    canvas: &Canvas,
    rect: Rect,
    scale: f32,
    data: &FrameData,
    alpha: u8,
    spec: &ResolvedProcessingSpec,
    p: f32,
) {
    let cy = rect.center_y();
    let pad = 8.0 * scale;
    let (kr, kg, kb) = processing_kind_color(spec.kind);
    let phase = data.frame_count as f32 * 0.092;
    let pulse = (phase.sin() * 0.5 + 0.5).clamp(0.0, 1.0);
    let stage_idx = if p < 0.34 {
        0
    } else if p < 0.68 {
        1
    } else {
        2
    };
    let stage_t = if stage_idx == 0 {
        (p / 0.34).clamp(0.0, 1.0)
    } else if stage_idx == 1 {
        ((p - 0.34) / 0.34).clamp(0.0, 1.0)
    } else {
        ((p - 0.68) / 0.32).clamp(0.0, 1.0)
    };

    let src_w = 34.0 * scale;
    let src_h = 24.0 * scale;
    let src_x = rect.left() + pad;
    let src_y = cy - src_h / 2.0;
    let src_rect = Rect::from_xywh(src_x, src_y, src_w, src_h);

    let dst_w = 36.0 * scale;
    let dst_h = 24.0 * scale;
    let dst_x = rect.right() - pad - dst_w;
    let dst_y = cy - dst_h / 2.0;
    let dst_rect = Rect::from_xywh(dst_x, dst_y, dst_w, dst_h);

    let text_x = src_rect.right() + 7.0 * scale;
    let text_w = (dst_rect.left() - text_x - 6.0 * scale).max(1.0);

    let mut src_bg = Paint::default();
    src_bg.set_anti_alias(true);
    src_bg.set_color(Color::from_argb((alpha as f32 * 0.18) as u8, 255, 255, 255));
    canvas.draw_round_rect(src_rect, 7.0 * scale, 7.0 * scale, &src_bg);

    let mut src_tab = Paint::default();
    src_tab.set_anti_alias(true);
    src_tab.set_color(Color::from_argb((alpha as f32 * 0.30) as u8, 194, 232, 255));
    canvas.draw_round_rect(
        Rect::from_xywh(
            src_x + 3.8 * scale,
            src_y + 3.2 * scale,
            11.0 * scale,
            5.4 * scale,
        ),
        2.1 * scale,
        2.1 * scale,
        &src_tab,
    );

    for idx in 0..3 {
        let spread = idx as f32 * 1.8 * scale;
        let rise = if stage_idx == 0 {
            (2.8 - idx as f32 * 0.8) * stage_t * scale
        } else if stage_idx == 1 {
            (1.6 - idx as f32 * 0.5) * (1.0 - stage_t * 0.8) * scale
        } else {
            0.5 * (1.0 - stage_t) * scale
        };
        let mut card = Paint::default();
        card.set_anti_alias(true);
        card.set_color(if idx == 0 {
            Color::from_argb(alpha, 103, 206, 255)
        } else {
            Color::from_argb(
                (alpha as f32 * (0.56 - idx as f32 * 0.12)) as u8,
                176,
                226,
                255,
            )
        });
        canvas.draw_round_rect(
            Rect::from_xywh(
                src_x + 10.0 * scale + spread,
                src_y + 12.8 * scale - rise,
                9.0 * scale,
                7.0 * scale,
            ),
            2.1 * scale,
            2.1 * scale,
            &card,
        );
    }

    if stage_idx == 0 {
        for row in 0..3 {
            let mut line = Paint::default();
            line.set_anti_alias(true);
            line.set_style(skia_safe::paint::Style::Stroke);
            line.set_stroke_width(0.95 * scale);
            line.set_stroke_cap(skia_safe::paint::Cap::Round);
            line.set_color(Color::from_argb(
                (alpha as f32 * (0.30 + row as f32 * 0.14)) as u8,
                238,
                249,
                255,
            ));
            let y = src_y + 8.6 * scale + row as f32 * 3.0 * scale;
            let len = 3.6 * scale + stage_t * 5.2 * scale;
            canvas.draw_line(
                (src_x + 4.5 * scale, y),
                (src_x + 4.5 * scale + len, y),
                &line,
            );
        }
    }

    let mut title_p = Paint::default();
    title_p.set_anti_alias(true);
    title_p.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        spec.title.as_str(),
        (text_x, cy - 1.8 * scale),
        9.8 * scale,
        FontStyle::bold(),
        &title_p,
        false,
        text_w,
    );

    let mut stage_p = Paint::default();
    stage_p.set_anti_alias(true);
    stage_p.set_color(Color::from_argb((alpha as f32 * 0.84) as u8, kr, kg, kb));
    crate::ui::utils::draw_text_cached(
        canvas,
        spec.stages[stage_idx],
        (text_x, cy + 8.2 * scale),
        8.4 * scale,
        FontStyle::normal(),
        &stage_p,
        false,
        text_w,
    );

    let rail_x0 = src_rect.right() + 3.6 * scale;
    let rail_x1 = dst_rect.left() - 3.6 * scale;
    let rail_y = cy + 0.3 * scale;
    if rail_x1 > rail_x0 {
        let mut rail_bg = Paint::default();
        rail_bg.set_anti_alias(true);
        rail_bg.set_style(skia_safe::paint::Style::Stroke);
        rail_bg.set_stroke_width(1.15 * scale);
        rail_bg.set_stroke_cap(skia_safe::paint::Cap::Round);
        rail_bg.set_color(Color::from_argb((alpha as f32 * 0.16) as u8, 255, 255, 255));
        canvas.draw_line((rail_x0, rail_y), (rail_x1, rail_y), &rail_bg);

        let fill_x = rail_x0 + (rail_x1 - rail_x0) * p;
        let mut rail_fg = Paint::default();
        rail_fg.set_anti_alias(true);
        rail_fg.set_style(skia_safe::paint::Style::Stroke);
        rail_fg.set_stroke_width(1.5 * scale);
        rail_fg.set_stroke_cap(skia_safe::paint::Cap::Round);
        rail_fg.set_color(Color::from_argb((alpha as f32 * 0.94) as u8, 98, 207, 255));
        canvas.draw_line((rail_x0, rail_y), (fill_x, rail_y), &rail_fg);

        let nodes = [rail_x0, rail_x0 + (rail_x1 - rail_x0) * 0.5, rail_x1];
        for (idx, &node_x) in nodes.iter().enumerate() {
            let reached = stage_idx >= idx;
            let mut dot = Paint::default();
            dot.set_anti_alias(true);
            dot.set_color(if reached {
                Color::from_argb(alpha, 240, 250, 255)
            } else {
                Color::from_argb((alpha as f32 * 0.38) as u8, 190, 206, 218)
            });
            let r = if stage_idx == idx {
                (1.35 + pulse * 0.42) * scale
            } else {
                1.05 * scale
            };
            canvas.draw_circle((node_x, rail_y), r, &dot);
        }

        let seg_a = if stage_idx == 0 { nodes[0] } else { nodes[1] };
        let seg_b = if stage_idx == 0 { nodes[1] } else { nodes[2] };
        for n in 0..2 {
            let t = ((phase * 0.55 + n as f32 * 0.43) % 1.0).clamp(0.0, 1.0);
            let px = seg_a + (seg_b - seg_a) * t;
            let py = rail_y + (t * std::f32::consts::TAU + phase).sin() * 0.42 * scale;
            let mut packet = Paint::default();
            packet.set_anti_alias(true);
            packet.set_color(Color::from_argb(
                (alpha as f32 * (0.78 + n as f32 * 0.10)) as u8,
                233,
                246,
                255,
            ));
            canvas.draw_circle((px, py), (1.12 + 0.22 * pulse) * scale, &packet);
        }
    }

    let mut dst_bg = Paint::default();
    dst_bg.set_anti_alias(true);
    dst_bg.set_color(Color::from_argb((alpha as f32 * 0.16) as u8, 255, 255, 255));
    canvas.draw_round_rect(dst_rect, 7.0 * scale, 7.0 * scale, &dst_bg);

    let mut progress_fill = Paint::default();
    progress_fill.set_anti_alias(true);
    progress_fill.set_color(Color::from_argb((alpha as f32 * 0.26) as u8, 95, 202, 255));
    canvas.draw_round_rect(
        Rect::from_xywh(
            dst_x + 1.8 * scale,
            dst_y + 1.8 * scale,
            (dst_w - 3.6 * scale) * p.max(0.06),
            dst_h - 3.6 * scale,
        ),
        5.8 * scale,
        5.8 * scale,
        &progress_fill,
    );

    let mut pct = Paint::default();
    pct.set_anti_alias(true);
    pct.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        &format!("{:>2}%", (p * 100.0).round() as i32),
        (dst_rect.center_x() - 3.8 * scale, cy + 3.5 * scale),
        8.8 * scale,
        FontStyle::bold(),
        &pct,
        true,
        dst_w - 10.0 * scale,
    );

    let settle = if stage_idx == 2 { stage_t } else { 0.0 };
    if settle > 0.0 {
        let mut ok = Paint::default();
        ok.set_anti_alias(true);
        ok.set_style(skia_safe::paint::Style::Stroke);
        ok.set_stroke_cap(skia_safe::paint::Cap::Round);
        ok.set_stroke_width(1.2 * scale);
        ok.set_color(Color::from_argb(
            (alpha as f32 * (0.66 + settle * 0.28)) as u8,
            240,
            251,
            255,
        ));
        let cx = dst_rect.right() - 7.0 * scale;
        let cy_ok = dst_rect.top() + 8.8 * scale;
        canvas.draw_line(
            (cx - 2.2 * scale, cy_ok),
            (cx - 0.7 * scale, cy_ok + 1.5 * scale),
            &ok,
        );
        canvas.draw_line(
            (cx - 0.7 * scale, cy_ok + 1.5 * scale),
            (cx + 2.1 * scale, cy_ok - 1.8 * scale),
            &ok,
        );
    }
}

fn draw_processing_image_generate(
    canvas: &Canvas,
    rect: Rect,
    scale: f32,
    data: &FrameData,
    alpha: u8,
    spec: &ResolvedProcessingSpec,
    p: f32,
) {
    let cy = rect.center_y();
    let pad = 8.0 * scale;
    let phase = data.frame_count as f32 * 0.094;
    let pulse = (phase.sin() * 0.5 + 0.5).clamp(0.0, 1.0);
    let stage_idx = if p < 0.34 {
        0
    } else if p < 0.68 {
        1
    } else {
        2
    };
    let stage_t = if stage_idx == 0 {
        (p / 0.34).clamp(0.0, 1.0)
    } else if stage_idx == 1 {
        ((p - 0.34) / 0.34).clamp(0.0, 1.0)
    } else {
        ((p - 0.68) / 0.32).clamp(0.0, 1.0)
    };

    let core_w = 34.0 * scale;
    let core_h = 24.0 * scale;
    let core_x = rect.left() + pad;
    let core_y = cy - core_h / 2.0;
    let core_rect = Rect::from_xywh(core_x, core_y, core_w, core_h);

    let tile_w = 36.0 * scale;
    let tile_h = 24.0 * scale;
    let tile_x = rect.right() - pad - tile_w;
    let tile_y = cy - tile_h / 2.0;
    let tile_rect = Rect::from_xywh(tile_x, tile_y, tile_w, tile_h);

    let text_x = core_rect.right() + 7.0 * scale;
    let text_w = (tile_rect.left() - text_x - 5.0 * scale).max(1.0);

    let mut core_bg = Paint::default();
    core_bg.set_anti_alias(true);
    core_bg.set_color(Color::from_argb((alpha as f32 * 0.16) as u8, 255, 255, 255));
    canvas.draw_round_rect(core_rect, 7.0 * scale, 7.0 * scale, &core_bg);

    let cax = core_x + 12.0 * scale + phase.cos() * 0.9 * scale;
    let cay = core_y + 12.0 * scale + phase.sin() * 0.7 * scale;
    let cbx = core_x + 20.0 * scale - phase.sin() * 1.0 * scale;
    let cby = core_y + 11.0 * scale - phase.cos() * 0.75 * scale;

    let mut blob_a = Paint::default();
    blob_a.set_anti_alias(true);
    blob_a.set_color(Color::from_argb((alpha as f32 * 0.86) as u8, 255, 88, 158));
    canvas.draw_circle((cax, cay), (4.4 + pulse * 0.8) * scale, &blob_a);

    let mut blob_b = Paint::default();
    blob_b.set_anti_alias(true);
    blob_b.set_color(Color::from_argb((alpha as f32 * 0.80) as u8, 176, 96, 255));
    canvas.draw_circle((cbx, cby), (3.9 + (1.0 - pulse) * 0.9) * scale, &blob_b);

    let mut bridge = Paint::default();
    bridge.set_anti_alias(true);
    bridge.set_color(Color::from_argb((alpha as f32 * 0.54) as u8, 255, 102, 190));
    canvas.draw_round_rect(
        Rect::from_xywh(
            cax.min(cbx) - 1.9 * scale,
            ((cay + cby) * 0.5) - 2.0 * scale,
            (cax - cbx).abs() + 3.8 * scale,
            4.0 * scale,
        ),
        2.0 * scale,
        2.0 * scale,
        &bridge,
    );

    if stage_idx == 0 {
        for row in 0..3 {
            let mut token = Paint::default();
            token.set_anti_alias(true);
            token.set_style(skia_safe::paint::Style::Stroke);
            token.set_stroke_width(0.95 * scale);
            token.set_stroke_cap(skia_safe::paint::Cap::Round);
            token.set_color(Color::from_argb(
                (alpha as f32 * (0.30 + row as f32 * 0.17)) as u8,
                255,
                225,
                238,
            ));
            let y = core_y + 6.7 * scale + row as f32 * 3.2 * scale;
            let len = 3.2 * scale + stage_t * (3.5 + row as f32 * 1.1) * scale;
            canvas.draw_line(
                (core_x + 4.3 * scale, y),
                (core_x + 4.3 * scale + len, y),
                &token,
            );
        }
    } else if stage_idx == 1 {
        for i in 0..4 {
            let a = phase + i as f32 * 1.45;
            let mut dot = Paint::default();
            dot.set_anti_alias(true);
            dot.set_color(Color::from_argb(
                (alpha as f32 * (0.45 + i as f32 * 0.10)) as u8,
                255,
                196,
                220,
            ));
            let px = core_x + 16.5 * scale + a.cos() * 7.0 * scale;
            let py = core_y + 12.0 * scale + a.sin() * 5.0 * scale;
            canvas.draw_circle((px, py), (0.75 + pulse * 0.22) * scale, &dot);
        }
    } else {
        draw_sparkle_icon(
            canvas,
            core_x + 27.0 * scale,
            core_y + 4.8 * scale,
            (5.2 + 1.6 * stage_t) * scale,
            Color::from_argb((alpha as f32 * 0.94) as u8, 255, 233, 187),
        );
    }

    let mut title_p = Paint::default();
    title_p.set_anti_alias(true);
    title_p.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        spec.title.as_str(),
        (text_x, cy - 1.8 * scale),
        9.8 * scale,
        FontStyle::bold(),
        &title_p,
        false,
        text_w,
    );

    let mut stage_p = Paint::default();
    stage_p.set_anti_alias(true);
    stage_p.set_color(Color::from_argb((alpha as f32 * 0.88) as u8, 255, 113, 178));
    crate::ui::utils::draw_text_cached(
        canvas,
        spec.stages[stage_idx],
        (text_x, cy + 8.2 * scale),
        8.4 * scale,
        FontStyle::normal(),
        &stage_p,
        false,
        text_w,
    );

    let rail_x0 = text_x + 2.0 * scale;
    let rail_x1 = tile_rect.left() - 3.0 * scale;
    let rail_y = cy + 0.2 * scale;
    if rail_x1 > rail_x0 {
        let mut rail = Paint::default();
        rail.set_anti_alias(true);
        rail.set_style(skia_safe::paint::Style::Stroke);
        rail.set_stroke_width(1.15 * scale);
        rail.set_stroke_cap(skia_safe::paint::Cap::Round);
        rail.set_color(Color::from_argb((alpha as f32 * 0.18) as u8, 255, 255, 255));
        canvas.draw_line((rail_x0, rail_y), (rail_x1, rail_y), &rail);

        rail.set_stroke_width(1.5 * scale);
        rail.set_color(Color::from_argb((alpha as f32 * 0.94) as u8, 255, 92, 150));
        let fill_x = rail_x0 + (rail_x1 - rail_x0) * p;
        canvas.draw_line((rail_x0, rail_y), (fill_x, rail_y), &rail);

        for n in 0..2 {
            let t = ((phase * 0.48 + n as f32 * 0.41) % 1.0).clamp(0.0, 1.0);
            let px = rail_x0 + (rail_x1 - rail_x0) * t;
            let py = rail_y + (phase * 1.4 + t * std::f32::consts::TAU).sin() * 0.43 * scale;
            let mut packet = Paint::default();
            packet.set_anti_alias(true);
            packet.set_color(Color::from_argb(
                (alpha as f32 * (0.76 + n as f32 * 0.13)) as u8,
                255,
                226,
                240,
            ));
            canvas.draw_circle((px, py), (1.15 + 0.22 * pulse) * scale, &packet);
        }
    }

    let mut tile_bg = Paint::default();
    tile_bg.set_anti_alias(true);
    tile_bg.set_color(Color::from_argb((alpha as f32 * 0.14) as u8, 255, 255, 255));
    canvas.draw_round_rect(tile_rect, 7.0 * scale, 7.0 * scale, &tile_bg);

    let reveal = ((p * 4.0).ceil() as i32).clamp(0, 4);
    for row in 0..2 {
        for col in 0..2 {
            let idx = row * 2 + col;
            let x = tile_x + 5.0 * scale + col as f32 * 12.0 * scale;
            let y = tile_y + 4.8 * scale + row as f32 * 9.0 * scale;
            let active = idx < reveal;
            let mut cell = Paint::default();
            cell.set_anti_alias(true);
            cell.set_color(if active {
                Color::from_argb((alpha as f32 * 0.90) as u8, 255, 102, 170)
            } else {
                Color::from_argb((alpha as f32 * 0.22) as u8, 255, 255, 255)
            });
            canvas.draw_round_rect(
                Rect::from_xywh(x, y, 9.2 * scale, 6.2 * scale),
                2.4 * scale,
                2.4 * scale,
                &cell,
            );
        }
    }

    let focus_idx = ((phase * 1.2) as i32).rem_euclid(4);
    let focus_col = (focus_idx % 2) as f32;
    let focus_row = (focus_idx / 2) as f32;
    let focus_x = tile_x + 5.0 * scale + focus_col * 12.0 * scale;
    let focus_y = tile_y + 4.8 * scale + focus_row * 9.0 * scale;
    let mut focus = Paint::default();
    focus.set_anti_alias(true);
    focus.set_style(skia_safe::paint::Style::Stroke);
    focus.set_stroke_width(0.9 * scale);
    focus.set_color(Color::from_argb((alpha as f32 * 0.64) as u8, 255, 236, 244));
    canvas.draw_round_rect(
        Rect::from_xywh(
            focus_x - 0.6 * scale,
            focus_y - 0.6 * scale,
            10.4 * scale,
            7.4 * scale,
        ),
        2.6 * scale,
        2.6 * scale,
        &focus,
    );

    if stage_idx == 2 {
        let mut glow = Paint::default();
        glow.set_anti_alias(true);
        glow.set_style(skia_safe::paint::Style::Stroke);
        glow.set_stroke_width(1.0 * scale);
        glow.set_color(Color::from_argb(
            (alpha as f32 * (0.26 + stage_t * 0.34)) as u8,
            255,
            188,
            219,
        ));
        canvas.draw_round_rect(
            Rect::from_xywh(
                tile_x - 0.8 * scale,
                tile_y - 0.8 * scale,
                tile_w + 1.6 * scale,
                tile_h + 1.6 * scale,
            ),
            7.8 * scale,
            7.8 * scale,
            &glow,
        );
    }
}

#[derive(Clone, Copy, Debug)]
enum ProcessingVisualKind {
    ImageGenerate,
    PdfCompress,
    PdfMerge,
    PdfSplit,
    PdfToImage,
    ImageCompress,
    ImageConvert,
    AudioConvert,
    VideoTranscode,
    VideoExtractAudio,
    VideoClip,
    Music,
    JsonFormat,
    FileTransfer,
    WorkspaceGenerate,
    NetworkSearch,
    CodeTransform,
    AiReasoning,
    Generic,
}

fn processing_kind_color(kind: ProcessingVisualKind) -> (u8, u8, u8) {
    match kind {
        ProcessingVisualKind::ImageGenerate => (255, 80, 136),
        ProcessingVisualKind::PdfCompress
        | ProcessingVisualKind::PdfMerge
        | ProcessingVisualKind::PdfSplit
        | ProcessingVisualKind::PdfToImage => (90, 168, 255),
        ProcessingVisualKind::ImageCompress | ProcessingVisualKind::ImageConvert => (112, 216, 171),
        ProcessingVisualKind::AudioConvert | ProcessingVisualKind::Music => (255, 96, 142),
        ProcessingVisualKind::VideoTranscode
        | ProcessingVisualKind::VideoExtractAudio
        | ProcessingVisualKind::VideoClip => (127, 188, 255),
        ProcessingVisualKind::JsonFormat => (166, 155, 255),
        ProcessingVisualKind::FileTransfer => (95, 202, 255),
        ProcessingVisualKind::WorkspaceGenerate => (255, 173, 86),
        ProcessingVisualKind::NetworkSearch => (90, 220, 193),
        ProcessingVisualKind::CodeTransform => (179, 143, 255),
        ProcessingVisualKind::AiReasoning => (83, 169, 255),
        ProcessingVisualKind::Generic => (10, 132, 255),
    }
}

#[derive(Clone, Copy)]
struct ToolMotionSpec {
    id: &'static str,
    title: &'static str,
    kind: ProcessingVisualKind,
    stages: [&'static str; 3],
    aliases: &'static [&'static str],
}

#[derive(Clone)]
struct ResolvedProcessingSpec {
    title: String,
    kind: ProcessingVisualKind,
    stages: [&'static str; 3],
}

const STAGES_FILE: [&str; 3] = ["Receiving file", "Running pipeline", "Ready"];
const STAGES_IMAGE_GEN: [&str; 3] = ["Parsing prompt", "Rendering frame", "Preview ready"];
const STAGES_IMAGE: [&str; 3] = ["Reading image", "Applying transform", "Image ready"];
const STAGES_AUDIO: [&str; 3] = ["Reading audio", "Processing signal", "Audio ready"];
const STAGES_VIDEO: [&str; 3] = ["Analyzing video", "Rendering output", "Video ready"];
const STAGES_VIDEO_AUDIO: [&str; 3] = ["Scanning tracks", "Extracting audio", "Audio ready"];
const STAGES_VIDEO_CLIP: [&str; 3] = ["Finding range", "Cutting clip", "Clip ready"];
const STAGES_PDF: [&str; 3] = ["Reading pages", "Processing document", "PDF ready"];
const STAGES_PDF_MERGE: [&str; 3] = ["Collecting files", "Merging pages", "Merge ready"];
const STAGES_PDF_SPLIT: [&str; 3] = ["Reading ranges", "Splitting pages", "Split ready"];
const STAGES_PDF_TO_IMAGE: [&str; 3] = ["Reading pages", "Rendering image", "Image ready"];
const STAGES_NET: [&str; 3] = ["Starting search", "Organizing signal", "Result ready"];
const STAGES_MUSIC: [&str; 3] = ["Searching catalog", "Preparing playback", "Ready to listen"];
const STAGES_CODE: [&str; 3] = ["Reading input", "Applying transform", "Output ready"];
const STAGES_WORKSPACE: [&str; 3] = ["Preparing canvas", "Building layout", "Workspace ready"];
const STAGES_AI: [&str; 3] = ["Understanding intent", "Reasoning", "Reply ready"];

const TOOL_MOTION_SPECS: &[ToolMotionSpec] = &[
    ToolMotionSpec {
        id: "file.upload",
        title: "File Upload",
        kind: ProcessingVisualKind::FileTransfer,
        stages: STAGES_FILE,
        aliases: &["uploading file", "upload file"],
    },
    ToolMotionSpec {
        id: "file.process",
        title: "File Process",
        kind: ProcessingVisualKind::FileTransfer,
        stages: STAGES_FILE,
        aliases: &["processing file", "process file"],
    },
    ToolMotionSpec {
        id: "ai.reasoning",
        title: "AI Reasoning",
        kind: ProcessingVisualKind::AiReasoning,
        stages: STAGES_AI,
        aliases: &["generating result", "ai thinking", "assistant reasoning"],
    },
    ToolMotionSpec {
        id: "audio.compress",
        title: "Audio Compress",
        kind: ProcessingVisualKind::AudioConvert,
        stages: STAGES_AUDIO,
        aliases: &["audio compress"],
    },
    ToolMotionSpec {
        id: "audio.convert",
        title: "Audio Convert",
        kind: ProcessingVisualKind::AudioConvert,
        stages: STAGES_AUDIO,
        aliases: &["audio convert"],
    },
    ToolMotionSpec {
        id: "audio.normalize",
        title: "Audio Normalize",
        kind: ProcessingVisualKind::AudioConvert,
        stages: STAGES_AUDIO,
        aliases: &["audio normalize"],
    },
    ToolMotionSpec {
        id: "audio.trim",
        title: "Audio Trim",
        kind: ProcessingVisualKind::AudioConvert,
        stages: STAGES_AUDIO,
        aliases: &["audio trim"],
    },
    ToolMotionSpec {
        id: "convert.csv_json",
        title: "CSV to JSON",
        kind: ProcessingVisualKind::JsonFormat,
        stages: STAGES_CODE,
        aliases: &["csv json"],
    },
    ToolMotionSpec {
        id: "convert.json_csv",
        title: "JSON to CSV",
        kind: ProcessingVisualKind::JsonFormat,
        stages: STAGES_CODE,
        aliases: &["json csv"],
    },
    ToolMotionSpec {
        id: "convert.json_format",
        title: "JSON Format",
        kind: ProcessingVisualKind::JsonFormat,
        stages: STAGES_CODE,
        aliases: &["json format", "json prettify"],
    },
    ToolMotionSpec {
        id: "convert.json_yaml",
        title: "JSON to YAML",
        kind: ProcessingVisualKind::JsonFormat,
        stages: STAGES_CODE,
        aliases: &["json yaml"],
    },
    ToolMotionSpec {
        id: "convert.md_html",
        title: "Markdown to HTML",
        kind: ProcessingVisualKind::JsonFormat,
        stages: STAGES_CODE,
        aliases: &["markdown html"],
    },
    ToolMotionSpec {
        id: "convert.yaml_json",
        title: "YAML to JSON",
        kind: ProcessingVisualKind::JsonFormat,
        stages: STAGES_CODE,
        aliases: &["yaml json"],
    },
    ToolMotionSpec {
        id: "decode.base64",
        title: "Base64 Decode",
        kind: ProcessingVisualKind::CodeTransform,
        stages: STAGES_CODE,
        aliases: &["base64 decode"],
    },
    ToolMotionSpec {
        id: "decode.jwt",
        title: "JWT Decode",
        kind: ProcessingVisualKind::CodeTransform,
        stages: STAGES_CODE,
        aliases: &["jwt decode"],
    },
    ToolMotionSpec {
        id: "decode.url",
        title: "URL Decode",
        kind: ProcessingVisualKind::CodeTransform,
        stages: STAGES_CODE,
        aliases: &["url decode"],
    },
    ToolMotionSpec {
        id: "dev.diff",
        title: "Diff Compare",
        kind: ProcessingVisualKind::CodeTransform,
        stages: STAGES_CODE,
        aliases: &["dev diff"],
    },
    ToolMotionSpec {
        id: "dev.run_code",
        title: "Code Sandbox",
        kind: ProcessingVisualKind::CodeTransform,
        stages: STAGES_CODE,
        aliases: &["run code", "code sandbox"],
    },
    ToolMotionSpec {
        id: "dev.sandbox",
        title: "Live Sandbox",
        kind: ProcessingVisualKind::CodeTransform,
        stages: STAGES_CODE,
        aliases: &["live sandbox"],
    },
    ToolMotionSpec {
        id: "encode.base64",
        title: "Base64 Encode",
        kind: ProcessingVisualKind::CodeTransform,
        stages: STAGES_CODE,
        aliases: &["base64 encode"],
    },
    ToolMotionSpec {
        id: "encode.url",
        title: "URL Encode",
        kind: ProcessingVisualKind::CodeTransform,
        stages: STAGES_CODE,
        aliases: &["url encode"],
    },
    ToolMotionSpec {
        id: "generate.canvas",
        title: "Vector Canvas",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["generate canvas"],
    },
    ToolMotionSpec {
        id: "generate.chart",
        title: "Chart Builder",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["generate chart"],
    },
    ToolMotionSpec {
        id: "generate.color_palette",
        title: "Color Palette",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["color palette"],
    },
    ToolMotionSpec {
        id: "generate.countdown",
        title: "Countdown",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["generate countdown"],
    },
    ToolMotionSpec {
        id: "generate.dashboard",
        title: "Dashboard",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["generate dashboard"],
    },
    ToolMotionSpec {
        id: "generate.diagram",
        title: "Diagram",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["generate diagram"],
    },
    ToolMotionSpec {
        id: "generate.document",
        title: "Document",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["generate document"],
    },
    ToolMotionSpec {
        id: "generate.excalidraw",
        title: "Excalidraw",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["generate excalidraw"],
    },
    ToolMotionSpec {
        id: "generate.flashcards",
        title: "Flashcards",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["generate flashcards"],
    },
    ToolMotionSpec {
        id: "generate.flow",
        title: "Flow Editor",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["generate flow"],
    },
    ToolMotionSpec {
        id: "generate.graph",
        title: "Graph Viewer",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["generate graph"],
    },
    ToolMotionSpec {
        id: "generate.habits",
        title: "Habit Tracker",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["generate habits"],
    },
    ToolMotionSpec {
        id: "generate.image",
        title: "Image Generate",
        kind: ProcessingVisualKind::ImageGenerate,
        stages: STAGES_IMAGE_GEN,
        aliases: &["generate image", "image generation"],
    },
    ToolMotionSpec {
        id: "generate.kanban",
        title: "Kanban",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["generate kanban"],
    },
    ToolMotionSpec {
        id: "generate.mindmap",
        title: "Mindmap",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["generate mindmap"],
    },
    ToolMotionSpec {
        id: "generate.password",
        title: "Password Generate",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["generate password"],
    },
    ToolMotionSpec {
        id: "generate.pomodoro",
        title: "Pomodoro",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["generate pomodoro"],
    },
    ToolMotionSpec {
        id: "generate.qrcode",
        title: "QR Code",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["generate qrcode"],
    },
    ToolMotionSpec {
        id: "generate.spreadsheet",
        title: "Spreadsheet",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["generate spreadsheet"],
    },
    ToolMotionSpec {
        id: "generate.timestamp",
        title: "Timestamp",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["generate timestamp"],
    },
    ToolMotionSpec {
        id: "generate.toolkit",
        title: "UI Toolkit",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["generate toolkit"],
    },
    ToolMotionSpec {
        id: "generate.univer",
        title: "Univer Sheet",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["generate univer"],
    },
    ToolMotionSpec {
        id: "generate.uuid",
        title: "UUID Generate",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["generate uuid"],
    },
    ToolMotionSpec {
        id: "generate.whiteboard",
        title: "Whiteboard",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["generate whiteboard"],
    },
    ToolMotionSpec {
        id: "generate.worldclock",
        title: "World Clock",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["generate worldclock"],
    },
    ToolMotionSpec {
        id: "generate.writing",
        title: "Writing Editor",
        kind: ProcessingVisualKind::WorkspaceGenerate,
        stages: STAGES_WORKSPACE,
        aliases: &["generate writing"],
    },
    ToolMotionSpec {
        id: "hash.md5",
        title: "MD5 Hash",
        kind: ProcessingVisualKind::CodeTransform,
        stages: STAGES_CODE,
        aliases: &["hash md5"],
    },
    ToolMotionSpec {
        id: "hash.password",
        title: "Password Hash",
        kind: ProcessingVisualKind::CodeTransform,
        stages: STAGES_CODE,
        aliases: &["hash password"],
    },
    ToolMotionSpec {
        id: "hash.sha256",
        title: "SHA256 Hash",
        kind: ProcessingVisualKind::CodeTransform,
        stages: STAGES_CODE,
        aliases: &["hash sha256"],
    },
    ToolMotionSpec {
        id: "hash.sha512",
        title: "SHA512 Hash",
        kind: ProcessingVisualKind::CodeTransform,
        stages: STAGES_CODE,
        aliases: &["hash sha512"],
    },
    ToolMotionSpec {
        id: "image.compress",
        title: "Image Compress",
        kind: ProcessingVisualKind::ImageCompress,
        stages: STAGES_IMAGE,
        aliases: &["image compress"],
    },
    ToolMotionSpec {
        id: "image.convert",
        title: "Image Convert",
        kind: ProcessingVisualKind::ImageConvert,
        stages: STAGES_IMAGE,
        aliases: &["image convert"],
    },
    ToolMotionSpec {
        id: "image.crop",
        title: "Image Crop",
        kind: ProcessingVisualKind::ImageConvert,
        stages: STAGES_IMAGE,
        aliases: &["image crop"],
    },
    ToolMotionSpec {
        id: "image.metadata",
        title: "Image Metadata",
        kind: ProcessingVisualKind::ImageConvert,
        stages: STAGES_IMAGE,
        aliases: &["image metadata"],
    },
    ToolMotionSpec {
        id: "image.resize",
        title: "Image Resize",
        kind: ProcessingVisualKind::ImageConvert,
        stages: STAGES_IMAGE,
        aliases: &["image resize"],
    },
    ToolMotionSpec {
        id: "image.rotate",
        title: "Image Rotate",
        kind: ProcessingVisualKind::ImageConvert,
        stages: STAGES_IMAGE,
        aliases: &["image rotate"],
    },
    ToolMotionSpec {
        id: "media.download_audio",
        title: "Media Audio Download",
        kind: ProcessingVisualKind::FileTransfer,
        stages: STAGES_FILE,
        aliases: &["download audio"],
    },
    ToolMotionSpec {
        id: "media.download_video",
        title: "Media Video Download",
        kind: ProcessingVisualKind::FileTransfer,
        stages: STAGES_FILE,
        aliases: &["download video"],
    },
    ToolMotionSpec {
        id: "media.extract_subtitle",
        title: "Subtitle Extract",
        kind: ProcessingVisualKind::FileTransfer,
        stages: STAGES_FILE,
        aliases: &["extract subtitle"],
    },
    ToolMotionSpec {
        id: "media.video_info",
        title: "Media Video Info",
        kind: ProcessingVisualKind::NetworkSearch,
        stages: STAGES_NET,
        aliases: &["video info"],
    },
    ToolMotionSpec {
        id: "net.dns_lookup",
        title: "DNS Lookup",
        kind: ProcessingVisualKind::NetworkSearch,
        stages: STAGES_NET,
        aliases: &["dns lookup"],
    },
    ToolMotionSpec {
        id: "net.ip_info",
        title: "IP Info",
        kind: ProcessingVisualKind::NetworkSearch,
        stages: STAGES_NET,
        aliases: &["ip info"],
    },
    ToolMotionSpec {
        id: "net.music_search",
        title: "Music Search",
        kind: ProcessingVisualKind::Music,
        stages: STAGES_MUSIC,
        aliases: &["music search", "search song"],
    },
    ToolMotionSpec {
        id: "web.search",
        title: "Web Search",
        kind: ProcessingVisualKind::NetworkSearch,
        stages: STAGES_NET,
        aliases: &["web search", "tavily"],
    },
    ToolMotionSpec {
        id: "pdf.compress",
        title: "PDF Compress",
        kind: ProcessingVisualKind::PdfCompress,
        stages: STAGES_PDF,
        aliases: &["pdf compress"],
    },
    ToolMotionSpec {
        id: "pdf.merge",
        title: "PDF Merge",
        kind: ProcessingVisualKind::PdfMerge,
        stages: STAGES_PDF_MERGE,
        aliases: &["pdf merge"],
    },
    ToolMotionSpec {
        id: "pdf.page_count",
        title: "PDF Page Count",
        kind: ProcessingVisualKind::PdfCompress,
        stages: STAGES_PDF,
        aliases: &["pdf page count"],
    },
    ToolMotionSpec {
        id: "pdf.split",
        title: "PDF Split",
        kind: ProcessingVisualKind::PdfSplit,
        stages: STAGES_PDF_SPLIT,
        aliases: &["pdf split"],
    },
    ToolMotionSpec {
        id: "pdf.to_image",
        title: "PDF to Image",
        kind: ProcessingVisualKind::PdfToImage,
        stages: STAGES_PDF_TO_IMAGE,
        aliases: &["pdf to image"],
    },
    ToolMotionSpec {
        id: "video.compress",
        title: "Video Compress",
        kind: ProcessingVisualKind::VideoTranscode,
        stages: STAGES_VIDEO,
        aliases: &["video compress"],
    },
    ToolMotionSpec {
        id: "video.convert",
        title: "Video Convert",
        kind: ProcessingVisualKind::VideoTranscode,
        stages: STAGES_VIDEO,
        aliases: &["video convert", "video transcode"],
    },
    ToolMotionSpec {
        id: "video.extract_audio",
        title: "Video Extract Audio",
        kind: ProcessingVisualKind::VideoExtractAudio,
        stages: STAGES_VIDEO_AUDIO,
        aliases: &["extract audio"],
    },
    ToolMotionSpec {
        id: "video.to_gif",
        title: "Video to GIF",
        kind: ProcessingVisualKind::VideoTranscode,
        stages: STAGES_VIDEO,
        aliases: &["video gif"],
    },
    ToolMotionSpec {
        id: "video.trim",
        title: "Video Trim",
        kind: ProcessingVisualKind::VideoClip,
        stages: STAGES_VIDEO_CLIP,
        aliases: &["video trim", "video clip"],
    },
    ToolMotionSpec {
        id: "official.pdf.compress",
        title: "PDF Compress",
        kind: ProcessingVisualKind::PdfCompress,
        stages: STAGES_PDF,
        aliases: &[],
    },
    ToolMotionSpec {
        id: "official.pdf.merge",
        title: "PDF Merge",
        kind: ProcessingVisualKind::PdfMerge,
        stages: STAGES_PDF_MERGE,
        aliases: &[],
    },
    ToolMotionSpec {
        id: "official.pdf.split",
        title: "PDF Split",
        kind: ProcessingVisualKind::PdfSplit,
        stages: STAGES_PDF_SPLIT,
        aliases: &[],
    },
    ToolMotionSpec {
        id: "official.video.transcode",
        title: "Video Transcode",
        kind: ProcessingVisualKind::VideoTranscode,
        stages: STAGES_VIDEO,
        aliases: &[],
    },
    ToolMotionSpec {
        id: "official.video.extract_audio",
        title: "Video Extract Audio",
        kind: ProcessingVisualKind::VideoExtractAudio,
        stages: STAGES_VIDEO_AUDIO,
        aliases: &[],
    },
    ToolMotionSpec {
        id: "official.video.extract-audio",
        title: "Video Extract Audio",
        kind: ProcessingVisualKind::VideoExtractAudio,
        stages: STAGES_VIDEO_AUDIO,
        aliases: &[],
    },
    ToolMotionSpec {
        id: "official.video.clip",
        title: "Video Clip",
        kind: ProcessingVisualKind::VideoClip,
        stages: STAGES_VIDEO_CLIP,
        aliases: &[],
    },
    ToolMotionSpec {
        id: "official.utility.json_format",
        title: "JSON Format",
        kind: ProcessingVisualKind::JsonFormat,
        stages: STAGES_CODE,
        aliases: &[],
    },
    ToolMotionSpec {
        id: "official.utility.json-format",
        title: "JSON Format",
        kind: ProcessingVisualKind::JsonFormat,
        stages: STAGES_CODE,
        aliases: &[],
    },
];

fn resolve_processing_spec(label: &str) -> ResolvedProcessingSpec {
    if let Some(spec) = find_tool_motion_spec(label) {
        return ResolvedProcessingSpec {
            title: spec.title.to_string(),
            kind: spec.kind,
            stages: spec.stages,
        };
    }

    let kind = detect_processing_kind_fallback(label);
    ResolvedProcessingSpec {
        title: clean_processing_title(label),
        kind,
        stages: default_stage_labels_for_kind(kind),
    }
}

fn find_tool_motion_spec(label: &str) -> Option<&'static ToolMotionSpec> {
    let raw = label.trim().to_ascii_lowercase();
    let normalized_tool = raw.strip_prefix("tool:").unwrap_or(raw.as_str()).trim();

    for spec in TOOL_MOTION_SPECS {
        if normalized_tool == spec.id
            || normalized_tool.starts_with(spec.id)
            || normalized_tool.contains(spec.id)
        {
            return Some(spec);
        }
    }

    let normalized_label = normalize_processing_label(normalized_tool);
    for spec in TOOL_MOTION_SPECS {
        for alias in spec.aliases {
            if !alias.is_empty() && normalized_label.contains(alias) {
                return Some(spec);
            }
        }
    }
    None
}

fn normalize_processing_label(raw: &str) -> String {
    let mut out = raw.to_ascii_lowercase();
    out = out.replace(['.', '_', '-', '/'], " ");
    while out.contains("  ") {
        out = out.replace("  ", " ");
    }
    out.trim().to_string()
}

fn clean_processing_title(label: &str) -> String {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        return "Processing".to_string();
    }
    let mut out = trimmed.replace(['.', '_'], " ");
    while out.contains("  ") {
        out = out.replace("  ", " ");
    }
    out
}

fn default_stage_labels_for_kind(kind: ProcessingVisualKind) -> [&'static str; 3] {
    match kind {
        ProcessingVisualKind::ImageGenerate => {
            ["Parsing prompt", "Rendering frame", "Preview ready"]
        }
        ProcessingVisualKind::PdfCompress => {
            ["Scanning pages", "Compressing document", "PDF ready"]
        }
        ProcessingVisualKind::PdfMerge => ["Collecting files", "Merging pages", "Document ready"],
        ProcessingVisualKind::PdfSplit => ["Reading ranges", "Splitting pages", "Document ready"],
        ProcessingVisualKind::PdfToImage => ["Reading pages", "Rendering image", "Image ready"],
        ProcessingVisualKind::ImageCompress => ["Reading image", "Optimizing asset", "Image ready"],
        ProcessingVisualKind::ImageConvert => {
            ["Analyzing image", "Converting format", "Image ready"]
        }
        ProcessingVisualKind::AudioConvert => ["Reading audio", "Converting signal", "Audio ready"],
        ProcessingVisualKind::VideoTranscode => {
            ["Reading video", "Transcoding output", "Video ready"]
        }
        ProcessingVisualKind::VideoExtractAudio => {
            ["Scanning tracks", "Extracting audio", "Audio ready"]
        }
        ProcessingVisualKind::VideoClip => ["Finding range", "Cutting clip", "Clip ready"],
        ProcessingVisualKind::Music => {
            ["Searching catalog", "Preparing playback", "Ready to listen"]
        }
        ProcessingVisualKind::JsonFormat => {
            ["Parsing structure", "Formatting data", "Output ready"]
        }
        ProcessingVisualKind::FileTransfer => {
            ["Receiving file", "Running pipeline", "Result ready"]
        }
        ProcessingVisualKind::WorkspaceGenerate => {
            ["Preparing canvas", "Building layout", "Workspace ready"]
        }
        ProcessingVisualKind::NetworkSearch => {
            ["Starting search", "Organizing signal", "Result ready"]
        }
        ProcessingVisualKind::CodeTransform => {
            ["Reading input", "Applying transform", "Output ready"]
        }
        ProcessingVisualKind::AiReasoning => ["Understanding intent", "Reasoning", "Reply ready"],
        ProcessingVisualKind::Generic => ["Preparing", "Processing", "Complete"],
    }
}

fn detect_processing_kind_fallback(label: &str) -> ProcessingVisualKind {
    let l = label.to_ascii_lowercase();

    if l.contains("generate.image")
        || l.contains("image.generate")
        || l.contains("image generation")
        || l.contains("image gen")
        || l.contains("generate image")
        || l.contains("generating image")
    {
        return ProcessingVisualKind::ImageGenerate;
    }
    if l.contains("pdf.to_image") || l.contains("pdf to image") {
        return ProcessingVisualKind::PdfToImage;
    }
    if l.contains("pdf.merge") || l.contains("pdf merge") {
        return ProcessingVisualKind::PdfMerge;
    }
    if l.contains("pdf.split") || l.contains("pdf split") {
        return ProcessingVisualKind::PdfSplit;
    }
    if l.contains("pdf.compress") || l.contains("pdf compress") || l.contains("pdf.page_count") {
        return ProcessingVisualKind::PdfCompress;
    }
    if l.contains("image.convert")
        || l.contains("image convert")
        || l.contains("image.resize")
        || l.contains("image.crop")
        || l.contains("image.rotate")
        || l.contains("image.metadata")
    {
        return ProcessingVisualKind::ImageConvert;
    }
    if l.contains("image.compress") || l.contains("image compress") {
        return ProcessingVisualKind::ImageCompress;
    }
    if l.contains("video.extract_audio")
        || l.contains("video extract audio")
        || l.contains("video.extract-audio")
        || l.contains("extract audio")
    {
        return ProcessingVisualKind::VideoExtractAudio;
    }
    if l.contains("video.trim")
        || l.contains("video clip")
        || l.contains("video.clip")
        || l.contains("official.video.clip")
        || l.contains("clip")
    {
        return ProcessingVisualKind::VideoClip;
    }
    if l.contains("video.convert")
        || l.contains("video transcode")
        || l.contains("video.to_gif")
        || l.contains("video.compress")
        || l.contains("official.video.transcode")
        || l.contains("transcode")
    {
        return ProcessingVisualKind::VideoTranscode;
    }
    if l.contains("audio.convert")
        || l.contains("audio convert")
        || l.contains("audio.normalize")
        || l.contains("audio.trim")
        || l.contains("audio.compress")
    {
        return ProcessingVisualKind::AudioConvert;
    }
    if l.contains("json")
        || l.contains("yaml")
        || l.contains("csv")
        || l.contains("md_html")
        || l.contains("markdown")
    {
        return ProcessingVisualKind::JsonFormat;
    }
    if l.contains("music") || l.contains("song") || l.contains("netease") {
        return ProcessingVisualKind::Music;
    }
    if l.contains("web.search")
        || l.contains("dns")
        || l.contains("ip_info")
        || l.contains("ip info")
        || l.contains("lookup")
        || l.contains("tavily")
    {
        return ProcessingVisualKind::NetworkSearch;
    }
    if l.contains("encode.")
        || l.contains("decode.")
        || l.contains("hash.")
        || l.contains("dev.")
        || l.contains("run_code")
        || l.contains("sandbox")
    {
        return ProcessingVisualKind::CodeTransform;
    }
    if (l.contains("generate.") && !l.contains("generate.image"))
        || l.contains("whiteboard")
        || l.contains("kanban")
        || l.contains("mindmap")
        || l.contains("dashboard")
        || l.contains("spreadsheet")
    {
        return ProcessingVisualKind::WorkspaceGenerate;
    }
    if l.contains("uploading file")
        || l.contains("upload complete")
        || l.contains("processing file")
        || l.contains("file upload")
        || l.contains("media.download")
        || l.contains("saved successfully")
        || l.contains("click download")
    {
        return ProcessingVisualKind::FileTransfer;
    }
    if l.contains("ai thinking")
        || l.contains("generating result")
        || l.contains("assistant")
        || l.contains("reasoning")
        || l.contains("thinking")
    {
        return ProcessingVisualKind::AiReasoning;
    }
    if l.contains("pdf") {
        return ProcessingVisualKind::PdfCompress;
    }
    if l.contains("image") || l.contains("png") || l.contains("jpg") || l.contains("webp") {
        return ProcessingVisualKind::ImageConvert;
    }
    if l.contains("audio") {
        return ProcessingVisualKind::AudioConvert;
    }
    if l.contains("video") || l.contains("gif") || l.contains("media") {
        return ProcessingVisualKind::VideoTranscode;
    }
    ProcessingVisualKind::Generic
}

fn detect_processing_kind(label: &str) -> ProcessingVisualKind {
    resolve_processing_spec(label).kind
}

fn draw_processing_icon(
    canvas: &Canvas,
    cx: f32,
    cy: f32,
    scale: f32,
    frame: u64,
    alpha: u8,
    kind: ProcessingVisualKind,
) {
    match kind {
        ProcessingVisualKind::ImageGenerate => {
            draw_image_generate_processing_icon(canvas, cx, cy, scale, frame, alpha)
        }
        ProcessingVisualKind::PdfCompress => {
            draw_pdf_processing_icon(canvas, cx, cy, scale, frame, alpha)
        }
        ProcessingVisualKind::PdfMerge => {
            draw_pdf_merge_processing_icon(canvas, cx, cy, scale, frame, alpha)
        }
        ProcessingVisualKind::PdfSplit => {
            draw_pdf_split_processing_icon(canvas, cx, cy, scale, frame, alpha)
        }
        ProcessingVisualKind::PdfToImage => {
            draw_pdf_to_image_processing_icon(canvas, cx, cy, scale, frame, alpha)
        }
        ProcessingVisualKind::ImageCompress => {
            draw_image_processing_icon(canvas, cx, cy, scale, frame, alpha)
        }
        ProcessingVisualKind::ImageConvert => {
            draw_image_convert_processing_icon(canvas, cx, cy, scale, frame, alpha)
        }
        ProcessingVisualKind::AudioConvert => {
            draw_audio_processing_icon(canvas, cx, cy, scale, frame, alpha)
        }
        ProcessingVisualKind::VideoTranscode => {
            draw_video_processing_icon(canvas, cx, cy, scale, frame, alpha)
        }
        ProcessingVisualKind::VideoExtractAudio => {
            draw_video_extract_audio_processing_icon(canvas, cx, cy, scale, frame, alpha)
        }
        ProcessingVisualKind::VideoClip => {
            draw_video_clip_processing_icon(canvas, cx, cy, scale, frame, alpha)
        }
        ProcessingVisualKind::Music => {
            draw_music_processing_icon(canvas, cx, cy, scale, frame, alpha)
        }
        ProcessingVisualKind::JsonFormat => {
            draw_json_processing_icon(canvas, cx, cy, scale, frame, alpha)
        }
        ProcessingVisualKind::FileTransfer => {
            draw_file_transfer_processing_icon(canvas, cx, cy, scale, frame, alpha)
        }
        ProcessingVisualKind::WorkspaceGenerate => {
            draw_workspace_processing_icon(canvas, cx, cy, scale, frame, alpha)
        }
        ProcessingVisualKind::NetworkSearch => {
            draw_network_processing_icon(canvas, cx, cy, scale, frame, alpha)
        }
        ProcessingVisualKind::CodeTransform => {
            draw_code_processing_icon(canvas, cx, cy, scale, frame, alpha)
        }
        ProcessingVisualKind::AiReasoning => {
            draw_ai_reasoning_processing_icon(canvas, cx, cy, scale, frame, alpha)
        }
        ProcessingVisualKind::Generic => {
            draw_breathing_orb(canvas, cx, cy, 7.0 * scale, 10, 132, 255, frame, alpha)
        }
    }
}

fn draw_image_generate_processing_icon(
    canvas: &Canvas,
    cx: f32,
    cy: f32,
    scale: f32,
    frame: u64,
    alpha: u8,
) {
    let phase = frame as f32 * 0.095;
    let pulse = (phase.sin() * 0.5 + 0.5).clamp(0.0, 1.0);
    let orbit_r = (5.8 + pulse * 1.8) * scale;

    let mut core = Paint::default();
    core.set_anti_alias(true);
    core.set_color(Color::from_argb(
        (alpha as f32 * (0.52 + pulse * 0.35)) as u8,
        255,
        43,
        85,
    ));
    canvas.draw_circle((cx, cy), (3.8 + pulse * 1.2) * scale, &core);

    let orbit_x = cx + orbit_r * phase.cos();
    let orbit_y = cy + orbit_r * phase.sin();
    let mut orbit = Paint::default();
    orbit.set_anti_alias(true);
    orbit.set_color(Color::from_argb((alpha as f32 * 0.88) as u8, 255, 255, 255));
    canvas.draw_circle((orbit_x, orbit_y), 1.9 * scale, &orbit);

    let mut star = Paint::default();
    star.set_anti_alias(true);
    star.set_style(skia_safe::paint::Style::Stroke);
    star.set_stroke_cap(skia_safe::paint::Cap::Round);
    star.set_stroke_width(1.35 * scale);
    star.set_color(Color::from_argb(alpha, 255, 230, 170));
    canvas.draw_line(
        (cx - 0.1 * scale, cy - 6.0 * scale),
        (cx - 0.1 * scale, cy - 2.8 * scale),
        &star,
    );
    canvas.draw_line(
        (cx - 1.7 * scale, cy - 4.4 * scale),
        (cx + 1.5 * scale, cy - 4.4 * scale),
        &star,
    );
}

fn draw_pdf_processing_icon(canvas: &Canvas, cx: f32, cy: f32, scale: f32, frame: u64, alpha: u8) {
    let phase = frame as f32 * 0.08;
    let offset = phase.sin() * 1.2 * scale;
    let w = 12.5 * scale;
    let h = 9.0 * scale;

    let mut back = Paint::default();
    back.set_anti_alias(true);
    back.set_color(Color::from_argb((alpha as f32 * 0.45) as u8, 110, 132, 170));
    canvas.draw_round_rect(
        Rect::from_xywh(
            cx - w / 2.0 - 1.4 * scale,
            cy - h / 2.0 - 1.3 * scale + offset,
            w,
            h,
        ),
        2.2 * scale,
        2.2 * scale,
        &back,
    );

    let mut front = Paint::default();
    front.set_anti_alias(true);
    front.set_color(Color::from_argb(alpha, 185, 208, 255));
    canvas.draw_round_rect(
        Rect::from_xywh(cx - w / 2.0 + 0.8 * scale, cy - h / 2.0 - offset, w, h),
        2.2 * scale,
        2.2 * scale,
        &front,
    );

    let mut scan = Paint::default();
    scan.set_anti_alias(true);
    scan.set_color(Color::from_argb((alpha as f32 * 0.7) as u8, 36, 120, 255));
    scan.set_style(skia_safe::paint::Style::Stroke);
    scan.set_stroke_width(1.4 * scale);
    let scan_t = (phase.sin() * 0.5 + 0.5).clamp(0.0, 1.0);
    let scan_y = cy - h * 0.35 + scan_t * h * 0.7;
    canvas.draw_line((cx - w * 0.35, scan_y), (cx + w * 0.35, scan_y), &scan);
}

fn draw_pdf_merge_processing_icon(
    canvas: &Canvas,
    cx: f32,
    cy: f32,
    scale: f32,
    frame: u64,
    alpha: u8,
) {
    let phase = frame as f32 * 0.09;
    let slide = phase.sin() * 1.2 * scale;
    let w = 6.8 * scale;
    let h = 9.2 * scale;

    let mut left = Paint::default();
    left.set_anti_alias(true);
    left.set_color(Color::from_argb((alpha as f32 * 0.82) as u8, 133, 182, 255));
    canvas.draw_round_rect(
        Rect::from_xywh(cx - 6.6 * scale - slide, cy - h / 2.0, w, h),
        1.8 * scale,
        1.8 * scale,
        &left,
    );

    let mut right = Paint::default();
    right.set_anti_alias(true);
    right.set_color(Color::from_argb((alpha as f32 * 0.88) as u8, 176, 220, 255));
    canvas.draw_round_rect(
        Rect::from_xywh(cx + 0.2 * scale + slide, cy - h / 2.0, w, h),
        1.8 * scale,
        1.8 * scale,
        &right,
    );

    let mut plus = Paint::default();
    plus.set_anti_alias(true);
    plus.set_style(skia_safe::paint::Style::Stroke);
    plus.set_stroke_cap(skia_safe::paint::Cap::Round);
    plus.set_stroke_width(1.6 * scale);
    plus.set_color(Color::from_argb(alpha, 40, 120, 255));
    canvas.draw_line((cx, cy - 2.2 * scale), (cx, cy + 2.2 * scale), &plus);
    canvas.draw_line((cx - 2.2 * scale, cy), (cx + 2.2 * scale, cy), &plus);
}

fn draw_pdf_split_processing_icon(
    canvas: &Canvas,
    cx: f32,
    cy: f32,
    scale: f32,
    frame: u64,
    alpha: u8,
) {
    let phase = frame as f32 * 0.12;
    let spread = (phase.sin() * 0.5 + 0.5) * 1.6 * scale;
    let w = 11.5 * scale;
    let h = 9.8 * scale;

    let mut paper = Paint::default();
    paper.set_anti_alias(true);
    paper.set_color(Color::from_argb((alpha as f32 * 0.9) as u8, 187, 214, 255));
    canvas.draw_round_rect(
        Rect::from_xywh(cx - w / 2.0, cy - h / 2.0, w, h),
        2.1 * scale,
        2.1 * scale,
        &paper,
    );

    let mut split = Paint::default();
    split.set_anti_alias(true);
    split.set_style(skia_safe::paint::Style::Stroke);
    split.set_stroke_cap(skia_safe::paint::Cap::Round);
    split.set_stroke_width(1.3 * scale);
    split.set_color(Color::from_argb(alpha, 46, 118, 232));
    canvas.draw_line((cx, cy - h * 0.34), (cx, cy + h * 0.34), &split);
    canvas.draw_line(
        (cx - 3.6 * scale - spread, cy),
        (cx - 1.6 * scale - spread, cy),
        &split,
    );
    canvas.draw_line(
        (cx + 1.6 * scale + spread, cy),
        (cx + 3.6 * scale + spread, cy),
        &split,
    );
}

fn draw_pdf_to_image_processing_icon(
    canvas: &Canvas,
    cx: f32,
    cy: f32,
    scale: f32,
    frame: u64,
    alpha: u8,
) {
    let phase = frame as f32 * 0.08;
    let arrow_t = (phase.sin() * 0.5 + 0.5).clamp(0.0, 1.0);

    let mut paper = Paint::default();
    paper.set_anti_alias(true);
    paper.set_color(Color::from_argb((alpha as f32 * 0.9) as u8, 186, 210, 255));
    canvas.draw_round_rect(
        Rect::from_xywh(
            cx - 7.8 * scale,
            cy - 5.0 * scale,
            5.8 * scale,
            10.0 * scale,
        ),
        1.6 * scale,
        1.6 * scale,
        &paper,
    );

    let mut arrow = Paint::default();
    arrow.set_anti_alias(true);
    arrow.set_style(skia_safe::paint::Style::Stroke);
    arrow.set_stroke_width(1.4 * scale);
    arrow.set_stroke_cap(skia_safe::paint::Cap::Round);
    arrow.set_color(Color::from_argb(alpha, 58, 140, 255));
    let x0 = cx - 0.8 * scale + arrow_t * 0.8 * scale;
    let x1 = cx + 2.6 * scale + arrow_t * 0.8 * scale;
    canvas.draw_line((x0, cy), (x1, cy), &arrow);
    canvas.draw_line((x1 - 1.3 * scale, cy - 1.2 * scale), (x1, cy), &arrow);
    canvas.draw_line((x1 - 1.3 * scale, cy + 1.2 * scale), (x1, cy), &arrow);

    let frame_x = cx + 3.2 * scale;
    let frame_y = cy - 4.8 * scale;
    let frame_w = 7.2 * scale;
    let frame_h = 9.6 * scale;

    let mut frame_paint = Paint::default();
    frame_paint.set_anti_alias(true);
    frame_paint.set_style(skia_safe::paint::Style::Stroke);
    frame_paint.set_stroke_width(1.3 * scale);
    frame_paint.set_color(Color::from_argb(alpha, 116, 226, 180));
    canvas.draw_round_rect(
        Rect::from_xywh(frame_x, frame_y, frame_w, frame_h),
        1.6 * scale,
        1.6 * scale,
        &frame_paint,
    );

    let mut dot = Paint::default();
    dot.set_anti_alias(true);
    dot.set_color(Color::from_argb(alpha, 255, 207, 82));
    canvas.draw_circle(
        (frame_x + frame_w * 0.73, frame_y + frame_h * 0.28),
        1.0 * scale,
        &dot,
    );
}

fn draw_image_processing_icon(
    canvas: &Canvas,
    cx: f32,
    cy: f32,
    scale: f32,
    frame: u64,
    alpha: u8,
) {
    let size = 14.0 * scale;
    let left = cx - size / 2.0;
    let top = cy - size / 2.0;
    let shimmer_t = ((frame as f32 * 0.06).sin() * 0.5 + 0.5).clamp(0.0, 1.0);

    let mut frame_paint = Paint::default();
    frame_paint.set_anti_alias(true);
    frame_paint.set_style(skia_safe::paint::Style::Stroke);
    frame_paint.set_stroke_width(1.4 * scale);
    frame_paint.set_color(Color::from_argb((alpha as f32 * 0.9) as u8, 115, 226, 180));
    canvas.draw_round_rect(
        Rect::from_xywh(left, top, size, size),
        2.6 * scale,
        2.6 * scale,
        &frame_paint,
    );

    let mut sun = Paint::default();
    sun.set_anti_alias(true);
    sun.set_color(Color::from_argb(alpha, 255, 205, 82));
    canvas.draw_circle((left + size * 0.74, top + size * 0.30), 1.6 * scale, &sun);

    let mut mountain = Paint::default();
    mountain.set_anti_alias(true);
    mountain.set_color(Color::from_argb((alpha as f32 * 0.85) as u8, 86, 189, 141));
    let mut pb = PathBuilder::default();
    pb.move_to((left + size * 0.14, top + size * 0.78));
    pb.line_to((left + size * 0.38, top + size * 0.52));
    pb.line_to((left + size * 0.54, top + size * 0.66));
    pb.line_to((left + size * 0.78, top + size * 0.44));
    pb.line_to((left + size * 0.86, top + size * 0.78));
    pb.close();
    canvas.draw_path(&pb.detach(), &mountain);

    let mut shimmer = Paint::default();
    shimmer.set_anti_alias(true);
    shimmer.set_color(Color::from_argb((alpha as f32 * 0.35) as u8, 255, 255, 255));
    let shimmer_x = left - size * 0.25 + shimmer_t * size * 1.5;
    canvas.draw_round_rect(
        Rect::from_xywh(shimmer_x, top + size * 0.08, size * 0.22, size * 0.84),
        1.2 * scale,
        1.2 * scale,
        &shimmer,
    );
}

fn draw_image_convert_processing_icon(
    canvas: &Canvas,
    cx: f32,
    cy: f32,
    scale: f32,
    frame: u64,
    alpha: u8,
) {
    draw_image_processing_icon(canvas, cx - 1.2 * scale, cy, scale * 0.95, frame, alpha);

    let phase = frame as f32 * 0.11;
    let spin = (phase.sin() * 0.5 + 0.5).clamp(0.0, 1.0);
    let mut arc = Paint::default();
    arc.set_anti_alias(true);
    arc.set_style(skia_safe::paint::Style::Stroke);
    arc.set_stroke_width(1.3 * scale);
    arc.set_stroke_cap(skia_safe::paint::Cap::Round);
    arc.set_color(Color::from_argb(alpha, 83, 169, 255));
    let r = 5.8 * scale;
    canvas.draw_line(
        (cx - r * 0.4, cy - r * 0.95),
        (cx + r * 0.8 * spin, cy - r * 0.35),
        &arc,
    );
    canvas.draw_line(
        (cx + r * 0.8 * spin, cy - r * 0.35),
        (cx + r * 0.45 * spin, cy - r * 0.85),
        &arc,
    );
    canvas.draw_line(
        (cx + r * 0.85, cy + r * 0.2),
        (cx - r * 0.45 * spin, cy + r * 0.95),
        &arc,
    );
    canvas.draw_line(
        (cx - r * 0.45 * spin, cy + r * 0.95),
        (cx - r * 0.05 * spin, cy + r * 0.45),
        &arc,
    );
}

fn draw_audio_processing_icon(
    canvas: &Canvas,
    cx: f32,
    cy: f32,
    scale: f32,
    frame: u64,
    alpha: u8,
) {
    let mut bars = Paint::default();
    bars.set_anti_alias(true);
    bars.set_color(Color::from_argb(alpha, 129, 191, 255));
    let bar_w = 1.9 * scale;
    for i in 0..3 {
        let phase = frame as f32 * 0.13 + i as f32 * 1.1;
        let h = (4.2 + (phase.sin() * 0.5 + 0.5) * 7.2) * scale;
        let x = cx - 5.2 * scale + i as f32 * 2.9 * scale;
        canvas.draw_round_rect(
            Rect::from_xywh(x, cy - h / 2.0, bar_w, h),
            0.9 * scale,
            0.9 * scale,
            &bars,
        );
    }

    let mut note = Paint::default();
    note.set_anti_alias(true);
    note.set_color(Color::from_argb(alpha, 255, 96, 142));
    canvas.draw_circle((cx + 3.7 * scale, cy + 2.0 * scale), 2.0 * scale, &note);
    note.set_style(skia_safe::paint::Style::Stroke);
    note.set_stroke_width(1.4 * scale);
    canvas.draw_line(
        (cx + 5.0 * scale, cy + 1.3 * scale),
        (cx + 5.0 * scale, cy - 5.2 * scale),
        &note,
    );
    canvas.draw_line(
        (cx + 5.0 * scale, cy - 5.2 * scale),
        (cx + 8.0 * scale, cy - 6.2 * scale),
        &note,
    );
}

fn draw_video_processing_icon(
    canvas: &Canvas,
    cx: f32,
    cy: f32,
    scale: f32,
    frame: u64,
    alpha: u8,
) {
    let w = 12.5 * scale;
    let h = 8.3 * scale;
    let left = cx - w / 2.0;
    let top = cy - h / 2.0;

    let mut frame_paint = Paint::default();
    frame_paint.set_anti_alias(true);
    frame_paint.set_style(skia_safe::paint::Style::Stroke);
    frame_paint.set_stroke_width(1.3 * scale);
    frame_paint.set_color(Color::from_argb(alpha, 127, 188, 255));
    canvas.draw_round_rect(
        Rect::from_xywh(left, top, w, h),
        2.0 * scale,
        2.0 * scale,
        &frame_paint,
    );

    let mut play = Paint::default();
    play.set_anti_alias(true);
    play.set_color(Color::from_argb((alpha as f32 * 0.92) as u8, 201, 232, 255));
    let mut pb = PathBuilder::default();
    pb.move_to((left + w * 0.43, top + h * 0.30));
    pb.line_to((left + w * 0.43, top + h * 0.70));
    pb.line_to((left + w * 0.70, top + h * 0.50));
    pb.close();
    canvas.draw_path(&pb.detach(), &play);

    let phase = frame as f32 * 0.09;
    let t = (phase.sin() * 0.5 + 0.5).clamp(0.0, 1.0);
    let mut arrow = Paint::default();
    arrow.set_anti_alias(true);
    arrow.set_style(skia_safe::paint::Style::Stroke);
    arrow.set_stroke_width(1.2 * scale);
    arrow.set_stroke_cap(skia_safe::paint::Cap::Round);
    arrow.set_color(Color::from_argb(alpha, 67, 147, 255));
    canvas.draw_line(
        (left + w * 0.08, top - 1.4 * scale),
        (left + w * (0.24 + 0.18 * t), top - 1.4 * scale),
        &arrow,
    );
    canvas.draw_line(
        (left + w * (0.24 + 0.18 * t), top - 1.4 * scale),
        (left + w * (0.20 + 0.18 * t), top - 2.6 * scale),
        &arrow,
    );
}

fn draw_video_extract_audio_processing_icon(
    canvas: &Canvas,
    cx: f32,
    cy: f32,
    scale: f32,
    frame: u64,
    alpha: u8,
) {
    draw_video_processing_icon(canvas, cx - 2.1 * scale, cy, scale * 0.92, frame, alpha);

    let pulse = 1.0 + ((frame as f32 * 0.1).sin() * 0.5 + 0.5) * 0.16;
    let mut note = Paint::default();
    note.set_anti_alias(true);
    note.set_color(Color::from_argb(alpha, 255, 94, 135));
    canvas.draw_circle(
        (cx + 5.7 * scale, cy + 2.2 * scale),
        1.8 * scale * pulse,
        &note,
    );
    note.set_style(skia_safe::paint::Style::Stroke);
    note.set_stroke_width(1.3 * scale);
    canvas.draw_line(
        (cx + 6.8 * scale, cy + 1.2 * scale),
        (cx + 6.8 * scale, cy - 4.4 * scale),
        &note,
    );
}

fn draw_video_clip_processing_icon(
    canvas: &Canvas,
    cx: f32,
    cy: f32,
    scale: f32,
    frame: u64,
    alpha: u8,
) {
    let wobble = (frame as f32 * 0.11).sin() * 0.8 * scale;
    let mut bar = Paint::default();
    bar.set_anti_alias(true);
    bar.set_color(Color::from_argb((alpha as f32 * 0.9) as u8, 127, 188, 255));
    canvas.draw_round_rect(
        Rect::from_xywh(
            cx - 6.3 * scale,
            cy - 3.2 * scale,
            12.6 * scale,
            6.4 * scale,
        ),
        1.8 * scale,
        1.8 * scale,
        &bar,
    );

    let mut scissor = Paint::default();
    scissor.set_anti_alias(true);
    scissor.set_style(skia_safe::paint::Style::Stroke);
    scissor.set_stroke_width(1.4 * scale);
    scissor.set_stroke_cap(skia_safe::paint::Cap::Round);
    scissor.set_color(Color::from_argb(alpha, 255, 98, 131));
    canvas.draw_line(
        (cx - 2.0 * scale - wobble, cy - 5.4 * scale),
        (cx + 2.8 * scale + wobble, cy + 0.3 * scale),
        &scissor,
    );
    canvas.draw_line(
        (cx + 2.8 * scale + wobble, cy - 5.4 * scale),
        (cx - 2.0 * scale - wobble, cy + 0.3 * scale),
        &scissor,
    );
}

fn draw_json_processing_icon(canvas: &Canvas, cx: f32, cy: f32, scale: f32, frame: u64, alpha: u8) {
    let pulse = ((frame as f32 * 0.09).sin() * 0.5 + 0.5).clamp(0.0, 1.0);
    let mut brace = Paint::default();
    brace.set_anti_alias(true);
    brace.set_style(skia_safe::paint::Style::Stroke);
    brace.set_stroke_width(1.4 * scale);
    brace.set_stroke_cap(skia_safe::paint::Cap::Round);
    brace.set_color(Color::from_argb(alpha, 170, 164, 255));

    canvas.draw_line(
        (cx - 6.0 * scale, cy - 4.8 * scale),
        (cx - 4.3 * scale, cy - 3.2 * scale),
        &brace,
    );
    canvas.draw_line(
        (cx - 4.3 * scale, cy - 3.2 * scale),
        (cx - 4.3 * scale, cy + 3.2 * scale),
        &brace,
    );
    canvas.draw_line(
        (cx - 4.3 * scale, cy + 3.2 * scale),
        (cx - 6.0 * scale, cy + 4.8 * scale),
        &brace,
    );
    canvas.draw_line(
        (cx + 6.0 * scale, cy - 4.8 * scale),
        (cx + 4.3 * scale, cy - 3.2 * scale),
        &brace,
    );
    canvas.draw_line(
        (cx + 4.3 * scale, cy - 3.2 * scale),
        (cx + 4.3 * scale, cy + 3.2 * scale),
        &brace,
    );
    canvas.draw_line(
        (cx + 4.3 * scale, cy + 3.2 * scale),
        (cx + 6.0 * scale, cy + 4.8 * scale),
        &brace,
    );

    let mut dot = Paint::default();
    dot.set_anti_alias(true);
    dot.set_color(Color::from_argb(
        (alpha as f32 * (0.55 + 0.45 * pulse)) as u8,
        238,
        235,
        255,
    ));
    canvas.draw_circle((cx - 1.8 * scale, cy), 0.9 * scale, &dot);
    canvas.draw_circle((cx, cy), 0.9 * scale, &dot);
    canvas.draw_circle((cx + 1.8 * scale, cy), 0.9 * scale, &dot);
}

fn draw_music_processing_icon(
    canvas: &Canvas,
    cx: f32,
    cy: f32,
    scale: f32,
    frame: u64,
    alpha: u8,
) {
    let phase = frame as f32 * 0.08;
    let pulse = 1.0 + (phase.sin() * 0.5 + 0.5) * 0.2;

    let mut note = Paint::default();
    note.set_anti_alias(true);
    note.set_color(Color::from_argb(alpha, 255, 88, 126));

    let head_r = 2.3 * scale * pulse;
    canvas.draw_circle((cx - 1.8 * scale, cy + 2.2 * scale), head_r, &note);
    canvas.draw_circle((cx + 3.3 * scale, cy + 0.5 * scale), head_r * 0.92, &note);

    note.set_style(skia_safe::paint::Style::Stroke);
    note.set_stroke_width(1.6 * scale);
    canvas.draw_line(
        (cx + 0.2 * scale, cy + 1.5 * scale),
        (cx + 0.2 * scale, cy - 5.2 * scale),
        &note,
    );
    canvas.draw_line(
        (cx + 5.3 * scale, cy - 0.1 * scale),
        (cx + 5.3 * scale, cy - 6.8 * scale),
        &note,
    );
    canvas.draw_line(
        (cx + 0.2 * scale, cy - 5.2 * scale),
        (cx + 5.3 * scale, cy - 6.8 * scale),
        &note,
    );
}

fn draw_file_transfer_processing_icon(
    canvas: &Canvas,
    cx: f32,
    cy: f32,
    scale: f32,
    frame: u64,
    alpha: u8,
) {
    let phase = frame as f32 * 0.1;
    let pulse = (phase.sin() * 0.5 + 0.5).clamp(0.0, 1.0);
    draw_upload_icon(
        canvas,
        cx,
        cy - 0.5 * scale,
        15.0 * scale,
        Color::from_argb(alpha, 95, 202, 255),
        1.25 * scale,
    );

    let tray_w = 11.0 * scale;
    let tray_h = 2.2 * scale;
    let tray_y = cy + 5.3 * scale;
    let mut tray = Paint::default();
    tray.set_anti_alias(true);
    tray.set_color(Color::from_argb((alpha as f32 * 0.38) as u8, 95, 202, 255));
    canvas.draw_round_rect(
        Rect::from_xywh(cx - tray_w / 2.0, tray_y, tray_w, tray_h),
        1.1 * scale,
        1.1 * scale,
        &tray,
    );

    let packet_y = cy + 3.8 * scale - pulse * 6.0 * scale;
    let mut packet = Paint::default();
    packet.set_anti_alias(true);
    packet.set_color(Color::from_argb((alpha as f32 * 0.95) as u8, 240, 250, 255));
    canvas.draw_circle((cx, packet_y), 1.25 * scale, &packet);
}

fn draw_workspace_processing_icon(
    canvas: &Canvas,
    cx: f32,
    cy: f32,
    scale: f32,
    frame: u64,
    alpha: u8,
) {
    let phase = frame as f32 * 0.09;
    let pulse = (phase.sin() * 0.5 + 0.5).clamp(0.0, 1.0);
    let w = 13.0 * scale;
    let h = 10.2 * scale;
    let left = cx - w / 2.0;
    let top = cy - h / 2.0;

    let mut bg = Paint::default();
    bg.set_anti_alias(true);
    bg.set_color(Color::from_argb((alpha as f32 * 0.22) as u8, 255, 173, 86));
    canvas.draw_round_rect(
        Rect::from_xywh(left, top, w, h),
        2.1 * scale,
        2.1 * scale,
        &bg,
    );

    let mut border = Paint::default();
    border.set_anti_alias(true);
    border.set_style(skia_safe::paint::Style::Stroke);
    border.set_stroke_width(1.2 * scale);
    border.set_color(Color::from_argb(alpha, 255, 188, 112));
    canvas.draw_round_rect(
        Rect::from_xywh(left, top, w, h),
        2.1 * scale,
        2.1 * scale,
        &border,
    );

    draw_sparkle_icon(
        canvas,
        cx + 1.0 * scale,
        cy - 0.6 * scale,
        (11.0 + pulse * 2.2) * scale,
        Color::from_argb((alpha as f32 * 0.96) as u8, 255, 226, 164),
    );

    let dot_x = left + 2.2 * scale + pulse * (w - 4.4 * scale);
    let mut dot = Paint::default();
    dot.set_anti_alias(true);
    dot.set_color(Color::from_argb((alpha as f32 * 0.82) as u8, 255, 240, 218));
    canvas.draw_circle((dot_x, top + h - 1.8 * scale), 0.85 * scale, &dot);
}

fn draw_network_processing_icon(
    canvas: &Canvas,
    cx: f32,
    cy: f32,
    scale: f32,
    frame: u64,
    alpha: u8,
) {
    let r = 6.2 * scale;
    let phase = frame as f32 * 0.12;
    let orbit_t = (phase.sin() * 0.5 + 0.5).clamp(0.0, 1.0);

    let mut ring = Paint::default();
    ring.set_anti_alias(true);
    ring.set_style(skia_safe::paint::Style::Stroke);
    ring.set_stroke_width(1.25 * scale);
    ring.set_color(Color::from_argb((alpha as f32 * 0.46) as u8, 90, 220, 193));
    canvas.draw_circle((cx, cy), r, &ring);

    ring.set_stroke_width(1.45 * scale);
    ring.set_color(Color::from_argb((alpha as f32 * 0.94) as u8, 118, 243, 213));
    let sweep_start = ((frame as f32 * 4.9) % 360.0) - 90.0;
    canvas.draw_arc(
        Rect::from_xywh(cx - r, cy - r, r * 2.0, r * 2.0),
        sweep_start,
        112.0,
        false,
        &ring,
    );

    let orbit_a = phase * std::f32::consts::TAU * 0.33;
    let orbit_x = cx + orbit_a.cos() * r * (0.58 + 0.28 * orbit_t);
    let orbit_y = cy + orbit_a.sin() * r * (0.58 + 0.28 * orbit_t);
    let mut node = Paint::default();
    node.set_anti_alias(true);
    node.set_color(Color::from_argb(alpha, 234, 255, 248));
    canvas.draw_circle((orbit_x, orbit_y), 1.2 * scale, &node);
    canvas.draw_circle((cx, cy), 1.1 * scale, &node);
}

fn draw_code_processing_icon(canvas: &Canvas, cx: f32, cy: f32, scale: f32, frame: u64, alpha: u8) {
    let mut stroke = Paint::default();
    stroke.set_anti_alias(true);
    stroke.set_style(skia_safe::paint::Style::Stroke);
    stroke.set_stroke_width(1.35 * scale);
    stroke.set_stroke_cap(skia_safe::paint::Cap::Round);
    stroke.set_color(Color::from_argb(alpha, 193, 162, 255));

    canvas.draw_line(
        (cx - 6.1 * scale, cy - 3.4 * scale),
        (cx - 3.4 * scale, cy),
        &stroke,
    );
    canvas.draw_line(
        (cx - 3.4 * scale, cy),
        (cx - 6.1 * scale, cy + 3.4 * scale),
        &stroke,
    );
    canvas.draw_line(
        (cx + 6.1 * scale, cy - 3.4 * scale),
        (cx + 3.4 * scale, cy),
        &stroke,
    );
    canvas.draw_line(
        (cx + 3.4 * scale, cy),
        (cx + 6.1 * scale, cy + 3.4 * scale),
        &stroke,
    );

    let mut slash = Paint::default();
    slash.set_anti_alias(true);
    slash.set_style(skia_safe::paint::Style::Stroke);
    slash.set_stroke_width(1.25 * scale);
    slash.set_stroke_cap(skia_safe::paint::Cap::Round);
    slash.set_color(Color::from_argb((alpha as f32 * 0.84) as u8, 225, 207, 255));
    canvas.draw_line(
        (cx - 0.9 * scale, cy + 4.5 * scale),
        (cx + 1.5 * scale, cy - 4.5 * scale),
        &slash,
    );

    let cursor_t = ((frame as f32 * 0.14).sin() * 0.5 + 0.5).clamp(0.0, 1.0);
    let cursor_x = cx - 1.4 * scale + cursor_t * 2.8 * scale;
    let mut cursor = Paint::default();
    cursor.set_anti_alias(true);
    cursor.set_style(skia_safe::paint::Style::Stroke);
    cursor.set_stroke_width(1.05 * scale);
    cursor.set_color(Color::from_argb((alpha as f32 * 0.78) as u8, 255, 246, 255));
    canvas.draw_line(
        (cursor_x, cy + 5.6 * scale),
        (cursor_x + 1.8 * scale, cy + 5.6 * scale),
        &cursor,
    );
}

fn draw_ai_reasoning_processing_icon(
    canvas: &Canvas,
    cx: f32,
    cy: f32,
    scale: f32,
    frame: u64,
    alpha: u8,
) {
    let phase = frame as f32 * 0.095;
    let pulse = (phase.sin() * 0.5 + 0.5).clamp(0.0, 1.0);
    draw_breathing_orb(
        canvas,
        cx,
        cy - 0.4 * scale,
        (5.7 + 0.9 * pulse) * scale,
        83,
        169,
        255,
        frame,
        alpha,
    );

    draw_sparkle_icon(
        canvas,
        cx + 0.1 * scale,
        cy - 0.5 * scale,
        (9.5 + 2.1 * pulse) * scale,
        Color::from_argb((alpha as f32 * 0.88) as u8, 214, 236, 255),
    );

    let mut dot = Paint::default();
    dot.set_anti_alias(true);
    for i in 0..3 {
        let t = ((phase + i as f32 * 0.6).sin() * 0.5 + 0.5).clamp(0.0, 1.0);
        dot.set_color(Color::from_argb(
            (alpha as f32 * (0.42 + 0.52 * t)) as u8,
            225,
            243,
            255,
        ));
        canvas.draw_circle(
            (cx - 3.2 * scale + i as f32 * 3.2 * scale, cy + 5.3 * scale),
            0.82 * scale,
            &dot,
        );
    }
}

fn color_with_alpha(color: Color, alpha: u8) -> Color {
    Color::from_argb(alpha, color.r(), color.g(), color.b())
}

fn music_palette(data: &FrameData) -> (Color, Color, Color) {
    if let Some(ms) = data.music_state {
        let palette = crate::ui::utils::get_media_palette(&ms.media);
        let primary = palette
            .first()
            .copied()
            .unwrap_or(Color::from_rgb(255, 67, 102));
        let secondary = palette
            .get(1)
            .copied()
            .unwrap_or(Color::from_rgb(91, 166, 255));
        let tertiary = palette
            .get(2)
            .copied()
            .unwrap_or(Color::from_rgb(255, 181, 72));
        (primary, secondary, tertiary)
    } else {
        (
            Color::from_rgb(255, 67, 102),
            Color::from_rgb(78, 142, 255),
            Color::from_rgb(255, 183, 94),
        )
    }
}

fn music_progress_fraction(data: &FrameData) -> f32 {
    if data.music_duration_ms > 0 {
        return (data.music_elapsed_ms as f32 / data.music_duration_ms as f32).clamp(0.0, 1.0);
    }
    ((data.frame_count as f32 * 0.015).sin() * 0.5 + 0.5).clamp(0.08, 0.92)
}

fn draw_music_glow(
    canvas: &Canvas,
    center: Point,
    radius: f32,
    primary: Color,
    secondary: Color,
    alpha: u8,
    intensity: f32,
) {
    let mut paint = Paint::default();
    paint.set_anti_alias(true);
    paint.set_style(skia_safe::paint::Style::Fill);
    paint.set_color(color_with_alpha(
        primary,
        ((alpha as f32) * 0.05 * intensity).round() as u8,
    ));
    canvas.draw_circle(center, radius, &paint);
    paint.set_color(color_with_alpha(
        secondary,
        ((alpha as f32) * 0.03 * intensity).round() as u8,
    ));
    canvas.draw_circle(center, radius * 0.62, &paint);
}

fn draw_music_album_art(canvas: &Canvas, rect: Rect, data: &FrameData, alpha: u8, corner: f32) {
    let (primary, secondary, _) = music_palette(data);
    let mut base = Paint::default();
    base.set_anti_alias(true);
    base.set_color(Color::from_argb((alpha as f32 * 0.18) as u8, 255, 255, 255));
    canvas.draw_round_rect(rect, corner, corner, &base);

    if let Some(ms) = data.music_state {
        if let Some(image) = crate::ui::utils::get_cached_media_image(&ms.media) {
            canvas.save();
            canvas.clip_rrect(
                RRect::new_rect_xy(rect, corner, corner),
                ClipOp::Intersect,
                true,
            );
            let mut image_paint = Paint::default();
            image_paint.set_anti_alias(true);
            canvas.draw_image_rect(&image, None, rect, &image_paint);
            canvas.restore();
        } else {
            let gradient_colors = [
                color_with_alpha(primary, (alpha as f32 * 0.78) as u8),
                color_with_alpha(secondary, (alpha as f32 * 0.52) as u8),
            ];
            if let Some(shader) = gradient_shader::linear(
                (
                    Point::new(rect.left(), rect.top()),
                    Point::new(rect.right(), rect.bottom()),
                ),
                gradient_colors.as_slice(),
                None,
                TileMode::Clamp,
                None,
                None,
            ) {
                base.set_shader(shader);
                canvas.draw_round_rect(rect, corner, corner, &base);
            }
        }
    }

    let mut stroke = Paint::default();
    stroke.set_anti_alias(true);
    stroke.set_style(PaintStyle::Stroke);
    stroke.set_stroke_width(0.9 * (rect.width() / 24.0).clamp(0.8, 1.4));
    stroke.set_color(Color::from_argb((alpha as f32 * 0.16) as u8, 255, 255, 255));
    canvas.draw_round_rect(rect, corner, corner, &stroke);
}

fn draw_music_queue_pips(
    canvas: &Canvas,
    center_x: f32,
    y: f32,
    scale: f32,
    alpha: u8,
    queue_len: usize,
    current_index: Option<usize>,
    accent: Color,
) {
    let visible = queue_len.clamp(1, 5);
    let gap = 10.0 * scale;
    let start_x = center_x - (visible as f32 - 1.0) * gap * 0.5;
    let mut paint = Paint::default();
    paint.set_anti_alias(true);
    for index in 0..visible {
        let is_active = current_index.unwrap_or(0).min(visible - 1) == index;
        let w = if is_active { 18.0 * scale } else { 6.0 * scale };
        let h = if is_active { 4.0 * scale } else { 6.0 * scale };
        let x = start_x + index as f32 * gap;
        paint.set_color(if is_active {
            color_with_alpha(accent, (alpha as f32 * 0.94) as u8)
        } else {
            Color::from_argb((alpha as f32 * 0.26) as u8, 255, 255, 255)
        });
        canvas.draw_round_rect(
            Rect::from_xywh(x - w / 2.0, y - h / 2.0, w, h),
            h / 2.0,
            h / 2.0,
            &paint,
        );
    }
}

fn format_music_time(ms: u64) -> String {
    let total = ms / 1000;
    let minutes = total / 60;
    let seconds = total % 60;
    format!("{minutes}:{seconds:02}")
}

fn draw_search_icon(canvas: &Canvas, cx: f32, cy: f32, size: f32, color: Color, sw: f32) {
    let r = size * 0.34;
    let mut paint = Paint::default();
    paint.set_anti_alias(true);
    paint.set_color(color);
    paint.set_style(PaintStyle::Stroke);
    paint.set_stroke_width(sw);
    paint.set_stroke_cap(skia_safe::paint::Cap::Round);
    canvas.draw_circle((cx - size * 0.08, cy - size * 0.08), r, &paint);
    canvas.draw_line(
        (cx + size * 0.18, cy + size * 0.18),
        (cx + size * 0.44, cy + size * 0.44),
        &paint,
    );
}

fn draw_close_icon(canvas: &Canvas, cx: f32, cy: f32, size: f32, color: Color, sw: f32) {
    let half = size * 0.34;
    let mut paint = Paint::default();
    paint.set_anti_alias(true);
    paint.set_color(color);
    paint.set_style(PaintStyle::Stroke);
    paint.set_stroke_width(sw);
    paint.set_stroke_cap(skia_safe::paint::Cap::Round);
    canvas.draw_line((cx - half, cy - half), (cx + half, cy + half), &paint);
    canvas.draw_line((cx + half, cy - half), (cx - half, cy + half), &paint);
}

fn draw_music_wave_bars(
    canvas: &Canvas,
    left: f32,
    baseline_y: f32,
    scale: f32,
    alpha: u8,
    accent: Color,
    spectrum: &[f32],
    is_playing: bool,
    count: usize,
) {
    let mut paint = Paint::default();
    paint.set_anti_alias(true);
    paint.set_color(color_with_alpha(accent, (alpha as f32 * 0.92) as u8));
    let bar_w = 3.0 * scale;
    let gap = 2.0 * scale;
    let span = bar_w + gap;
    for index in 0..count {
        let energy = if is_playing {
            spectrum
                .get(index % spectrum.len().max(1))
                .copied()
                .unwrap_or(0.48)
                .clamp(0.12, 1.0)
        } else {
            0.32
        };
        let height = (5.0 + energy * 9.0) * scale;
        canvas.draw_round_rect(
            Rect::from_xywh(
                left + index as f32 * span,
                baseline_y - height,
                bar_w,
                height,
            ),
            1.5 * scale,
            1.5 * scale,
            &paint,
        );
    }
}

fn result_palette(song: &MusicSearchResult) -> (Color, Color) {
    const PALETTES: [(Color, Color); 6] = [
        (
            Color::from_rgb(255, 182, 193),
            Color::from_rgb(255, 105, 180),
        ),
        (Color::from_rgb(10, 132, 255), Color::from_rgb(94, 92, 230)),
        (Color::from_rgb(76, 175, 80), Color::from_rgb(129, 199, 132)),
        (Color::from_rgb(117, 117, 117), Color::from_rgb(33, 33, 33)),
        (Color::from_rgb(30, 144, 255), Color::from_rgb(0, 206, 209)),
        (Color::from_rgb(255, 59, 48), Color::from_rgb(255, 149, 0)),
    ];
    let mut hash = 0u32;
    for byte in song.name.bytes().chain(song.artist.bytes()) {
        hash = hash.wrapping_mul(33).wrapping_add(byte as u32);
    }
    PALETTES[(hash as usize) % PALETTES.len()]
}

fn draw_music_provider_chip(canvas: &Canvas, rect: Rect, scale: f32, alpha: u8, label: &str) {
    let mut bg = Paint::default();
    bg.set_anti_alias(true);
    bg.set_color(Color::from_argb((alpha as f32 * 0.16) as u8, 255, 82, 117));
    canvas.draw_round_rect(rect, rect.height() * 0.5, rect.height() * 0.5, &bg);

    let mut border = Paint::default();
    border.set_anti_alias(true);
    border.set_style(PaintStyle::Stroke);
    border.set_stroke_width(1.0 * scale);
    border.set_color(Color::from_argb((alpha as f32 * 0.20) as u8, 255, 124, 149));
    canvas.draw_round_rect(rect, rect.height() * 0.5, rect.height() * 0.5, &border);

    let mut text = Paint::default();
    text.set_anti_alias(true);
    text.set_color(Color::from_argb(alpha, 255, 233, 238));
    crate::ui::utils::draw_text_cached(
        canvas,
        label,
        (rect.left() + 7.0 * scale, rect.center_y() + 2.8 * scale),
        8.0 * scale,
        FontStyle::bold(),
        &text,
        false,
        rect.width() - 10.0 * scale,
    );
}

fn draw_result_art_tile(
    canvas: &Canvas,
    rect: Rect,
    song: &MusicSearchResult,
    real_cover: Option<&Image>,
    alpha: u8,
    scale: f32,
) {
    if let Some(image) = real_cover {
        canvas.save();
        canvas.clip_rrect(
            RRect::new_rect_xy(rect, 10.0 * scale, 10.0 * scale),
            ClipOp::Intersect,
            true,
        );
        let sampling = skia_safe::SamplingOptions::new(
            skia_safe::FilterMode::Linear,
            skia_safe::MipmapMode::Linear,
        );
        let mut image_paint = Paint::default();
        image_paint.set_anti_alias(true);
        image_paint.set_alpha(alpha);
        canvas.draw_image_rect_with_sampling_options(image, None, rect, sampling, &image_paint);
        canvas.restore();

        let mut stroke = Paint::default();
        stroke.set_anti_alias(true);
        stroke.set_style(PaintStyle::Stroke);
        stroke.set_stroke_width(0.9 * scale);
        stroke.set_color(Color::from_argb((alpha as f32 * 0.18) as u8, 255, 255, 255));
        canvas.draw_round_rect(rect, 10.0 * scale, 10.0 * scale, &stroke);
        return;
    }

    let (primary, secondary) = result_palette(song);
    let colors = [
        color_with_alpha(primary, (alpha as f32 * 0.94) as u8),
        color_with_alpha(secondary, (alpha as f32 * 0.90) as u8),
    ];
    if let Some(shader) = gradient_shader::linear(
        (
            Point::new(rect.left(), rect.top()),
            Point::new(rect.right(), rect.bottom()),
        ),
        colors.as_slice(),
        None,
        TileMode::Clamp,
        None,
        None,
    ) {
        let mut fill = Paint::default();
        fill.set_anti_alias(true);
        fill.set_shader(shader);
        canvas.draw_round_rect(rect, 10.0 * scale, 10.0 * scale, &fill);
    }

    let mut sheen = Paint::default();
    sheen.set_anti_alias(true);
    sheen.set_color(Color::from_argb((alpha as f32 * 0.18) as u8, 255, 255, 255));
    canvas.draw_circle(
        (
            rect.left() + rect.width() * 0.36,
            rect.top() + rect.height() * 0.38,
        ),
        rect.width() * 0.22,
        &sheen,
    );

    let mut stroke = Paint::default();
    stroke.set_anti_alias(true);
    stroke.set_style(PaintStyle::Stroke);
    stroke.set_stroke_width(0.9 * scale);
    stroke.set_color(Color::from_argb((alpha as f32 * 0.20) as u8, 255, 255, 255));
    canvas.draw_round_rect(rect, 10.0 * scale, 10.0 * scale, &stroke);
}

fn draw_music_search(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let (accent, _, _) = music_palette(data);
    let icon_x = rect.left() + 18.0 * scale;
    let text_x = rect.left() + 36.0 * scale;
    let chip_w = 72.0 * scale;
    let chip_rect = Rect::from_xywh(
        rect.right() - chip_w - 14.0 * scale,
        rect.center_y() - 9.0 * scale,
        chip_w,
        18.0 * scale,
    );
    let text_w = (chip_rect.left() - text_x - 10.0 * scale).max(1.0);

    draw_search_icon(
        canvas,
        icon_x,
        rect.center_y(),
        14.0 * scale,
        color_with_alpha(accent, (alpha as f32 * 0.96) as u8),
        1.8 * scale,
    );

    let display = if data.music_query.is_empty() {
        "鎼滅储姝屾洸銆佹瓕鎵?.."
    } else {
        data.music_query
    };
    let mut text = Paint::default();
    text.set_anti_alias(true);
    text.set_color(if data.music_query.is_empty() {
        Color::from_argb((alpha as f32 * 0.40) as u8, 142, 142, 147)
    } else {
        Color::from_argb(alpha, 255, 255, 255)
    });
    let display = if data.music_query.is_empty() {
        "Search NetEase tracks"
    } else {
        display
    };
    crate::ui::utils::draw_text_cached(
        canvas,
        display,
        (text_x, rect.center_y() + 5.0 * scale),
        14.2 * scale,
        FontStyle::normal(),
        &text,
        false,
        text_w,
    );
    draw_music_provider_chip(canvas, chip_rect, scale, alpha, "NETEASE");

    if !data.music_searching && data.frame_count % 60 < 30 {
        let prefix = data
            .music_query
            .get(..data.music_search_cursor.min(data.music_query.len()))
            .unwrap_or_default();
        let caret_x = text_x + measure_text_width(prefix, 14.2 * scale);
        let mut caret = Paint::default();
        caret.set_anti_alias(true);
        caret.set_style(PaintStyle::Stroke);
        caret.set_stroke_width(1.2 * scale);
        caret.set_color(color_with_alpha(accent, alpha));
        canvas.draw_line(
            (caret_x, rect.center_y() - 8.0 * scale),
            (caret_x, rect.center_y() + 8.0 * scale),
            &caret,
        );
    }
}

fn draw_music_results(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let pad = 20.0 * scale;
    let header_y = rect.top() + 20.0 * scale;
    let mut header = Paint::default();
    header.set_anti_alias(true);
    header.set_color(Color::from_argb((alpha as f32 * 0.56) as u8, 142, 142, 147));
    let header_label = if !data.music_results_context_label.trim().is_empty() {
        data.music_results_context_label.to_string()
    } else if data.music_results.is_empty() {
        "NetEase Cloud Music".to_string()
    } else {
        format!("NetEase - {} results", data.music_results.len())
    };
    crate::ui::utils::draw_text_cached(
        canvas,
        &header_label,
        (rect.left() + pad, header_y),
        12.0 * scale,
        FontStyle::bold(),
        &header,
        false,
        rect.width() - pad * 2.0,
    );

    let close_cx = rect.right() - pad;
    let close_cy = rect.top() + 18.0 * scale;
    let mut close_bg = Paint::default();
    close_bg.set_anti_alias(true);
    close_bg.set_color(Color::from_argb((alpha as f32 * 0.08) as u8, 255, 255, 255));
    canvas.draw_circle((close_cx, close_cy), 12.0 * scale, &close_bg);
    draw_close_icon(
        canvas,
        close_cx,
        close_cy,
        10.0 * scale,
        Color::from_argb((alpha as f32 * 0.72) as u8, 196, 198, 204),
        1.6 * scale,
    );

    let list_rect = Rect::from_xywh(
        rect.left() + pad,
        rect.top() + 36.0 * scale,
        rect.width() - pad * 2.0,
        rect.height() - 52.0 * scale,
    );

    if data.music_results.is_empty() {
        let mut empty = Paint::default();
        empty.set_anti_alias(true);
        empty.set_color(Color::from_argb((alpha as f32 * 0.46) as u8, 142, 142, 147));
        crate::ui::utils::draw_text_cached(
            canvas,
            "娌℃湁鍙挱鏀剧殑鏇茬洰",
            (rect.center_x(), rect.center_y() + 4.0 * scale),
            13.0 * scale,
            FontStyle::normal(),
            &empty,
            true,
            rect.width() - pad * 2.0,
        );
        return;
    }

    let row_h = 52.0 * scale;
    let gap = 6.0 * scale;
    canvas.save();
    canvas.clip_rect(list_rect, ClipOp::Intersect, true);
    for (index, song) in data.music_results.iter().enumerate() {
        let y = list_rect.top() + index as f32 * (row_h + gap) - data.music_results_scroll;
        if y + row_h < list_rect.top() - 2.0 * scale || y > list_rect.bottom() + 2.0 * scale {
            continue;
        }
        let item_rect = Rect::from_xywh(list_rect.left(), y, list_rect.width(), row_h);
        let mut item_bg = Paint::default();
        item_bg.set_anti_alias(true);
        item_bg.set_color(Color::from_argb((alpha as f32 * 0.06) as u8, 255, 255, 255));
        canvas.draw_round_rect(item_rect, 12.0 * scale, 12.0 * scale, &item_bg);

        let art_rect = Rect::from_xywh(
            item_rect.left() + 8.0 * scale,
            item_rect.top() + 4.0 * scale,
            44.0 * scale,
            44.0 * scale,
        );
        draw_result_art_tile(
            canvas,
            art_rect,
            song,
            data.music_result_cover_images.get(&song.id),
            alpha,
            scale,
        );

        let text_x = art_rect.right() + 14.0 * scale;
        let text_w = (item_rect.right() - text_x - 12.0 * scale).max(1.0);
        let mut song_p = Paint::default();
        song_p.set_anti_alias(true);
        song_p.set_color(Color::from_argb(alpha, 255, 255, 255));
        crate::ui::utils::draw_text_cached(
            canvas,
            &song.name,
            (text_x, item_rect.top() + 22.0 * scale),
            14.6 * scale,
            FontStyle::bold(),
            &song_p,
            false,
            text_w,
        );

        let mut artist_p = Paint::default();
        artist_p.set_anti_alias(true);
        artist_p.set_color(Color::from_argb((alpha as f32 * 0.54) as u8, 142, 142, 147));
        crate::ui::utils::draw_text_cached(
            canvas,
            &song.artist,
            (text_x, item_rect.top() + 39.0 * scale),
            12.4 * scale,
            FontStyle::normal(),
            &artist_p,
            false,
            text_w,
        );
    }
    canvas.restore();
}

fn draw_music_auth(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let pad = 22.0 * scale;
    let chip_rect = Rect::from_xywh(
        rect.left() + pad,
        rect.top() + 18.0 * scale,
        74.0 * scale,
        18.0 * scale,
    );
    draw_music_provider_chip(canvas, chip_rect, scale, alpha, "NETEASE");

    let title = if data.music_auth_status == "success" {
        "NetEase connected"
    } else {
        "Connect NetEase"
    };
    let subtitle = match data.music_auth_status {
        "checking_connection" => "Checking saved local account...",
        "starting" => "Creating QR code...",
        "confirm" => "Scanned. Confirm login on your phone.",
        "failed" => "Login could not start. Tap to retry.",
        "expired" => "QR expired. Tap to refresh.",
        "success" => {
            if data.music_netease_account_name.trim().is_empty() {
                "Signed in locally."
            } else {
                data.music_netease_account_name
            }
        }
        _ => "Scan with the NetEase Cloud Music app.",
    };

    let mut title_p = Paint::default();
    title_p.set_anti_alias(true);
    title_p.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        title,
        (rect.left() + pad, rect.top() + 52.0 * scale),
        16.0 * scale,
        FontStyle::bold(),
        &title_p,
        false,
        rect.width() - pad * 2.0,
    );

    let mut subtitle_p = Paint::default();
    subtitle_p.set_anti_alias(true);
    subtitle_p.set_color(Color::from_argb((alpha as f32 * 0.64) as u8, 196, 202, 210));
    crate::ui::utils::draw_text_cached(
        canvas,
        subtitle,
        (rect.left() + pad, rect.top() + 70.0 * scale),
        11.6 * scale,
        FontStyle::normal(),
        &subtitle_p,
        false,
        rect.width() - pad * 2.0,
    );

    let qr_rect = Rect::from_xywh(
        rect.center_x() - 56.0 * scale,
        rect.top() + 88.0 * scale,
        112.0 * scale,
        112.0 * scale,
    );
    let mut qr_bg = Paint::default();
    qr_bg.set_anti_alias(true);
    qr_bg.set_color(Color::from_argb(alpha, 255, 255, 255));
    canvas.draw_round_rect(qr_rect, 20.0 * scale, 20.0 * scale, &qr_bg);

    if let Some(image) = data.music_auth_qr_image {
        canvas.save();
        canvas.clip_rrect(
            RRect::new_rect_xy(qr_rect, 20.0 * scale, 20.0 * scale),
            ClipOp::Intersect,
            true,
        );
        let sampling = skia_safe::SamplingOptions::new(
            skia_safe::FilterMode::Linear,
            skia_safe::MipmapMode::Linear,
        );
        let mut image_paint = Paint::default();
        image_paint.set_anti_alias(true);
        image_paint.set_alpha(alpha);
        canvas.draw_image_rect_with_sampling_options(
            image,
            None,
            qr_rect,
            sampling,
            &image_paint,
        );
        canvas.restore();
    } else {
        let mut placeholder = Paint::default();
        placeholder.set_anti_alias(true);
        placeholder.set_style(PaintStyle::Stroke);
        placeholder.set_stroke_width(1.4 * scale);
        placeholder.set_color(Color::from_argb((alpha as f32 * 0.28) as u8, 28, 28, 30));
        canvas.draw_round_rect(qr_rect, 20.0 * scale, 20.0 * scale, &placeholder);
    }

    let footer = match data.music_auth_status {
        "failed" | "expired" => "Tap once to retry",
        "success" => "Loading your music...",
        "confirm" => "Waiting for phone confirmation",
        "checking_connection" | "starting" => "Preparing NetEase login",
        _ => "Your account stays on this machine",
    };
    let mut footer_p = Paint::default();
    footer_p.set_anti_alias(true);
    footer_p.set_color(Color::from_argb((alpha as f32 * 0.52) as u8, 165, 170, 178));
    crate::ui::utils::draw_text_cached(
        canvas,
        footer,
        (rect.center_x(), rect.bottom() - 18.0 * scale),
        10.4 * scale,
        FontStyle::normal(),
        &footer_p,
        true,
        rect.width() - 28.0 * scale,
    );
}

fn draw_music_wave(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let Some(ms) = data.music_state else {
        return;
    };
    let (primary, secondary, _) = music_palette(data);
    let art_size = 22.0 * scale;
    let art_rect = Rect::from_xywh(
        rect.left() + 10.0 * scale,
        rect.center_y() - art_size / 2.0,
        art_size,
        art_size,
    );
    draw_music_glow(
        canvas,
        Point::new(art_rect.center_x(), art_rect.center_y()),
        14.0 * scale,
        primary,
        secondary,
        alpha,
        0.38 + data.music_transition_pulse * 0.16,
    );
    draw_music_album_art(canvas, art_rect, data, alpha, art_size / 2.0);
    draw_music_wave_bars(
        canvas,
        rect.right() - 22.0 * scale,
        rect.center_y() + 7.0 * scale,
        scale,
        alpha,
        primary,
        &ms.spectrum,
        ms.is_playing,
        3,
    );
}

fn draw_music_lyric(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let Some(ms) = data.music_state else {
        return;
    };
    let (primary, secondary, _) = music_palette(data);
    let art_size = 22.0 * scale;
    let art_rect = Rect::from_xywh(
        rect.left() + 10.0 * scale,
        rect.center_y() - art_size / 2.0,
        art_size,
        art_size,
    );
    draw_music_glow(
        canvas,
        Point::new(art_rect.center_x(), art_rect.center_y()),
        14.0 * scale,
        primary,
        secondary,
        alpha,
        0.42 + data.music_transition_pulse * 0.14,
    );
    draw_music_album_art(canvas, art_rect, data, alpha, art_size / 2.0);

    let lane_left = art_rect.right() + 12.0 * scale;
    let lane_width = rect.right() - lane_left - 12.0 * scale;
    let lane_h = 20.0 * scale;
    let baseline = rect.center_y() + 4.0 * scale;
    let transition = data.lyric_transition.clamp(0.0, 1.0);
    let lyric_line = if data.current_lyric.is_empty() {
        ms.media.title.as_str()
    } else {
        data.current_lyric
    };

    canvas.save();
    canvas.clip_rect(
        Rect::from_xywh(
            lane_left,
            rect.center_y() - lane_h / 2.0,
            lane_width,
            lane_h,
        ),
        ClipOp::Intersect,
        true,
    );
    if !data.old_lyric.is_empty() && transition < 1.0 {
        let mut old_p = Paint::default();
        old_p.set_anti_alias(true);
        old_p.set_color(Color::from_argb(
            ((1.0 - transition) * alpha as f32 * 0.34) as u8,
            255,
            255,
            255,
        ));
        crate::ui::utils::draw_text_cached(
            canvas,
            data.old_lyric,
            (lane_left, baseline - transition * lane_h),
            13.0 * scale,
            FontStyle::normal(),
            &old_p,
            false,
            lane_width,
        );
    }
    if !lyric_line.is_empty() {
        let mut current_p = Paint::default();
        current_p.set_anti_alias(true);
        current_p.set_color(color_with_alpha(primary, (transition * alpha as f32) as u8));
        crate::ui::utils::draw_text_cached(
            canvas,
            lyric_line,
            (lane_left, baseline + (1.0 - transition) * lane_h),
            13.0 * scale,
            FontStyle::bold(),
            &current_p,
            false,
            lane_width,
        );
    }
    canvas.restore();
}

// MusicExpand: full music panel.
fn draw_music_expand(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    draw_music_expand_main(canvas, rect, scale, data, alpha);
}

fn draw_music_expand_main(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let Some(ms) = data.music_state else {
        return;
    };
    let (primary, secondary, _) = music_palette(data);
    let px = 24.0 * scale;
    let py = 20.0 * scale;
    let art_size = 64.0 * scale;
    let art_rect = Rect::from_xywh(rect.left() + px, rect.top() + py, art_size, art_size);
    draw_music_glow(
        canvas,
        Point::new(art_rect.center_x(), art_rect.center_y()),
        26.0 * scale,
        primary,
        secondary,
        alpha,
        0.42 + data.music_transition_pulse * 0.18,
    );
    draw_music_album_art(canvas, art_rect, data, alpha, 16.0 * scale);

    let info_x = art_rect.right() + 16.0 * scale;
    let search_size = 32.0 * scale;
    let search_rect = Rect::from_xywh(
        rect.right() - px - search_size,
        rect.top() + py,
        search_size,
        search_size,
    );
    let info_w = (search_rect.left() - info_x - 10.0 * scale).max(1.0);
    let mut title = Paint::default();
    title.set_anti_alias(true);
    title.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        &ms.media.title,
        (info_x, art_rect.top() + 18.0 * scale),
        16.0 * scale,
        FontStyle::bold(),
        &title,
        false,
        info_w,
    );

    let mut subtitle = Paint::default();
    subtitle.set_anti_alias(true);
    subtitle.set_color(Color::from_argb((alpha as f32 * 0.56) as u8, 142, 142, 147));
    crate::ui::utils::draw_text_cached(
        canvas,
        &ms.media.artist,
        (info_x, art_rect.top() + 39.0 * scale),
        14.0 * scale,
        FontStyle::normal(),
        &subtitle,
        false,
        info_w,
    );
    let provider_chip = Rect::from_xywh(
        info_x,
        art_rect.top() + 48.0 * scale,
        74.0 * scale,
        18.0 * scale,
    );
    draw_music_provider_chip(canvas, provider_chip, scale, alpha, "NETEASE");

    let mut search_bg = Paint::default();
    search_bg.set_anti_alias(true);
    search_bg.set_color(Color::from_argb((alpha as f32 * 0.10) as u8, 255, 255, 255));
    canvas.draw_round_rect(search_rect, 16.0 * scale, 16.0 * scale, &search_bg);
    draw_search_icon(
        canvas,
        search_rect.center_x(),
        search_rect.center_y(),
        14.0 * scale,
        Color::from_argb(alpha, 255, 255, 255),
        1.8 * scale,
    );

    let progress = music_progress_fraction(data);
    let prog_y = art_rect.bottom() + 24.0 * scale;
    let prog_x = rect.left() + px;
    let prog_w = rect.width() - px * 2.0;
    let prog_h = 6.0 * scale;
    let mut progress_bg = Paint::default();
    progress_bg.set_anti_alias(true);
    progress_bg.set_color(Color::from_argb((alpha as f32 * 0.15) as u8, 255, 255, 255));
    canvas.draw_round_rect(
        Rect::from_xywh(prog_x, prog_y, prog_w, prog_h),
        3.0 * scale,
        3.0 * scale,
        &progress_bg,
    );

    let mut progress_fill = Paint::default();
    progress_fill.set_anti_alias(true);
    progress_fill.set_color(Color::from_argb(alpha, 255, 255, 255));
    canvas.draw_round_rect(
        Rect::from_xywh(prog_x, prog_y, prog_w * progress, prog_h),
        3.0 * scale,
        3.0 * scale,
        &progress_fill,
    );

    let ctrl_y = prog_y + 28.0 * scale;
    let ctrl_cx = rect.center_x();
    let gap = 36.0 * scale;
    let icon_s = 13.0 * scale;

    let mut icon = Paint::default();
    icon.set_anti_alias(true);
    icon.set_color(Color::from_argb(alpha, 255, 255, 255));
    icon.set_style(PaintStyle::Fill);
    draw_prev_icon(canvas, ctrl_cx - gap, ctrl_y, icon_s, &icon);
    draw_next_icon(canvas, ctrl_cx + gap, ctrl_y, icon_s, &icon);
    if ms.is_playing {
        draw_pause_icon(canvas, ctrl_cx, ctrl_y, 15.0 * scale, &icon);
    } else {
        draw_play_icon(canvas, ctrl_cx, ctrl_y, 15.0 * scale, &icon);
    }
}

fn draw_tool_panel(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let settle = if data.reduce_motion {
        1.0
    } else {
        (data.state_elapsed_ms as f32 / 280.0).clamp(0.0, 1.0)
    };
    canvas.save();
    if !data.reduce_motion {
        canvas.translate((0.0, (1.0 - settle) * 12.0 * scale));
    }
    draw_stack_view(canvas, rect, scale, data, (alpha as f32 * settle) as u8);
    canvas.restore();
}

fn draw_stack_view(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let pad = 16.0 * scale;
    let card_x = rect.left() + pad;
    let card_w = rect.width() - pad * 2.0;
    let top_y = rect.top() + 16.0 * scale;

    let mut back_bg = Paint::default();
    back_bg.set_anti_alias(true);
    back_bg.set_color(Color::from_argb((alpha as f32 * 0.06) as u8, 255, 255, 255));
    let back_rect = Rect::from_xywh(card_x, top_y, 36.0 * scale, 22.0 * scale);
    canvas.draw_round_rect(back_rect, 12.0 * scale, 12.0 * scale, &back_bg);

    let mut back_border = Paint::default();
    back_border.set_anti_alias(true);
    back_border.set_style(PaintStyle::Stroke);
    back_border.set_stroke_width(1.0 * scale);
    back_border.set_color(Color::from_argb((alpha as f32 * 0.08) as u8, 255, 255, 255));
    canvas.draw_round_rect(back_rect, 12.0 * scale, 12.0 * scale, &back_border);

    draw_stack_back_icon(
        canvas,
        back_rect.center_x(),
        back_rect.center_y(),
        10.0 * scale,
        Color::from_argb((alpha as f32 * 0.74) as u8, 232, 236, 242),
    );

    let primary_y = rect.top() + 42.0 * scale;
    let primary_h = 82.0 * scale;
    let mut primary_bg = Paint::default();
    primary_bg.set_anti_alias(true);
    primary_bg.set_color(Color::from_argb((alpha as f32 * 0.09) as u8, 255, 255, 255));
    canvas.draw_round_rect(
        Rect::from_xywh(card_x, primary_y, card_w, primary_h),
        20.0 * scale,
        20.0 * scale,
        &primary_bg,
    );

    let mut primary_border = Paint::default();
    primary_border.set_anti_alias(true);
    primary_border.set_style(PaintStyle::Stroke);
    primary_border.set_stroke_width(1.0 * scale);
    primary_border.set_color(Color::from_argb((alpha as f32 * 0.10) as u8, 255, 255, 255));
    canvas.draw_round_rect(
        Rect::from_xywh(card_x, primary_y, card_w, primary_h),
        20.0 * scale,
        20.0 * scale,
        &primary_border,
    );

    let has_resume = data.focus_total_ms > 0
        || data.audio_capture_running
        || data.screen_capture_running
        || !data.action_text.is_empty()
        || !data.action_detail_text.is_empty()
        || data.action_thumbnail.is_some()
        || data.action_requires_download
        || data.action_downloading
        || !data.last_tool_result.is_empty()
        || !data.output_text.is_empty()
        || data.music_state.is_some()
        || data.music_queue_len > 0
        || data.dropped_file_count > 0;

    let mut resume_chip = Paint::default();
    resume_chip.set_anti_alias(true);
    resume_chip.set_color(if has_resume {
        Color::from_argb((alpha as f32 * 0.10) as u8, 121, 197, 249)
    } else {
        Color::from_argb((alpha as f32 * 0.06) as u8, 255, 255, 255)
    });
    let chip_rect = Rect::from_xywh(
        card_x + 14.0 * scale,
        primary_y + 11.0 * scale,
        52.0 * scale,
        16.0 * scale,
    );
    canvas.draw_round_rect(chip_rect, 8.0 * scale, 8.0 * scale, &resume_chip);

    let mut chip_text = Paint::default();
    chip_text.set_anti_alias(true);
    chip_text.set_color(if has_resume {
        Color::from_argb((alpha as f32 * 0.86) as u8, 206, 232, 255)
    } else {
        Color::from_argb((alpha as f32 * 0.64) as u8, 222, 225, 232)
    });
    crate::ui::utils::draw_text_cached(
        canvas,
        if has_resume { "Resume" } else { "Tools" },
        (
            chip_rect.left() + 7.0 * scale,
            chip_rect.center_y() + 2.9 * scale,
        ),
        7.8 * scale,
        FontStyle::bold(),
        &chip_text,
        false,
        chip_rect.width() - 10.0 * scale,
    );

    let preview_size = 38.0 * scale;
    let preview_x = card_x + 14.0 * scale;
    let preview_y = primary_y + 31.0 * scale;
    if let Some(image) = data.action_thumbnail {
        let preview_rect = Rect::from_xywh(preview_x, preview_y, preview_size, preview_size);
        let preview_rrect = RRect::new_rect_xy(preview_rect, 12.0 * scale, 12.0 * scale);
        canvas.save();
        canvas.clip_rrect(preview_rrect, ClipOp::Intersect, true);
        canvas.draw_image_rect(image, None, preview_rect, &Paint::default());
        canvas.restore();

        let mut outline = Paint::default();
        outline.set_anti_alias(true);
        outline.set_style(PaintStyle::Stroke);
        outline.set_stroke_width(1.0 * scale);
        outline.set_color(Color::from_argb((alpha as f32 * 0.16) as u8, 255, 255, 255));
        canvas.draw_rrect(preview_rrect, &outline);
    } else {
        let mut orb = Paint::default();
        orb.set_anti_alias(true);
        orb.set_color(Color::from_argb((alpha as f32 * 0.14) as u8, 121, 197, 249));
        canvas.draw_round_rect(
            Rect::from_xywh(preview_x, preview_y, preview_size, preview_size),
            12.0 * scale,
            12.0 * scale,
            &orb,
        );
        draw_sparkle_icon(
            canvas,
            preview_x + preview_size * 0.5,
            preview_y + preview_size * 0.5,
            14.0 * scale,
            Color::from_argb(alpha, 255, 255, 255),
        );
    }

    let primary_title = if data.audio_capture_running {
        "Audio Notes recording"
    } else if data.screen_capture_running {
        "Screen recording"
    } else if !data.action_text.is_empty() {
        data.action_text
    } else if data.focus_total_ms > 0 {
        if data.focus_phase == FocusPhase::Break {
            "Focus break"
        } else if data.focus_running {
            "Focus running"
        } else {
            "Focus paused"
        }
    } else if !data.last_tool_name.is_empty() {
        data.last_tool_name
    } else if data.music_state.is_some() {
        "NetEase active"
    } else if data.music_netease_connected {
        "NetEase connected"
    } else if matches!(data.pill_state, PillState::MusicAuth) {
        "NetEase login"
    } else {
        "Nothing pending"
    };
    let primary_detail = if data.audio_capture_running {
        "Tap to return and stop when the note is done."
    } else if data.screen_capture_running {
        "Tap to return and stop when the capture is done."
    } else if !data.action_detail_text.is_empty() {
        data.action_detail_text
    } else if data.action_requires_download {
        "Tap download to save."
    } else if data.focus_total_ms > 0 {
        if data.focus_label_text.trim().is_empty() {
            "Return to the current round."
        } else {
            data.focus_label_text
        }
    } else if !data.last_tool_result.is_empty() {
        data.last_tool_result
    } else if !data.output_text.is_empty() {
        data.output_text
    } else if data.music_state.is_some() || data.music_queue_len > 0 {
        "Return to the current NetEase playback."
    } else if data.music_netease_connected {
        if data.music_netease_account_name.trim().is_empty() {
            "Open personalized NetEase music."
        } else {
            data.music_netease_account_name
        }
    } else if matches!(data.pill_state, PillState::MusicAuth) {
        "Scan to unlock richer playback."
    } else {
        "Choose a tool below."
    };

    let mut primary_title_p = Paint::default();
    primary_title_p.set_anti_alias(true);
    primary_title_p.set_color(Color::from_argb(alpha, 245, 247, 250));
    crate::ui::utils::draw_text_cached(
        canvas,
        primary_title,
        (card_x + 62.0 * scale, primary_y + 44.0 * scale),
        12.4 * scale,
        FontStyle::bold(),
        &primary_title_p,
        false,
        card_w - 88.0 * scale,
    );

    let mut primary_detail_p = Paint::default();
    primary_detail_p.set_anti_alias(true);
    primary_detail_p.set_color(Color::from_argb((alpha as f32 * 0.66) as u8, 206, 212, 220));
    let detail_lines = wrap_text_lines(primary_detail, 9.2 * scale, card_w - 88.0 * scale, 2);
    for (idx, line) in detail_lines.iter().enumerate() {
        crate::ui::utils::draw_text_cached(
            canvas,
            line,
            (
                card_x + 62.0 * scale,
                primary_y + 58.0 * scale + idx as f32 * 11.0 * scale,
            ),
            9.2 * scale,
            FontStyle::normal(),
            &primary_detail_p,
            false,
            card_w - 88.0 * scale,
        );
    }

    if has_resume {
        draw_expand_hint_icon(
            canvas,
            card_x + card_w - 18.0 * scale,
            primary_y + primary_h * 0.5,
            10.0 * scale,
            Color::from_argb((alpha as f32 * 0.76) as u8, 255, 255, 255),
        );
    }

    let tile_gap = 10.0 * scale;
    let tile_y = primary_y + primary_h + 12.0 * scale;
    let tile_w = (card_w - tile_gap) * 0.5;
    let tile_h = 60.0 * scale;

    draw_stack_tile(
        canvas,
        card_x,
        tile_y,
        tile_w,
        tile_h,
        "NetEase",
        if data.music_state.is_some() || data.music_queue_len > 0 {
            "listen"
        } else if data.music_netease_connected {
            "for you"
        } else {
            "connect"
        },
        "music",
        alpha,
        scale,
        data.music_state.is_some()
            || data.music_queue_len > 0
            || matches!(data.pill_state, PillState::MusicAuth)
            || data.music_netease_connected,
        *data.tool_presses.get(0).unwrap_or(&0.0),
    );
    draw_stack_tile(
        canvas,
        card_x + tile_w + tile_gap,
        tile_y,
        tile_w,
        tile_h,
        "Files",
        "open",
        "files",
        alpha,
        scale,
        data.action_requires_download
            || data.dropped_file_count > 0
            || !data.action_text.is_empty(),
        *data.tool_presses.get(1).unwrap_or(&0.0),
    );
    draw_stack_tile(
        canvas,
        card_x,
        tile_y + tile_h + tile_gap,
        tile_w,
        tile_h,
        "Studio",
        "edit",
        "studio",
        alpha,
        scale,
        data.action_is_image || data.action_editor_available,
        *data.tool_presses.get(2).unwrap_or(&0.0),
    );
    draw_stack_tile(
        canvas,
        card_x + tile_w + tile_gap,
        tile_y + tile_h + tile_gap,
        tile_w,
        tile_h,
        "Focus",
        "start",
        "focus",
        alpha,
        scale,
        data.focus_total_ms > 0
            || matches!(
                data.pill_state,
                PillState::FocusSetup
                    | PillState::FocusRun
                    | PillState::FocusExpand
                    | PillState::FocusComplete
            ),
        *data.tool_presses.get(3).unwrap_or(&0.0),
    );
    draw_stack_tile(
        canvas,
        card_x,
        tile_y + (tile_h + tile_gap) * 2.0,
        tile_w,
        tile_h,
        "Audio",
        "record",
        "audio",
        alpha,
        scale,
        data.audio_capture_running
            || matches!(
                data.pill_state,
                PillState::AudioRun | PillState::AudioExpand
            ),
        *data.tool_presses.get(4).unwrap_or(&0.0),
    );
    draw_stack_tile(
        canvas,
        card_x + tile_w + tile_gap,
        tile_y + (tile_h + tile_gap) * 2.0,
        tile_w,
        tile_h,
        "Screen",
        "record",
        "screen",
        alpha,
        scale,
        data.screen_capture_running
            || matches!(
                data.pill_state,
                PillState::ScreenRun | PillState::ScreenExpand
            ),
        *data.tool_presses.get(5).unwrap_or(&0.0),
    );
}

fn draw_stack_tile(
    canvas: &Canvas,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    label: &str,
    detail: &str,
    kind: &str,
    alpha: u8,
    scale: f32,
    active: bool,
    press: f32,
) {
    let mut bg = Paint::default();
    bg.set_anti_alias(true);
    let press_boost = press.clamp(0.0, 1.0);
    let (ra, r, g, b) = if active {
        (
            (alpha as f32 * (0.08 + 0.06 * press_boost)) as u8,
            76,
            142,
            250,
        )
    } else {
        (
            (alpha as f32 * (0.06 + 0.05 * press_boost)) as u8,
            255,
            255,
            255,
        )
    };
    bg.set_color(Color::from_argb(ra, r, g, b));
    canvas.draw_round_rect(Rect::from_xywh(x, y, w, h), 18.0 * scale, 18.0 * scale, &bg);

    let mut border = Paint::default();
    border.set_anti_alias(true);
    border.set_style(PaintStyle::Stroke);
    border.set_stroke_width(1.0 * scale);
    border.set_color(if active {
        Color::from_argb((alpha as f32 * 0.14) as u8, 112, 178, 255)
    } else {
        Color::from_argb((alpha as f32 * 0.08) as u8, 255, 255, 255)
    });
    canvas.draw_round_rect(
        Rect::from_xywh(x, y, w, h),
        18.0 * scale,
        18.0 * scale,
        &border,
    );

    let icon_x = x + 14.0 * scale;
    let icon_y = y + h * 0.5;
    let icon_color = if active {
        Color::from_argb(alpha, 255, 255, 255)
    } else {
        Color::from_argb((alpha as f32 * 0.84) as u8, 225, 228, 234)
    };
    draw_stack_tile_icon(
        canvas,
        icon_x,
        icon_y,
        14.0 * scale,
        kind,
        icon_color,
        scale,
    );

    let mut tx = Paint::default();
    tx.set_anti_alias(true);
    tx.set_color(Color::from_argb((alpha as f32 * 0.90) as u8, 240, 242, 246));
    crate::ui::utils::draw_text_cached(
        canvas,
        label,
        (x + 32.0 * scale, y + 25.0 * scale),
        10.8 * scale,
        FontStyle::bold(),
        &tx,
        false,
        w - 44.0 * scale,
    );

    let mut detail_p = Paint::default();
    detail_p.set_anti_alias(true);
    detail_p.set_color(if active {
        Color::from_argb((alpha as f32 * 0.60) as u8, 226, 232, 242)
    } else {
        Color::from_argb((alpha as f32 * 0.42) as u8, 198, 203, 212)
    });
    crate::ui::utils::draw_text_cached(
        canvas,
        detail,
        (x + 32.0 * scale, y + 39.0 * scale),
        8.8 * scale,
        FontStyle::normal(),
        &detail_p,
        false,
        w - 44.0 * scale,
    );
}

fn draw_stack_back_icon(canvas: &Canvas, cx: f32, cy: f32, size: f32, color: Color) {
    let mut p = Paint::default();
    p.set_anti_alias(true);
    p.set_style(PaintStyle::Stroke);
    p.set_stroke_width((size * 0.16).max(1.2));
    p.set_stroke_cap(skia_safe::paint::Cap::Round);
    p.set_stroke_join(skia_safe::paint::Join::Round);
    p.set_color(color);
    canvas.draw_line(
        (cx + size * 0.14, cy - size * 0.34),
        (cx - size * 0.20, cy),
        &p,
    );
    canvas.draw_line(
        (cx - size * 0.20, cy),
        (cx + size * 0.14, cy + size * 0.34),
        &p,
    );
}

fn draw_stack_tile_icon(
    canvas: &Canvas,
    cx: f32,
    cy: f32,
    size: f32,
    kind: &str,
    color: Color,
    scale: f32,
) {
    match kind {
        "music" => {
            let mut paint = Paint::default();
            paint.set_anti_alias(true);
            paint.set_color(color);
            for (idx, height) in [0.46_f32, 0.86_f32, 0.62_f32].iter().enumerate() {
                let x = cx - 6.0 * scale + idx as f32 * 4.8 * scale;
                let bar_h = size * *height;
                canvas.draw_round_rect(
                    Rect::from_xywh(x, cy - bar_h * 0.5, 2.8 * scale, bar_h),
                    1.4 * scale,
                    1.4 * scale,
                    &paint,
                );
            }
        }
        "files" => {
            let mut p = Paint::default();
            p.set_anti_alias(true);
            p.set_style(PaintStyle::Stroke);
            p.set_stroke_width(1.6 * scale);
            p.set_color(color);
            let rect = Rect::from_xywh(
                cx - 6.0 * scale,
                cy - 7.0 * scale,
                11.0 * scale,
                14.0 * scale,
            );
            canvas.draw_round_rect(rect, 3.0 * scale, 3.0 * scale, &p);
            canvas.draw_line(
                (rect.left() + 2.4 * scale, rect.top() + 4.8 * scale),
                (rect.right() - 2.4 * scale, rect.top() + 4.8 * scale),
                &p,
            );
        }
        "studio" => {
            draw_sparkle_icon(canvas, cx, cy, 14.0 * scale, color);
        }
        "focus" => {
            let mut p = Paint::default();
            p.set_anti_alias(true);
            p.set_style(PaintStyle::Stroke);
            p.set_stroke_width(1.5 * scale);
            p.set_color(color);
            canvas.draw_circle((cx, cy), 5.2 * scale, &p);
            canvas.draw_line((cx, cy), (cx, cy - 3.0 * scale), &p);
            canvas.draw_line((cx, cy), (cx + 2.4 * scale, cy), &p);
            let mut dot = Paint::default();
            dot.set_anti_alias(true);
            dot.set_color(color);
            canvas.draw_circle((cx, cy - 7.2 * scale), 1.5 * scale, &dot);
        }
        "audio" => {
            let mut p = Paint::default();
            p.set_anti_alias(true);
            p.set_color(color);
            canvas.draw_round_rect(
                Rect::from_xywh(
                    cx - 3.4 * scale,
                    cy - 7.2 * scale,
                    6.8 * scale,
                    11.0 * scale,
                ),
                3.4 * scale,
                3.4 * scale,
                &p,
            );
            canvas.draw_round_rect(
                Rect::from_xywh(cx - 1.2 * scale, cy + 3.6 * scale, 2.4 * scale, 4.8 * scale),
                1.2 * scale,
                1.2 * scale,
                &p,
            );
            canvas.draw_round_rect(
                Rect::from_xywh(
                    cx - 5.6 * scale,
                    cy + 7.6 * scale,
                    11.2 * scale,
                    1.8 * scale,
                ),
                0.9 * scale,
                0.9 * scale,
                &p,
            );
        }
        "screen" => {
            let mut p = Paint::default();
            p.set_anti_alias(true);
            p.set_style(PaintStyle::Stroke);
            p.set_stroke_width(1.5 * scale);
            p.set_color(color);
            canvas.draw_round_rect(
                Rect::from_xywh(
                    cx - 7.0 * scale,
                    cy - 5.8 * scale,
                    14.0 * scale,
                    9.8 * scale,
                ),
                2.4 * scale,
                2.4 * scale,
                &p,
            );
            canvas.draw_line(
                (cx - 2.6 * scale, cy + 5.8 * scale),
                (cx + 2.6 * scale, cy + 5.8 * scale),
                &p,
            );
            canvas.draw_line((cx, cy + 4.0 * scale), (cx, cy + 7.4 * scale), &p);
        }
        _ => {
            let mut p = Paint::default();
            p.set_anti_alias(true);
            p.set_color(color);
            canvas.draw_circle((cx, cy), 4.0 * scale, &p);
        }
    }
}

fn draw_action(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    if data.action_is_image {
        draw_action_image(canvas, rect, scale, data, alpha);
    } else if data.action_is_video {
        draw_action_video(canvas, rect, scale, data, alpha);
    } else {
        draw_action_default(canvas, rect, scale, data, alpha);
    }
}

fn draw_file_action(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let pad = 16.0 * scale;
    let cy = rect.center_y();
    let icon_size = 28.0 * scale;
    let icon_rect = Rect::from_xywh(
        rect.left() + pad,
        cy - icon_size / 2.0,
        icon_size,
        icon_size,
    );
    draw_file_preview_symbol(
        canvas,
        icon_rect,
        data.action_thumbnail,
        data.action_file_name,
        "",
        alpha,
    );

    let btn_r = 12.0 * scale;
    let btn_cx = rect.right() - pad - btn_r;
    let btn_cy = cy;
    let text_x = icon_rect.right() + 10.0 * scale;
    let text_w = (btn_cx - btn_r - text_x - 8.0 * scale).max(1.0);
    let summary_report = is_summary_report_document(data.action_file_name, data.action_detail_text);
    let title = if summary_report && data.action_downloading {
        "Saving report"
    } else if summary_report && data.action_requires_download {
        if data.action_text.trim().is_empty() {
            "Summary report"
        } else {
            data.action_text
        }
    } else if summary_report {
        if data.action_text.trim().is_empty() {
            "Report saved"
        } else {
            data.action_text
        }
    } else if data.action_downloading {
        "Saving result"
    } else if data.action_requires_download {
        "Result ready"
    } else {
        "Saved locally"
    };
    let detail = if !data.action_detail_text.trim().is_empty() {
        data.action_detail_text
    } else if summary_report && data.action_requires_download {
        "Markdown summary report. Download to keep."
    } else if summary_report {
        "Saved locally"
    } else if data.action_downloading {
        "Saving locally"
    } else if data.action_requires_download {
        "Download to keep"
    } else {
        "Saved locally"
    };

    let mut status_p = Paint::default();
    status_p.set_anti_alias(true);
    status_p.set_color(Color::from_argb((alpha as f32 * 0.46) as u8, 170, 176, 186));
    crate::ui::utils::draw_text_cached(
        canvas,
        if summary_report { "REPORT" } else { "FILE" },
        (text_x, cy - 10.0 * scale),
        8.8 * scale,
        FontStyle::bold(),
        &status_p,
        false,
        text_w,
    );

    let mut text_p = Paint::default();
    text_p.set_anti_alias(true);
    text_p.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        title,
        (text_x, cy + 1.5 * scale),
        12.6 * scale,
        FontStyle::bold(),
        &text_p,
        false,
        text_w,
    );

    let mut detail_p = Paint::default();
    detail_p.set_anti_alias(true);
    detail_p.set_color(Color::from_argb((alpha as f32 * 0.68) as u8, 186, 190, 198));
    crate::ui::utils::draw_text_cached(
        canvas,
        detail,
        (text_x, cy + 12.5 * scale),
        9.6 * scale,
        FontStyle::normal(),
        &detail_p,
        false,
        text_w,
    );

    draw_file_download_button(canvas, btn_cx, btn_cy, btn_r, scale, data, alpha);
}

fn is_summary_report_document(file_name: &str, detail_text: &str) -> bool {
    let file_lower = file_name.to_ascii_lowercase();
    let detail_lower = detail_text.to_ascii_lowercase();
    (file_lower.ends_with(".md") || file_lower.ends_with(".pdf"))
        && (file_lower.contains("summary")
            || file_lower.contains("report")
            || detail_lower.contains("summary report")
            || detail_lower.contains("markdown"))
}

fn draw_action_default(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let pad = 12.0 * scale;
    let cy = rect.center_y();
    let btn_r = 10.0 * scale;
    let btn_cx = rect.right() - pad - btn_r;
    let btn_cy = cy;
    let kind = if data.action_is_image {
        ProcessingVisualKind::ImageGenerate
    } else {
        detect_processing_kind(data.action_text)
    };
    let (kr, kg, kb) = processing_kind_color(kind);

    let icon_cx = rect.left() + pad + 7.0 * scale;
    if data.action_progress >= 1.0 {
        draw_checkmark_icon(
            canvas,
            icon_cx,
            cy,
            14.0 * scale,
            Color::from_argb(alpha, 50, 215, 75),
        );
    } else {
        draw_processing_icon(
            canvas,
            icon_cx,
            cy,
            scale * 0.78,
            data.frame_count,
            alpha,
            kind,
        );
    }

    let text_x = icon_cx + 11.0 * scale;
    let text_w = (btn_cx - text_x - 7.0 * scale).max(1.0);
    let status = if data.action_progress >= 1.0 {
        "Delivered"
    } else if data.action_requires_download {
        "Ready"
    } else {
        "Sending"
    };
    let label = if data.action_text.is_empty() {
        if data.action_progress >= 1.0 {
            "Completed"
        } else if data.action_requires_download {
            "Result ready"
        } else {
            "Delivering..."
        }
    } else {
        data.action_text
    };

    let mut status_p = Paint::default();
    status_p.set_anti_alias(true);
    status_p.set_color(Color::from_argb((alpha as f32 * 0.72) as u8, kr, kg, kb));
    crate::ui::utils::draw_text_cached(
        canvas,
        status,
        (text_x, cy - 2.0 * scale),
        8.8 * scale,
        FontStyle::bold(),
        &status_p,
        false,
        text_w,
    );

    let mut text_p = Paint::default();
    text_p.set_anti_alias(true);
    text_p.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        label,
        (text_x, cy + 8.5 * scale),
        10.4 * scale,
        FontStyle::normal(),
        &text_p,
        false,
        text_w,
    );

    if data.action_progress >= 1.0 {
        draw_checkmark_icon(
            canvas,
            btn_cx,
            btn_cy,
            18.0 * scale,
            Color::from_argb(alpha, 50, 215, 75),
        );
    } else if data.action_progress > 0.0 {
        let mut ring = Paint::default();
        ring.set_anti_alias(true);
        ring.set_style(skia_safe::paint::Style::Stroke);
        ring.set_stroke_width(1.8 * scale);
        ring.set_color(Color::from_argb((alpha as f32 * 0.28) as u8, 255, 255, 255));
        canvas.draw_circle((btn_cx, btn_cy), btn_r, &ring);
        ring.set_color(Color::from_argb(alpha, kr, kg, kb));
        let sweep = data.action_progress.clamp(0.0, 1.0) * 360.0;
        let oval = Rect::from_xywh(btn_cx - btn_r, btn_cy - btn_r, btn_r * 2.0, btn_r * 2.0);
        canvas.draw_arc(oval, -90.0, sweep, false, &ring);
    } else {
        let mut ring = Paint::default();
        ring.set_anti_alias(true);
        ring.set_style(skia_safe::paint::Style::Stroke);
        ring.set_stroke_width(1.5 * scale);
        ring.set_color(Color::from_argb((alpha as f32 * 0.5) as u8, 255, 255, 255));
        canvas.draw_circle((btn_cx, btn_cy), btn_r, &ring);
        draw_download_arrow(
            canvas,
            btn_cx,
            btn_cy,
            8.0 * scale,
            Color::from_argb(alpha, kr, kg, kb),
        );
    }
}

fn draw_action_video(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let pad = 8.0 * scale;
    let poster_w = 78.0 * scale;
    let poster_h = 52.0 * scale;
    let poster_rect = Rect::from_xywh(
        rect.left() + pad,
        rect.center_y() - poster_h * 0.5,
        poster_w,
        poster_h,
    );
    let poster_corner = 18.0 * scale;
    let btn_r = 16.0 * scale;
    let btn_cx = rect.right() - 16.0 * scale - btn_r;
    let btn_cy = rect.center_y();
    let text_x = poster_rect.right() + 12.0 * scale;
    let text_w = (btn_cx - btn_r - 10.0 * scale - text_x).max(1.0);

    let mut poster_bg = Paint::default();
    poster_bg.set_anti_alias(true);
    poster_bg.set_color(Color::from_argb((alpha as f32 * 0.22) as u8, 255, 255, 255));
    canvas.draw_round_rect(poster_rect, poster_corner, poster_corner, &poster_bg);

    if let Some(image) = data.action_thumbnail {
        canvas.save();
        canvas.clip_rrect(
            RRect::new_rect_xy(poster_rect, poster_corner, poster_corner),
            ClipOp::Intersect,
            true,
        );
        let iw = image.width().max(1) as f32;
        let ih = image.height().max(1) as f32;
        let fill = (poster_rect.width() / iw)
            .max(poster_rect.height() / ih)
            .max(0.01);
        let dw = iw * fill;
        let dh = ih * fill;
        let dst = Rect::from_xywh(
            poster_rect.center_x() - dw / 2.0,
            poster_rect.center_y() - dh / 2.0,
            dw,
            dh,
        );
        let sampling = skia_safe::SamplingOptions::new(
            skia_safe::FilterMode::Linear,
            skia_safe::MipmapMode::Linear,
        );
        let mut image_p = Paint::default();
        image_p.set_anti_alias(true);
        image_p.set_alpha(alpha);
        canvas.draw_image_rect_with_sampling_options(image, None, dst, sampling, &image_p);
        canvas.restore();
    } else {
        let mut play_bg = Paint::default();
        play_bg.set_anti_alias(true);
        play_bg.set_color(Color::from_argb((alpha as f32 * 0.22) as u8, 0, 0, 0));
        canvas.draw_circle(
            (poster_rect.center_x(), poster_rect.center_y()),
            13.0 * scale,
            &play_bg,
        );
        let mut play = Paint::default();
        play.set_anti_alias(true);
        play.set_color(Color::from_argb(alpha, 255, 255, 255));
        draw_play_icon(
            canvas,
            poster_rect.center_x() - 1.5 * scale,
            poster_rect.center_y(),
            8.6 * scale,
            &play,
        );
    }

    let rail_y = poster_rect.bottom() - 8.0 * scale;
    let mut rail = Paint::default();
    rail.set_anti_alias(true);
    rail.set_color(Color::from_argb((alpha as f32 * 0.24) as u8, 255, 255, 255));
    canvas.draw_round_rect(
        Rect::from_xywh(
            poster_rect.left() + 8.0 * scale,
            rail_y,
            poster_rect.width() - 16.0 * scale,
            3.0 * scale,
        ),
        1.5 * scale,
        1.5 * scale,
        &rail,
    );
    let mut fill = Paint::default();
    fill.set_anti_alias(true);
    fill.set_color(Color::from_argb(alpha, 121, 197, 249));
    let progress = if data.action_downloading {
        data.action_progress.clamp(0.0, 1.0)
    } else if data.action_requires_download {
        0.72
    } else {
        1.0
    };
    canvas.draw_round_rect(
        Rect::from_xywh(
            poster_rect.left() + 8.0 * scale,
            rail_y,
            (poster_rect.width() - 16.0 * scale) * progress.max(0.14),
            3.0 * scale,
        ),
        1.5 * scale,
        1.5 * scale,
        &fill,
    );

    let title = if data.action_text.trim().is_empty() {
        "Video ready"
    } else {
        data.action_text
    };
    let subtitle = if !data.action_detail_text.trim().is_empty() {
        data.action_detail_text
    } else if data.action_downloading {
        "Saving locally"
    } else if data.action_requires_download {
        "Download to keep"
    } else {
        "Saved locally"
    };

    let mut title_p = Paint::default();
    title_p.set_anti_alias(true);
    title_p.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        title,
        (text_x, rect.center_y() - 2.5 * scale),
        13.0 * scale,
        FontStyle::bold(),
        &title_p,
        false,
        text_w,
    );

    let mut sub_p = Paint::default();
    sub_p.set_anti_alias(true);
    sub_p.set_color(Color::from_argb((alpha as f32 * 0.72) as u8, 186, 190, 198));
    crate::ui::utils::draw_text_cached(
        canvas,
        subtitle,
        (text_x, rect.center_y() + 11.0 * scale),
        10.4 * scale,
        FontStyle::normal(),
        &sub_p,
        false,
        text_w,
    );

    draw_glass_download_button(canvas, btn_cx, btn_cy, btn_r, scale, data, alpha);
}

fn draw_action_image(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let cy = rect.center_y();
    let thumb_size = 52.0 * scale;
    let thumb_x = rect.left() + 6.0 * scale;
    let thumb_y = cy - thumb_size / 2.0;
    let thumb_rect = Rect::from_xywh(thumb_x, thumb_y, thumb_size, thumb_size);

    let btn_r = 18.0 * scale;
    let btn_cx = rect.right() - 16.0 * scale - btn_r;
    let btn_cy = cy;

    let mut thumb_bg = Paint::default();
    thumb_bg.set_anti_alias(true);
    thumb_bg.set_color(Color::from_argb((alpha as f32 * 0.20) as u8, 255, 255, 255));
    canvas.draw_round_rect(thumb_rect, 26.0 * scale, 26.0 * scale, &thumb_bg);

    if let Some(image) = data.action_thumbnail {
        canvas.save();
        canvas.clip_rrect(
            RRect::new_rect_xy(thumb_rect, 26.0 * scale, 26.0 * scale),
            ClipOp::Intersect,
            true,
        );
        let iw = image.width().max(1) as f32;
        let ih = image.height().max(1) as f32;
        let fill = (thumb_rect.width() / iw)
            .max(thumb_rect.height() / ih)
            .max(0.01);
        let dw = iw * fill;
        let dh = ih * fill;
        let dst = Rect::from_xywh(
            thumb_rect.center_x() - dw / 2.0,
            thumb_rect.center_y() - dh / 2.0,
            dw,
            dh,
        );
        let sampling = skia_safe::SamplingOptions::new(
            skia_safe::FilterMode::Linear,
            skia_safe::MipmapMode::Linear,
        );
        let mut p = Paint::default();
        p.set_anti_alias(true);
        p.set_alpha(alpha);
        canvas.draw_image_rect_with_sampling_options(image, None, dst, sampling, &p);
        canvas.restore();
    } else {
        draw_sparkle_icon(
            canvas,
            thumb_rect.center_x(),
            thumb_rect.center_y(),
            16.0 * scale,
            Color::from_argb((alpha as f32 * 0.92) as u8, 255, 145, 192),
        );
    }

    let mut thumb_border = Paint::default();
    thumb_border.set_anti_alias(true);
    thumb_border.set_style(skia_safe::paint::Style::Stroke);
    thumb_border.set_stroke_width(1.0 * scale);
    thumb_border.set_color(Color::from_argb((alpha as f32 * 0.52) as u8, 255, 255, 255));
    canvas.draw_round_rect(thumb_rect, 26.0 * scale, 26.0 * scale, &thumb_border);

    let text_x = thumb_rect.right() + 12.0 * scale;
    let text_w = (btn_cx - btn_r - 8.0 * scale - text_x).max(1.0);
    let title = if data.action_text.trim().is_empty() {
        "Image ready"
    } else {
        data.action_text
    };
    let sub = if !data.action_detail_text.trim().is_empty() {
        data.action_detail_text
    } else if data.action_downloading {
        "Saving locally"
    } else if data.action_editor_available {
        "Preview or edit"
    } else if data.action_requires_download {
        "Preview or save"
    } else if data.action_is_image {
        "Saved locally"
    } else {
        "Saved locally"
    };

    let mut title_p = Paint::default();
    title_p.set_anti_alias(true);
    title_p.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        title,
        (text_x, cy - 2.2 * scale),
        13.2 * scale,
        FontStyle::bold(),
        &title_p,
        false,
        text_w,
    );

    let mut sub_p = Paint::default();
    sub_p.set_anti_alias(true);
    sub_p.set_color(Color::from_argb((alpha as f32 * 0.72) as u8, 180, 180, 188));
    crate::ui::utils::draw_text_cached(
        canvas,
        sub,
        (text_x, cy + 11.0 * scale),
        10.6 * scale,
        FontStyle::normal(),
        &sub_p,
        false,
        text_w,
    );

    draw_glass_download_button(canvas, btn_cx, btn_cy, btn_r, scale, data, alpha);
}
fn draw_image_preview(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let corner = 42.0 * scale;

    if let Some(image) = data.action_thumbnail {
        canvas.save();
        canvas.clip_rrect(
            RRect::new_rect_xy(rect, corner, corner),
            ClipOp::Intersect,
            true,
        );

        let iw = image.width().max(1) as f32;
        let ih = image.height().max(1) as f32;
        let fill = (rect.width() / iw).max(rect.height() / ih).max(0.01);
        let dw = iw * fill;
        let dh = ih * fill;
        let dst = Rect::from_xywh(
            rect.center_x() - dw / 2.0,
            rect.center_y() - dh / 2.0,
            dw,
            dh,
        );

        let sampling = skia_safe::SamplingOptions::new(
            skia_safe::FilterMode::Linear,
            skia_safe::MipmapMode::Linear,
        );
        let mut p = Paint::default();
        p.set_anti_alias(true);
        p.set_alpha(alpha);
        canvas.draw_image_rect_with_sampling_options(image, None, dst, sampling, &p);
        canvas.restore();
    } else {
        let mut bg = Paint::default();
        bg.set_anti_alias(true);
        bg.set_color(Color::from_argb((alpha as f32 * 0.14) as u8, 255, 255, 255));
        canvas.draw_round_rect(rect, corner, corner, &bg);
        draw_sparkle_icon(
            canvas,
            rect.center_x(),
            rect.center_y() - 8.0 * scale,
            24.0 * scale,
            Color::from_argb((alpha as f32 * 0.82) as u8, 255, 92, 150),
        );
    }

    let overlay_h = 80.0 * scale;
    let overlay_rect = Rect::from_xywh(
        rect.left(),
        rect.bottom() - overlay_h,
        rect.width(),
        overlay_h,
    );
    let overlay_colors = [
        Color::from_argb((alpha as f32 * 0.82) as u8, 0, 0, 0),
        Color::from_argb(0, 0, 0, 0),
    ];
    let overlay_stops = [0.0_f32, 1.0_f32];
    if let Some(shader) = gradient_shader::linear(
        (
            Point::new(overlay_rect.left(), overlay_rect.bottom()),
            Point::new(overlay_rect.left(), overlay_rect.top()),
        ),
        overlay_colors.as_slice(),
        Some(overlay_stops.as_slice()),
        TileMode::Clamp,
        None,
        None,
    ) {
        let mut overlay = Paint::default();
        overlay.set_anti_alias(true);
        overlay.set_shader(shader);
        canvas.draw_rect(overlay_rect, &overlay);
    }

    let afford_w = 40.0 * scale;
    let afford_h = 5.0 * scale;
    let afford_rect = Rect::from_xywh(
        rect.center_x() - afford_w / 2.0,
        rect.bottom() - 12.0 * scale - afford_h,
        afford_w,
        afford_h,
    );
    let mut afford = Paint::default();
    afford.set_anti_alias(true);
    afford.set_color(Color::from_argb((alpha as f32 * 0.88) as u8, 255, 255, 255));
    canvas.draw_round_rect(afford_rect, afford_h / 2.0, afford_h / 2.0, &afford);

    if data.action_is_image {
        draw_glass_edit_button(
            canvas,
            rect.left() + 24.0 * scale,
            rect.bottom() - 20.0 * scale - 32.0 * scale,
            64.0 * scale,
            32.0 * scale,
            alpha,
        );
    }

    let btn_r = 18.0 * scale;
    let btn_cx = rect.right() - 24.0 * scale - btn_r;
    let btn_cy = rect.bottom() - 20.0 * scale - btn_r;
    draw_glass_download_button(canvas, btn_cx, btn_cy, btn_r, scale, data, alpha);
}

fn draw_image_edit(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let canvas_rect = Rect::from_xywh(
        rect.left() + IMAGE_EDIT_CANVAS_SIDE_PADDING * scale,
        rect.top() + IMAGE_EDIT_CANVAS_TOP * scale,
        rect.width() - IMAGE_EDIT_CANVAS_SIDE_PADDING * 2.0 * scale,
        rect.height() - (IMAGE_EDIT_CANVAS_TOP + IMAGE_EDIT_CANVAS_BOTTOM_GAP) * scale,
    );
    let display_rect = contain_image_rect(
        canvas_rect,
        if let Some(image) = data.action_thumbnail {
            image.width() as f32 / image.height().max(1) as f32
        } else {
            1.0
        },
    );

    if let Some(image) = data.action_thumbnail {
        draw_image_edit_backdrop(canvas, canvas_rect, image, scale, alpha);
        canvas.save();
        canvas.clip_rrect(
            RRect::new_rect_xy(display_rect, 22.0 * scale, 22.0 * scale),
            ClipOp::Intersect,
            true,
        );
        let iw = image.width().max(1) as f32;
        let ih = image.height().max(1) as f32;
        let fill = (display_rect.width() / iw)
            .min(display_rect.height() / ih)
            .max(0.01);
        let dw = iw * fill;
        let dh = ih * fill;
        let dst = Rect::from_xywh(
            display_rect.center_x() - dw / 2.0,
            display_rect.center_y() - dh / 2.0,
            dw,
            dh,
        );
        let sampling = skia_safe::SamplingOptions::new(
            skia_safe::FilterMode::Linear,
            skia_safe::MipmapMode::Linear,
        );
        let mut p = Paint::default();
        p.set_anti_alias(true);
        p.set_alpha(alpha);
        canvas.draw_image_rect_with_sampling_options(image, None, dst, sampling, &p);
        canvas.restore();
    }

    if let Some(mask_image) = data.image_edit_mask_preview {
        canvas.save();
        canvas.clip_rrect(
            RRect::new_rect_xy(display_rect, 22.0 * scale, 22.0 * scale),
            ClipOp::Intersect,
            true,
        );
        let sampling = skia_safe::SamplingOptions::new(
            skia_safe::FilterMode::Linear,
            skia_safe::MipmapMode::Linear,
        );
        let mut mask_p = Paint::default();
        mask_p.set_anti_alias(true);
        mask_p.set_alpha(alpha);
        canvas.draw_image_rect_with_sampling_options(
            mask_image,
            None,
            display_rect,
            sampling,
            &mask_p,
        );
        canvas.restore();
    } else {
        draw_mask_stroke_overlay(
            canvas,
            display_rect,
            scale,
            data.image_edit_mask_strokes,
            alpha,
        );
    }

    let helper = match data.image_edit_tool {
        ImageEditTool::RemoveObject if data.image_edit_has_mask => {
            "Mask ready. Type a cleanup note or leave it blank. Shift-drag erases the mask."
        }
        ImageEditTool::RemoveObject => {
            "Paint the target, then type naturally: remove it, clean the logo, heal the wall."
        }
        ImageEditTool::ReplaceObject => {
            "Mask the target, then describe the new subject naturally. Shift-drag erases the mask."
        }
        ImageEditTool::AddText => {
            "Mask the placement, then type the exact words and optional style."
        }
        ImageEditTool::Outpaint => {
            "Type naturally to extend the frame: make it wider, taller, or build a full border."
        }
        ImageEditTool::RemoveBackground => {
            "No mask needed. Type naturally: remove background, keep the subject clean, export a cutout."
        }
        ImageEditTool::RemoveWatermark => {
            "No mask needed. Type naturally: remove watermark, clean the logo, preserve the original artwork."
        }
        ImageEditTool::Upscale => {
            "No mask needed. Type naturally: upscale to 2x, make it HD, keep the composition intact."
        }
        ImageEditTool::FaceRestore => {
            "No mask needed. Type naturally: restore the face, clean skin detail, sharpen the portrait."
        }
    };
    let mut helper_p = Paint::default();
    helper_p.set_anti_alias(true);
    helper_p.set_color(Color::from_argb((alpha as f32 * 0.66) as u8, 186, 190, 198));
    crate::ui::utils::draw_text_cached(
        canvas,
        helper,
        (
            rect.left() + IMAGE_EDIT_CANVAS_SIDE_PADDING * scale,
            rect.top() + (IMAGE_EDIT_PROMPT_TOP - 14.0) * scale,
        ),
        10.0 * scale,
        FontStyle::normal(),
        &helper_p,
        false,
        rect.width() - IMAGE_EDIT_CANVAS_SIDE_PADDING * 2.0 * scale,
    );

    let prompt_rect = Rect::from_xywh(
        rect.left() + IMAGE_EDIT_CANVAS_SIDE_PADDING * scale,
        rect.top() + IMAGE_EDIT_PROMPT_TOP * scale,
        rect.width() - IMAGE_EDIT_CANVAS_SIDE_PADDING * 2.0 * scale,
        IMAGE_EDIT_PROMPT_HEIGHT * scale,
    );
    draw_edit_prompt_box(canvas, prompt_rect, scale, data, alpha);

    draw_edit_action_button(
        canvas,
        Rect::from_xywh(
            rect.left() + IMAGE_EDIT_CANVAS_SIDE_PADDING * scale,
            rect.top() + IMAGE_EDIT_ACTION_TOP * scale,
            54.0 * scale,
            IMAGE_EDIT_ACTION_HEIGHT * scale,
        ),
        "Clear",
        false,
        alpha,
        scale,
    );
    draw_edit_action_button(
        canvas,
        Rect::from_xywh(
            rect.right() - 138.0 * scale,
            rect.top() + IMAGE_EDIT_ACTION_TOP * scale,
            60.0 * scale,
            IMAGE_EDIT_ACTION_HEIGHT * scale,
        ),
        "Studio",
        false,
        alpha,
        scale,
    );
    draw_edit_action_button(
        canvas,
        Rect::from_xywh(
            rect.right() - 70.0 * scale,
            rect.top() + IMAGE_EDIT_ACTION_TOP * scale,
            52.0 * scale,
            IMAGE_EDIT_ACTION_HEIGHT * scale,
        ),
        "Apply",
        true,
        alpha,
        scale,
    );
}

fn draw_image_edit_backdrop(
    canvas: &Canvas,
    canvas_rect: Rect,
    image: &Image,
    scale: f32,
    alpha: u8,
) {
    let iw = image.width().max(1) as f32;
    let ih = image.height().max(1) as f32;
    let fill = (canvas_rect.width() / iw)
        .max(canvas_rect.height() / ih)
        .max(0.01);
    let dw = iw * fill;
    let dh = ih * fill;
    let dst = Rect::from_xywh(
        canvas_rect.center_x() - dw / 2.0,
        canvas_rect.center_y() - dh / 2.0,
        dw,
        dh,
    );
    let sampling = skia_safe::SamplingOptions::new(
        skia_safe::FilterMode::Linear,
        skia_safe::MipmapMode::Linear,
    );

    canvas.save();
    canvas.clip_rrect(
        RRect::new_rect_xy(canvas_rect, 26.0 * scale, 26.0 * scale),
        ClipOp::Intersect,
        true,
    );

    let mut backdrop = Paint::default();
    backdrop.set_anti_alias(true);
    backdrop.set_alpha((alpha as f32 * 0.62) as u8);
    if let Some(blur) = image_filters::blur((14.0 * scale, 14.0 * scale), None, None, None) {
        backdrop.set_image_filter(blur);
    }
    canvas.draw_image_rect_with_sampling_options(image, None, dst, sampling, &backdrop);

    let mut wash = Paint::default();
    wash.set_anti_alias(true);
    wash.set_color(Color::from_argb((alpha as f32 * 0.18) as u8, 4, 7, 12));
    canvas.draw_rect(canvas_rect, &wash);

    let mut glow = Paint::default();
    glow.set_anti_alias(true);
    let glow_colors = [
        Color::from_argb((alpha as f32 * 0.18) as u8, 255, 255, 255),
        Color::from_argb(0, 255, 255, 255),
    ];
    if let Some(shader) = gradient_shader::linear(
        (
            Point::new(canvas_rect.left(), canvas_rect.top()),
            Point::new(canvas_rect.left(), canvas_rect.bottom()),
        ),
        glow_colors.as_slice(),
        None,
        TileMode::Clamp,
        None,
        None,
    ) {
        glow.set_shader(shader);
        canvas.draw_rect(canvas_rect, &glow);
    }

    canvas.restore();
}

fn contain_image_rect(container: Rect, ratio: f32) -> Rect {
    let safe_ratio = ratio.clamp(0.2, 5.0);
    let container_ratio = container.width() / container.height().max(1.0);
    if safe_ratio >= container_ratio {
        let width = container.width();
        let height = (width / safe_ratio).max(1.0);
        Rect::from_xywh(
            container.left(),
            container.center_y() - height / 2.0,
            width,
            height,
        )
    } else {
        let height = container.height();
        let width = (height * safe_ratio).max(1.0);
        Rect::from_xywh(
            container.center_x() - width / 2.0,
            container.top(),
            width,
            height,
        )
    }
}

fn draw_mask_stroke_overlay(
    canvas: &Canvas,
    rect: Rect,
    scale: f32,
    strokes: &[ImageMaskStroke],
    alpha: u8,
) {
    for stroke in strokes {
        if stroke.points.is_empty() {
            continue;
        }
        let stroke_w =
            (stroke.radius_norm * rect.width().max(rect.height()) * 2.0).max(4.0 * scale);
        let mut paint = Paint::default();
        paint.set_anti_alias(true);
        paint.set_style(skia_safe::paint::Style::Stroke);
        paint.set_stroke_width(stroke_w);
        paint.set_stroke_cap(skia_safe::paint::Cap::Round);
        paint.set_stroke_join(skia_safe::paint::Join::Round);
        paint.set_color(if stroke.erase {
            Color::from_argb((alpha as f32 * 0.5) as u8, 121, 197, 249)
        } else {
            Color::from_argb((alpha as f32 * 0.64) as u8, 255, 88, 140)
        });

        if stroke.points.len() == 1 {
            let point = &stroke.points[0];
            canvas.draw_circle(
                (
                    rect.left() + point.x * rect.width(),
                    rect.top() + point.y * rect.height(),
                ),
                stroke_w * 0.5,
                &paint,
            );
            continue;
        }

        let mut path = PathBuilder::default();
        for (index, point) in stroke.points.iter().enumerate() {
            let x = rect.left() + point.x * rect.width();
            let y = rect.top() + point.y * rect.height();
            if index == 0 {
                path.move_to((x, y));
            } else {
                path.line_to((x, y));
            }
        }
        canvas.draw_path(&path.detach(), &paint);
    }
}

fn draw_edit_chip(canvas: &Canvas, rect: Rect, label: &str, active: bool, alpha: u8, scale: f32) {
    let mut bg = Paint::default();
    bg.set_anti_alias(true);
    bg.set_color(if active {
        Color::from_argb((alpha as f32 * 0.24) as u8, 121, 197, 249)
    } else {
        Color::from_argb((alpha as f32 * 0.08) as u8, 255, 255, 255)
    });
    canvas.draw_round_rect(rect, 14.0 * scale, 14.0 * scale, &bg);

    let mut border = Paint::default();
    border.set_anti_alias(true);
    border.set_style(skia_safe::paint::Style::Stroke);
    border.set_stroke_width(1.0 * scale);
    border.set_color(if active {
        Color::from_argb((alpha as f32 * 0.64) as u8, 121, 197, 249)
    } else {
        Color::from_argb((alpha as f32 * 0.22) as u8, 255, 255, 255)
    });
    canvas.draw_round_rect(rect, 14.0 * scale, 14.0 * scale, &border);

    let mut text = Paint::default();
    text.set_anti_alias(true);
    text.set_color(if active {
        Color::from_argb(alpha, 255, 255, 255)
    } else {
        Color::from_argb((alpha as f32 * 0.74) as u8, 228, 230, 236)
    });
    crate::ui::utils::draw_text_cached(
        canvas,
        label,
        (rect.center_x(), rect.center_y() + 4.0 * scale),
        10.6 * scale,
        FontStyle::bold(),
        &text,
        true,
        rect.width() - 8.0 * scale,
    );
}

fn draw_edit_prompt_box(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let mut bg = Paint::default();
    bg.set_anti_alias(true);
    bg.set_color(Color::from_argb((alpha as f32 * 0.08) as u8, 255, 255, 255));
    canvas.draw_round_rect(rect, 18.0 * scale, 18.0 * scale, &bg);

    let mut border = Paint::default();
    border.set_anti_alias(true);
    border.set_style(skia_safe::paint::Style::Stroke);
    border.set_stroke_width(1.0 * scale);
    border.set_color(Color::from_argb((alpha as f32 * 0.18) as u8, 255, 255, 255));
    canvas.draw_round_rect(rect, 18.0 * scale, 18.0 * scale, &border);

    let placeholder = match data.image_edit_tool {
        ImageEditTool::RemoveObject => "Mask and type naturally...",
        ImageEditTool::ReplaceObject => "Describe what should replace it...",
        ImageEditTool::AddText => "Type the exact text and style...",
        ImageEditTool::Outpaint => "Describe how the frame should expand...",
        ImageEditTool::RemoveBackground => "Type: remove background / 鎵ｉ櫎鑳屾櫙...",
        ImageEditTool::RemoveWatermark => "Type: remove watermark / 鍘婚櫎姘村嵃...",
        ImageEditTool::Upscale => "Type: upscale 2x, make it HD...",
        ImageEditTool::FaceRestore => "Type: restore face, clean portrait...",
    };
    let text_value = if data.image_edit_prompt.trim().is_empty() {
        placeholder
    } else {
        data.image_edit_prompt
    };

    let font_size = 13.2 * scale;
    let line_h = font_size * 1.42;
    let pad_x = 14.0 * scale;
    let pad_y = if data.image_edit_prompt.trim().is_empty() {
        ((rect.height() - line_h) * 0.5).max(10.0 * scale)
    } else {
        10.0 * scale
    };
    let content_w = rect.width() - pad_x * 2.0;
    let layout = wrap_text_layout(text_value, font_size, content_w, Some(2)).0;

    let mut text = Paint::default();
    text.set_anti_alias(true);
    text.set_color(if data.image_edit_prompt.trim().is_empty() {
        Color::from_argb((alpha as f32 * 0.42) as u8, 186, 190, 198)
    } else {
        Color::from_argb(alpha, 255, 255, 255)
    });

    for (index, line) in layout.iter().enumerate() {
        crate::ui::utils::draw_text_cached(
            canvas,
            &line.text,
            (
                rect.left() + pad_x,
                rect.top() + pad_y + font_size + index as f32 * line_h,
            ),
            font_size,
            FontStyle::normal(),
            &text,
            false,
            content_w,
        );
    }

    if !data.image_edit_prompt.is_empty() && data.frame_count % 60 < 30 {
        let layout = wrap_text_layout(data.image_edit_prompt, font_size, content_w, Some(2)).0;
        let cursor_line = find_line_for_cursor(&layout, data.image_edit_cursor);
        if let Some(line) = layout.get(cursor_line).or_else(|| layout.last()) {
            let prefix_end = data.image_edit_cursor.clamp(line.start, line.end);
            let prefix = data
                .image_edit_prompt
                .get(line.start..prefix_end)
                .unwrap_or_default();
            let cx = rect.left() + pad_x + measure_text_width(prefix, font_size);
            let cy = rect.top() + pad_y + cursor_line as f32 * line_h;
            let mut caret = Paint::default();
            caret.set_anti_alias(true);
            caret.set_color(Color::from_argb(alpha, 121, 197, 249));
            caret.set_stroke_width(1.2 * scale);
            canvas.draw_line(
                (cx, cy + 2.0 * scale),
                (cx, cy + line_h - 2.0 * scale),
                &caret,
            );
        }
    }
}

fn draw_focus_label_box(canvas: &Canvas, rect: Rect, scale: f32, data: &FrameData, alpha: u8) {
    let mut bg = Paint::default();
    bg.set_anti_alias(true);
    bg.set_color(Color::from_argb((alpha as f32 * 0.07) as u8, 255, 255, 255));
    canvas.draw_round_rect(rect, 20.0 * scale, 20.0 * scale, &bg);

    let mut border = Paint::default();
    border.set_anti_alias(true);
    border.set_style(skia_safe::paint::Style::Stroke);
    border.set_stroke_width(1.0 * scale);
    border.set_color(Color::from_argb((alpha as f32 * 0.14) as u8, 255, 255, 255));
    canvas.draw_round_rect(rect, 20.0 * scale, 20.0 * scale, &border);

    let placeholder = "Optional label: write PRD, review launch, ship handoff...";
    let display = if data.focus_label_text.trim().is_empty() {
        placeholder
    } else {
        data.focus_label_text
    };
    let pad_x = 14.0 * scale;
    let baseline_y = rect.center_y() + 4.0 * scale;
    let mut text = Paint::default();
    text.set_anti_alias(true);
    text.set_color(if data.focus_label_text.trim().is_empty() {
        Color::from_argb((alpha as f32 * 0.40) as u8, 190, 190, 196)
    } else {
        Color::from_argb(alpha, 255, 255, 255)
    });
    crate::ui::utils::draw_text_cached(
        canvas,
        display,
        (rect.left() + pad_x, baseline_y),
        12.6 * scale,
        FontStyle::normal(),
        &text,
        false,
        rect.width() - pad_x * 2.0,
    );

    if !data.focus_label_text.is_empty() && data.frame_count % 60 < 30 {
        let prefix =
            &data.focus_label_text[..data.focus_label_cursor.min(data.focus_label_text.len())];
        let caret_x = rect.left() + pad_x + measure_text_width(prefix, 12.6 * scale);
        let mut caret = Paint::default();
        caret.set_anti_alias(true);
        caret.set_color(Color::from_argb(alpha, 255, 176, 82));
        caret.set_stroke_width(1.2 * scale);
        caret.set_style(skia_safe::paint::Style::Stroke);
        canvas.draw_line(
            (caret_x, rect.top() + 12.0 * scale),
            (caret_x, rect.bottom() - 12.0 * scale),
            &caret,
        );
    }
}

fn draw_edit_action_button(
    canvas: &Canvas,
    rect: Rect,
    label: &str,
    primary: bool,
    alpha: u8,
    scale: f32,
) {
    let mut bg = Paint::default();
    bg.set_anti_alias(true);
    bg.set_color(if primary {
        Color::from_argb((alpha as f32 * 0.24) as u8, 121, 197, 249)
    } else {
        Color::from_argb((alpha as f32 * 0.08) as u8, 255, 255, 255)
    });
    canvas.draw_round_rect(rect, 16.0 * scale, 16.0 * scale, &bg);

    let mut border = Paint::default();
    border.set_anti_alias(true);
    border.set_style(skia_safe::paint::Style::Stroke);
    border.set_stroke_width(1.0 * scale);
    border.set_color(if primary {
        Color::from_argb((alpha as f32 * 0.66) as u8, 121, 197, 249)
    } else {
        Color::from_argb((alpha as f32 * 0.18) as u8, 255, 255, 255)
    });
    canvas.draw_round_rect(rect, 16.0 * scale, 16.0 * scale, &border);

    let mut text = Paint::default();
    text.set_anti_alias(true);
    text.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        label,
        (rect.center_x(), rect.center_y() + 4.0 * scale),
        10.6 * scale,
        FontStyle::bold(),
        &text,
        true,
        rect.width() - 6.0 * scale,
    );
}

fn focus_progress_fraction(remaining_ms: u64, total_ms: u64) -> f32 {
    if total_ms == 0 {
        return 0.0;
    }
    let elapsed = total_ms.saturating_sub(remaining_ms);
    (elapsed as f32 / total_ms as f32).clamp(0.0, 1.0)
}

fn format_focus_time(ms: u64) -> String {
    let total_seconds = (ms / 1000).max(1);
    let minutes = total_seconds / 60;
    let seconds = total_seconds % 60;
    format!("{minutes:02}:{seconds:02}")
}

fn draw_glass_download_button(
    canvas: &Canvas,
    cx: f32,
    cy: f32,
    radius: f32,
    scale: f32,
    data: &FrameData,
    alpha: u8,
) {
    let mut bg = Paint::default();
    bg.set_anti_alias(true);
    bg.set_color(Color::from_argb((alpha as f32 * 0.38) as u8, 0, 0, 0));
    canvas.draw_circle((cx, cy), radius, &bg);

    let mut ring = Paint::default();
    ring.set_anti_alias(true);
    ring.set_style(skia_safe::paint::Style::Stroke);
    ring.set_stroke_width(1.4 * scale);
    ring.set_color(Color::from_argb((alpha as f32 * 0.36) as u8, 255, 255, 255));
    canvas.draw_circle((cx, cy), radius - 0.7 * scale, &ring);

    if data.action_downloading {
        ring.set_stroke_width(2.6 * scale);
        ring.set_color(Color::from_argb(alpha, 10, 132, 255));
        let sweep = data.action_progress.clamp(0.0, 1.0) * 360.0;
        let oval = Rect::from_xywh(cx - radius, cy - radius, radius * 2.0, radius * 2.0);
        canvas.draw_arc(oval, -90.0, sweep, false, &ring);
        return;
    }

    if data.action_requires_download {
        draw_download_arrow(
            canvas,
            cx,
            cy,
            10.0 * scale,
            Color::from_argb(alpha, 255, 255, 255),
        );
    } else {
        draw_checkmark_icon(
            canvas,
            cx,
            cy,
            12.0 * scale,
            Color::from_argb(alpha, 50, 215, 75),
        );
    }
}

fn draw_glass_edit_button(canvas: &Canvas, x: f32, y: f32, width: f32, height: f32, alpha: u8) {
    let rect = Rect::from_xywh(x, y, width, height);
    let radius = height * 0.5;
    let scale = height / 32.0;

    let mut bg = Paint::default();
    bg.set_anti_alias(true);
    bg.set_color(Color::from_argb((alpha as f32 * 0.30) as u8, 0, 0, 0));
    canvas.draw_round_rect(rect, radius, radius, &bg);

    let mut border = Paint::default();
    border.set_anti_alias(true);
    border.set_style(skia_safe::paint::Style::Stroke);
    border.set_stroke_width(1.2);
    border.set_color(Color::from_argb((alpha as f32 * 0.34) as u8, 255, 255, 255));
    canvas.draw_round_rect(rect, radius, radius, &border);

    draw_sparkle_icon(
        canvas,
        x + 14.0 * scale,
        y + height * 0.5,
        8.0 * scale,
        Color::from_argb(alpha, 255, 255, 255),
    );

    let mut text = Paint::default();
    text.set_anti_alias(true);
    text.set_color(Color::from_argb(alpha, 255, 255, 255));
    crate::ui::utils::draw_text_cached(
        canvas,
        "Edit",
        (x + 24.0 * scale, y + height * 0.5 + 4.0 * scale),
        10.4 * scale,
        FontStyle::bold(),
        &text,
        false,
        width - 28.0 * scale,
    );
}

fn draw_file_download_button(
    canvas: &Canvas,
    cx: f32,
    cy: f32,
    radius: f32,
    scale: f32,
    data: &FrameData,
    alpha: u8,
) {
    let mut ring = Paint::default();
    ring.set_anti_alias(true);
    ring.set_style(skia_safe::paint::Style::Stroke);
    ring.set_stroke_width(1.5 * scale);
    ring.set_color(Color::from_argb((alpha as f32 * 0.26) as u8, 255, 255, 255));
    canvas.draw_circle((cx, cy), radius, &ring);

    if data.action_downloading {
        ring.set_stroke_width(2.4 * scale);
        ring.set_color(Color::from_argb(alpha, 120, 197, 249));
        let sweep = data.action_progress.clamp(0.0, 1.0) * 360.0;
        let oval = Rect::from_xywh(cx - radius, cy - radius, radius * 2.0, radius * 2.0);
        canvas.draw_arc(oval, -90.0, sweep, false, &ring);
        return;
    }

    if data.action_requires_download {
        draw_download_arrow(
            canvas,
            cx,
            cy,
            8.8 * scale,
            Color::from_argb((alpha as f32 * 0.92) as u8, 255, 255, 255),
        );
    } else {
        draw_checkmark_icon(
            canvas,
            cx,
            cy,
            12.0 * scale,
            Color::from_argb(alpha, 50, 215, 75),
        );
    }
}

fn ensure_sk_surface(os_w: u32, os_h: u32) -> SkSurface {
    SK_SURFACE.with(|cell| {
        let mut opt = cell.borrow_mut();
        if let Some(ref s) = *opt {
            if s.width() == os_w as i32 && s.height() == os_h as i32 {
                return s.clone();
            }
        }
        let s = surfaces::raster_n32_premul(ISize::new(os_w as i32, os_h as i32)).unwrap();
        *opt = Some(s.clone());
        s
    })
}

fn draw_border(
    canvas: &Canvas,
    rrect: &RRect,
    w: &[f32; 4],
    cw: f32,
    oy: f32,
    ch: f32,
    ow: u32,
    s: f32,
) {
    let total: f32 = w.iter().sum();
    if total <= 0.01 {
        return;
    }
    let center = Point::new(ow as f32 / 2.0, oy + ch / 2.0);
    let colors = [
        border_color(w[0]),
        border_color(w[1]),
        border_color(w[2]),
        border_color(w[3]),
        border_color(w[0]),
    ];
    let stops = [0.0, 0.25, 0.5, 0.75, 1.0];
    let start = Point::new(center.x - cw / 2.0, center.y);
    let end = Point::new(center.x + cw / 2.0, center.y);
    if let Some(shader) = gradient_shader::linear(
        (start, end),
        &colors[..],
        Some(&stops[..]),
        TileMode::Clamp,
        None,
        None,
    ) {
        let mut p = Paint::default();
        p.set_shader(shader);
        p.set_style(skia_safe::paint::Style::Stroke);
        p.set_stroke_width(1.3 * s);
        p.set_anti_alias(true);
        canvas.draw_rrect(*rrect, &p);
    }
}

fn border_color(weight: f32) -> Color {
    if weight > 0.85 {
        Color::from_argb((weight * 44.0) as u8, 255, 255, 255)
    } else {
        Color::TRANSPARENT
    }
}

fn measure_text_width(text: &str, font_size: f32) -> f32 {
    text.chars()
        .map(|c| {
            if c.is_ascii() {
                font_size * 0.6
            } else {
                font_size
            }
        })
        .sum()
}

#[derive(Debug, Clone)]
struct WrappedLine {
    text: String,
    start: usize,
    end: usize,
}

impl WrappedLine {
    fn empty() -> Self {
        Self {
            text: String::new(),
            start: 0,
            end: 0,
        }
    }
}

fn wrap_text_layout(
    text: &str,
    font_size: f32,
    max_width: f32,
    max_lines: Option<usize>,
) -> (Vec<WrappedLine>, bool) {
    if max_lines == Some(0) {
        return (vec![WrappedLine::empty()], true);
    }

    let mut lines = Vec::new();
    let mut current = String::new();
    let mut current_w = 0.0;
    let mut line_start = 0usize;
    let mut line_end = 0usize;
    let mut truncated = false;

    for (idx, ch) in text.char_indices() {
        if ch == '\r' {
            continue;
        }
        let next_idx = idx + ch.len_utf8();
        if ch == '\n' {
            lines.push(WrappedLine {
                text: std::mem::take(&mut current),
                start: line_start,
                end: idx,
            });
            current_w = 0.0;
            line_start = next_idx;
            line_end = next_idx;
            if max_lines.is_some_and(|limit| lines.len() >= limit) {
                truncated = next_idx < text.len();
                break;
            }
            continue;
        }

        let ch_w = if ch.is_ascii() {
            font_size * 0.6
        } else {
            font_size
        };
        if current_w + ch_w > max_width && !current.is_empty() {
            lines.push(WrappedLine {
                text: std::mem::take(&mut current),
                start: line_start,
                end: idx,
            });
            current_w = 0.0;
            line_start = idx;
            if max_lines.is_some_and(|limit| lines.len() >= limit) {
                truncated = true;
                break;
            }
        }

        if current.is_empty() {
            line_start = idx;
        }
        current.push(ch);
        current_w += ch_w;
        line_end = next_idx;
    }

    if !truncated && (!current.is_empty() || text.ends_with('\n') || lines.is_empty()) {
        lines.push(WrappedLine {
            text: current,
            start: line_start,
            end: line_end.max(line_start),
        });
    }

    if lines.is_empty() {
        lines.push(WrappedLine::empty());
    }

    if let Some(limit) = max_lines {
        if lines.len() > limit {
            lines.truncate(limit);
            truncated = true;
        }
        if truncated {
            if let Some(last) = lines.last_mut() {
                while !last.text.is_empty()
                    && measure_text_width(&(last.text.clone() + "..."), font_size) > max_width
                {
                    last.text.pop();
                }
                if !last.text.ends_with("...") {
                    last.text.push_str("...");
                }
            }
        }
    }

    (lines, truncated)
}

pub(crate) fn estimate_wrapped_line_count(text: &str, font_size: f32, max_width: f32) -> usize {
    wrap_text_layout(text, font_size, max_width, None)
        .0
        .len()
        .max(1)
}

fn wrap_text_lines(text: &str, font_size: f32, max_width: f32, max_lines: usize) -> Vec<String> {
    wrap_text_layout(text, font_size, max_width, Some(max_lines))
        .0
        .into_iter()
        .map(|line| line.text)
        .collect()
}

fn find_line_for_cursor(lines: &[WrappedLine], cursor: usize) -> usize {
    for (idx, line) in lines.iter().enumerate() {
        if cursor <= line.end || idx + 1 == lines.len() {
            return idx;
        }
    }
    0
}

fn draw_file_processing_shell_glow(
    canvas: &Canvas,
    rect: Rect,
    radius: f32,
    scale: f32,
    frame: u64,
    opacity: f32,
) {
    let pulse = ((frame as f32 * 0.10).sin() * 0.5 + 0.5).clamp(0.0, 1.0);
    let glow = Rect::from_xywh(
        rect.left() - 1.2 * scale,
        rect.top() - 1.2 * scale,
        rect.width() + 2.4 * scale,
        rect.height() + 2.4 * scale,
    );
    let mut ring = Paint::default();
    ring.set_anti_alias(true);
    ring.set_style(skia_safe::paint::Style::Stroke);
    ring.set_stroke_width((1.0 + 0.4 * pulse) * scale);
    ring.set_color(Color::from_argb(
        (255.0 * opacity * (0.34 + 0.40 * pulse)) as u8,
        120,
        197,
        249,
    ));
    canvas.draw_round_rect(glow, radius + 1.2 * scale, radius + 1.2 * scale, &ring);
}

fn draw_file_preview_symbol(
    canvas: &Canvas,
    rect: Rect,
    thumbnail: Option<&Image>,
    file_name: &str,
    file_ext: &str,
    alpha: u8,
) {
    if let Some(image) = thumbnail {
        let corner = 8.0_f32.min(rect.width() * 0.32);
        canvas.save();
        canvas.clip_rrect(
            RRect::new_rect_xy(rect, corner, corner),
            ClipOp::Intersect,
            true,
        );
        let iw = image.width().max(1) as f32;
        let ih = image.height().max(1) as f32;
        let fill = (rect.width() / iw).max(rect.height() / ih).max(0.01);
        let dw = iw * fill;
        let dh = ih * fill;
        let dst = Rect::from_xywh(
            rect.center_x() - dw / 2.0,
            rect.center_y() - dh / 2.0,
            dw,
            dh,
        );
        let sampling = skia_safe::SamplingOptions::new(
            skia_safe::FilterMode::Linear,
            skia_safe::MipmapMode::Linear,
        );
        let mut p = Paint::default();
        p.set_anti_alias(true);
        p.set_alpha(alpha);
        canvas.draw_image_rect_with_sampling_options(image, None, dst, sampling, &p);
        canvas.restore();

        let mut border = Paint::default();
        border.set_anti_alias(true);
        border.set_style(skia_safe::paint::Style::Stroke);
        border.set_stroke_width(1.0);
        border.set_color(Color::from_argb((alpha as f32 * 0.18) as u8, 255, 255, 255));
        canvas.draw_round_rect(rect, corner, corner, &border);
        return;
    }

    let ext = if file_ext.trim().is_empty() {
        infer_file_ext(file_name)
    } else {
        file_ext.trim().to_ascii_lowercase()
    };
    draw_file_document_icon(canvas, rect, &ext, alpha);
}

fn infer_file_ext(file_name: &str) -> String {
    let trimmed = file_name.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let Some(dot) = trimmed.rfind('.') else {
        return String::new();
    };
    if dot + 1 >= trimmed.len() {
        return String::new();
    }
    trimmed[dot + 1..].to_ascii_lowercase()
}

fn file_symbol_color(ext: &str) -> (u8, u8, u8) {
    match ext {
        "pdf" => (160, 82, 82),
        "doc" | "docx" => (90, 106, 128),
        "md" => (142, 142, 147),
        "txt" => (209, 209, 214),
        _ => (232, 232, 236),
    }
}

fn draw_file_document_icon(canvas: &Canvas, rect: Rect, ext: &str, alpha: u8) {
    let (cr, cg, cb) = file_symbol_color(ext);
    let mut stroke = Paint::default();
    stroke.set_anti_alias(true);
    stroke.set_style(skia_safe::paint::Style::Stroke);
    stroke.set_stroke_width((rect.width() * 0.07).max(1.0));
    stroke.set_stroke_cap(skia_safe::paint::Cap::Round);
    stroke.set_stroke_join(skia_safe::paint::Join::Round);
    stroke.set_color(Color::from_argb(alpha, cr, cg, cb));

    let left = rect.left() + rect.width() * 0.22;
    let top = rect.top() + rect.height() * 0.12;
    let right = rect.right() - rect.width() * 0.16;
    let bottom = rect.bottom() - rect.height() * 0.10;
    let fold_x = rect.right() - rect.width() * 0.34;
    let fold_y = rect.top() + rect.height() * 0.34;

    let mut body = PathBuilder::default();
    body.move_to((left, top));
    body.line_to((fold_x, top));
    body.line_to((right, fold_y));
    body.line_to((right, bottom));
    body.line_to((left, bottom));
    body.close();
    canvas.draw_path(&body.detach(), &stroke);

    let mut fold = Paint::default();
    fold.set_anti_alias(true);
    fold.set_style(skia_safe::paint::Style::Stroke);
    fold.set_stroke_width((rect.width() * 0.06).max(1.0));
    fold.set_stroke_cap(skia_safe::paint::Cap::Round);
    fold.set_color(Color::from_argb(alpha, cr, cg, cb));
    canvas.draw_line((fold_x, top), (fold_x, fold_y), &fold);
    canvas.draw_line((fold_x, fold_y), (right, fold_y), &fold);

    let label = if ext.is_empty() {
        "FILE".to_string()
    } else {
        ext.chars().take(4).collect::<String>().to_ascii_uppercase()
    };
    let mut tp = Paint::default();
    tp.set_anti_alias(true);
    tp.set_color(Color::from_argb(alpha, cr, cg, cb));
    crate::ui::utils::draw_text_cached(
        canvas,
        &label,
        (rect.center_x(), rect.bottom() - rect.height() * 0.20),
        (rect.height() * 0.24).max(5.0),
        FontStyle::bold(),
        &tp,
        true,
        rect.width() * 0.9,
    );
}

// Icon helpers
fn draw_breathing_orb(
    canvas: &Canvas,
    x: f32,
    y: f32,
    r: f32,
    cr: u8,
    cg: u8,
    cb: u8,
    frame: u64,
    alpha: u8,
) {
    let phase = frame as f32 * std::f32::consts::TAU / 90.0;
    let t = (1.0 - phase.cos()) * 0.5;
    let a = (alpha as f32 * (0.3 + t * 0.7)) as u8;
    let s = 0.8 + t * 0.3;
    let mut p = Paint::default();
    p.set_anti_alias(true);
    p.set_color(Color::from_argb(a, cr, cg, cb));
    canvas.draw_circle((x, y), r * s, &p);
}

fn draw_sparkle_icon(canvas: &Canvas, cx: f32, cy: f32, size: f32, color: Color) {
    let s = size / 20.0;
    let ox = cx - 10.0 * s;
    let oy = cy - 6.5 * s;
    let mut pb = PathBuilder::default();
    pb.move_to((ox + 10.0 * s, oy));
    pb.cubic_to(
        (ox + 10.5 * s, oy + 3.5 * s),
        (ox + 13.0 * s, oy + 6.0 * s),
        (ox + 16.5 * s, oy + 6.5 * s),
    );
    pb.cubic_to(
        (ox + 13.0 * s, oy + 7.0 * s),
        (ox + 10.5 * s, oy + 9.5 * s),
        (ox + 10.0 * s, oy + 13.0 * s),
    );
    pb.cubic_to(
        (ox + 9.5 * s, oy + 9.5 * s),
        (ox + 7.0 * s, oy + 7.0 * s),
        (ox + 3.5 * s, oy + 6.5 * s),
    );
    pb.cubic_to(
        (ox + 7.0 * s, oy + 6.0 * s),
        (ox + 9.5 * s, oy + 3.5 * s),
        (ox + 10.0 * s, oy),
    );
    pb.close();
    let path = pb.detach();
    let mut p = Paint::default();
    p.set_anti_alias(true);
    p.set_color(color);
    canvas.draw_path(&path, &p);
}

fn draw_upload_icon(canvas: &Canvas, cx: f32, cy: f32, size: f32, color: Color, sw: f32) {
    let s = size / 20.0;
    let ox = cx - 10.0 * s;
    let oy = cy - 10.0 * s;
    let mut p = Paint::default();
    p.set_anti_alias(true);
    p.set_color(color);
    p.set_style(skia_safe::paint::Style::Stroke);
    p.set_stroke_width(sw);
    p.set_stroke_cap(skia_safe::paint::Cap::Round);
    canvas.draw_line(
        (ox + 10.0 * s, oy + 2.0 * s),
        (ox + 10.0 * s, oy + 14.0 * s),
        &p,
    );
    canvas.draw_line(
        (ox + 5.0 * s, oy + 7.0 * s),
        (ox + 10.0 * s, oy + 2.0 * s),
        &p,
    );
    canvas.draw_line(
        (ox + 10.0 * s, oy + 2.0 * s),
        (ox + 15.0 * s, oy + 7.0 * s),
        &p,
    );
    canvas.draw_line(
        (ox + 4.0 * s, oy + 17.0 * s),
        (ox + 16.0 * s, oy + 17.0 * s),
        &p,
    );
}

fn draw_checkmark_icon(canvas: &Canvas, cx: f32, cy: f32, size: f32, color: Color) {
    let s = size / 20.0;
    let ox = cx - 10.0 * s;
    let oy = cy - 10.0 * s;
    let mut pb = PathBuilder::default();
    pb.move_to((ox + 3.0 * s, oy + 10.0 * s));
    pb.line_to((ox + 8.0 * s, oy + 15.0 * s));
    pb.line_to((ox + 17.0 * s, oy + 4.0 * s));
    let path = pb.detach();
    let mut p = Paint::default();
    p.set_anti_alias(true);
    p.set_color(color);
    p.set_style(skia_safe::paint::Style::Stroke);
    p.set_stroke_width(2.5 * s);
    p.set_stroke_cap(skia_safe::paint::Cap::Round);
    p.set_stroke_join(skia_safe::paint::Join::Round);
    canvas.draw_path(&path, &p);
}

fn draw_download_arrow(canvas: &Canvas, cx: f32, cy: f32, size: f32, color: Color) {
    let s = size / 10.0;
    let mut p = Paint::default();
    p.set_anti_alias(true);
    p.set_color(color);
    p.set_style(skia_safe::paint::Style::Stroke);
    p.set_stroke_width(2.0 * s);
    p.set_stroke_cap(skia_safe::paint::Cap::Round);
    canvas.draw_line((cx, cy - 5.0 * s), (cx, cy + 4.0 * s), &p);
    canvas.draw_line((cx - 3.5 * s, cy + 0.5 * s), (cx, cy + 4.0 * s), &p);
    canvas.draw_line((cx, cy + 4.0 * s), (cx + 3.5 * s, cy + 0.5 * s), &p);
}

fn draw_expand_hint_icon(canvas: &Canvas, cx: f32, cy: f32, size: f32, color: Color) {
    let s = size / 10.0;
    let mut p = Paint::default();
    p.set_anti_alias(true);
    p.set_color(color);
    p.set_style(skia_safe::paint::Style::Stroke);
    p.set_stroke_width(1.7 * s);
    p.set_stroke_cap(skia_safe::paint::Cap::Round);
    p.set_stroke_join(skia_safe::paint::Join::Round);

    canvas.draw_line(
        (cx - 2.6 * s, cy + 2.6 * s),
        (cx + 2.6 * s, cy - 2.6 * s),
        &p,
    );
    canvas.draw_line(
        (cx + 0.7 * s, cy - 2.6 * s),
        (cx + 2.6 * s, cy - 2.6 * s),
        &p,
    );
    canvas.draw_line(
        (cx + 2.6 * s, cy - 2.6 * s),
        (cx + 2.6 * s, cy - 0.7 * s),
        &p,
    );
    canvas.draw_line(
        (cx - 2.6 * s, cy + 0.7 * s),
        (cx - 2.6 * s, cy + 2.6 * s),
        &p,
    );
    canvas.draw_line(
        (cx - 2.6 * s, cy + 2.6 * s),
        (cx - 0.7 * s, cy + 2.6 * s),
        &p,
    );
}

#[allow(dead_code)]
fn draw_page_handle(canvas: &Canvas, cx: f32, cy: f32, alpha: u8, scale: f32) {
    let mut paint = Paint::default();
    paint.set_anti_alias(true);
    paint.set_color(Color::from_argb((alpha as f32 * 0.4) as u8, 255, 255, 255));
    let w = 4.0 * scale;
    let h = 20.0 * scale;
    let rect = Rect::from_xywh(cx - w / 2.0, cy - h / 2.0, w, h);
    canvas.draw_round_rect(rect, 2.0 * scale, 2.0 * scale, &paint);
}

fn draw_prev_icon(canvas: &Canvas, cx: f32, cy: f32, size: f32, paint: &Paint) {
    let s = size / 12.0;
    let mut pb = PathBuilder::default();
    pb.move_to((cx + 4.0 * s, cy - 6.0 * s));
    pb.line_to((cx - 4.0 * s, cy));
    pb.line_to((cx + 4.0 * s, cy + 6.0 * s));
    pb.close();
    canvas.draw_path(&pb.detach(), paint);
    let mut lp = paint.clone();
    lp.set_style(skia_safe::paint::Style::Stroke);
    lp.set_stroke_width(2.0 * s);
    canvas.draw_line(
        (cx - 5.0 * s, cy - 6.0 * s),
        (cx - 5.0 * s, cy + 6.0 * s),
        &lp,
    );
}

fn draw_next_icon(canvas: &Canvas, cx: f32, cy: f32, size: f32, paint: &Paint) {
    let s = size / 12.0;
    let mut pb = PathBuilder::default();
    pb.move_to((cx - 4.0 * s, cy - 6.0 * s));
    pb.line_to((cx + 4.0 * s, cy));
    pb.line_to((cx - 4.0 * s, cy + 6.0 * s));
    pb.close();
    canvas.draw_path(&pb.detach(), paint);
    let mut lp = paint.clone();
    lp.set_style(skia_safe::paint::Style::Stroke);
    lp.set_stroke_width(2.0 * s);
    canvas.draw_line(
        (cx + 5.0 * s, cy - 6.0 * s),
        (cx + 5.0 * s, cy + 6.0 * s),
        &lp,
    );
}

fn draw_play_icon(canvas: &Canvas, cx: f32, cy: f32, size: f32, paint: &Paint) {
    let s = size / 12.0;
    let mut pb = PathBuilder::default();
    pb.move_to((cx - 4.0 * s, cy - 7.0 * s));
    pb.line_to((cx + 6.0 * s, cy));
    pb.line_to((cx - 4.0 * s, cy + 7.0 * s));
    pb.close();
    canvas.draw_path(&pb.detach(), paint);
}

fn draw_pause_icon(canvas: &Canvas, cx: f32, cy: f32, size: f32, paint: &Paint) {
    let s = size / 12.0;
    let w = 3.0 * s;
    canvas.draw_round_rect(
        Rect::from_xywh(cx - 5.0 * s, cy - 7.0 * s, w, 14.0 * s),
        s,
        s,
        paint,
    );
    canvas.draw_round_rect(
        Rect::from_xywh(cx + 2.0 * s, cy - 7.0 * s, w, 14.0 * s),
        s,
        s,
        paint,
    );
}

#[cfg(test)]
mod screenshot_tests {
    use super::*;
    use crate::core::smtc::MediaInfo;
    use skia_safe::EncodedImageFormat;
    use std::collections::HashMap;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::Instant;

    struct SnapshotScenario {
        ai_state: AiState,
        frame_count: u64,
        input_text: String,
        input_file_context_active: bool,
        input_file_context_name: String,
        output_text: String,
        processing_progress: f32,
        processing_label: String,
        last_tool_name: String,
        last_tool_result: String,
        file_input_text: String,
        dropped_file_count: usize,
        file_ready_image_available: bool,
        file_ready_audio_available: bool,
        file_ready_text_available: bool,
        filedrop_state: filedrop::FileDropSceneState,
        music_state: Option<music::MusicSceneState>,
        music_searching: bool,
        music_query: String,
        music_result_cover_images: HashMap<u64, Image>,
        music_queue_len: usize,
        music_current_index: Option<usize>,
        music_elapsed_ms: u64,
        music_duration_ms: u64,
        music_transition_pulse: f32,
        current_lyric: String,
        old_lyric: String,
        lyric_transition: f32,
        bubble: BubbleState,
        action_text: String,
        action_file_name: String,
        action_progress: f32,
        action_requires_download: bool,
        action_downloading: bool,
        action_thumbnail: Option<Image>,
        action_is_image: bool,
        action_is_video: bool,
        action_detail_text: String,
        action_editor_available: bool,
        focus_phase: FocusPhase,
        focus_completion_kind: FocusCompletionKind,
        focus_total_ms: u64,
        focus_remaining_ms: u64,
        focus_selected_total_ms: u64,
        focus_running: bool,
        focus_label_text: String,
        focus_rounds_completed: u32,
        audio_capture_running: bool,
        audio_capture_elapsed_ms: u64,
        screen_capture_running: bool,
        screen_capture_elapsed_ms: u64,
    }

    impl SnapshotScenario {
        fn new() -> Self {
            Self {
                ai_state: AiState::Idle,
                frame_count: 96,
                input_text: String::new(),
                input_file_context_active: false,
                input_file_context_name: String::new(),
                output_text: String::new(),
                processing_progress: 0.0,
                processing_label: String::new(),
                last_tool_name: String::new(),
                last_tool_result: String::new(),
                file_input_text: String::new(),
                dropped_file_count: 1,
                file_ready_image_available: false,
                file_ready_audio_available: false,
                file_ready_text_available: false,
                filedrop_state: filedrop::FileDropSceneState::new(),
                music_state: None,
                music_searching: false,
                music_query: String::new(),
                music_result_cover_images: HashMap::new(),
                music_queue_len: 0,
                music_current_index: None,
                music_elapsed_ms: 0,
                music_duration_ms: 0,
                music_transition_pulse: 0.0,
                current_lyric: String::new(),
                old_lyric: String::new(),
                lyric_transition: 1.0,
                bubble: BubbleState::default(),
                action_text: String::new(),
                action_file_name: "omniagent-output.bin".to_string(),
                action_progress: 0.0,
                action_requires_download: false,
                action_downloading: false,
                action_thumbnail: None,
                action_is_image: false,
                action_is_video: false,
                action_detail_text: String::new(),
                action_editor_available: false,
                focus_phase: FocusPhase::Work,
                focus_completion_kind: FocusCompletionKind::WorkFinished,
                focus_total_ms: 0,
                focus_remaining_ms: 0,
                focus_selected_total_ms: 25 * 60 * 1000,
                focus_running: false,
                focus_label_text: String::new(),
                focus_rounds_completed: 0,
                audio_capture_running: false,
                audio_capture_elapsed_ms: 0,
                screen_capture_running: false,
                screen_capture_elapsed_ms: 0,
            }
        }

        fn frame_data<'a>(&'a self, pill_state: &'a PillState) -> FrameData<'a> {
            FrameData {
                pill_state,
                content_opacity: 1.0,
                content_scale: 1.0,
                reduce_motion: false,
                state_elapsed_ms: 0,
                idle_hover_progress: 0.0,
                ai_state: &self.ai_state,
                frame_count: self.frame_count,
                input_text: &self.input_text,
                input_cursor: self.input_text.len(),
                input_preedit: "",
                input_file_context_active: self.input_file_context_active,
                input_file_context_name: &self.input_file_context_name,
                output_text: &self.output_text,
                output_scroll_offset: 0.0,
                output_at_end: true,
                tools_view_progress: 0.0,
                tool_presses: &[],
                filedrop_state: &self.filedrop_state,
                processing_progress: self.processing_progress,
                processing_label: &self.processing_label,
                last_tool_name: &self.last_tool_name,
                last_tool_result: &self.last_tool_result,
                file_input_text: &self.file_input_text,
                file_input_cursor: self.file_input_text.len(),
                dropped_file_count: self.dropped_file_count,
                file_ready_image_available: self.file_ready_image_available,
                file_ready_audio_available: self.file_ready_audio_available,
                file_ready_text_available: self.file_ready_text_available,
                music_state: self.music_state.as_ref(),
                music_searching: self.music_searching,
                music_query: &self.music_query,
                music_search_cursor: self.music_query.len(),
                music_results: &[],
                music_results_context_label: "",
                music_result_cover_images: &self.music_result_cover_images,
                music_results_scroll: 0.0,
                music_queue_len: self.music_queue_len,
                music_current_index: self.music_current_index,
                music_netease_connected: false,
                music_netease_account_name: "",
                music_auth_status: "",
                music_auth_qr_image: None,
                music_elapsed_ms: self.music_elapsed_ms,
                music_duration_ms: self.music_duration_ms,
                music_transition_pulse: self.music_transition_pulse,
                current_lyric: &self.current_lyric,
                old_lyric: &self.old_lyric,
                lyric_transition: self.lyric_transition,
                bubble: &self.bubble,
                is_pressing: false,
                action_text: &self.action_text,
                action_file_name: &self.action_file_name,
                action_progress: self.action_progress,
                action_requires_download: self.action_requires_download,
                action_downloading: self.action_downloading,
                action_thumbnail: self.action_thumbnail.as_ref(),
                action_is_image: self.action_is_image,
                action_is_video: self.action_is_video,
                action_detail_text: &self.action_detail_text,
                action_editor_available: self.action_editor_available,
                focus_phase: self.focus_phase,
                focus_completion_kind: self.focus_completion_kind,
                focus_total_ms: self.focus_total_ms,
                focus_remaining_ms: self.focus_remaining_ms,
                focus_selected_total_ms: self.focus_selected_total_ms,
                focus_running: self.focus_running,
                focus_label_text: &self.focus_label_text,
                focus_label_cursor: self.focus_label_text.len(),
                focus_rounds_completed: self.focus_rounds_completed,
                audio_capture_running: self.audio_capture_running,
                audio_capture_elapsed_ms: self.audio_capture_elapsed_ms,
                screen_capture_running: self.screen_capture_running,
                screen_capture_elapsed_ms: self.screen_capture_elapsed_ms,
                image_edit_prompt: "",
                image_edit_cursor: 0,
                image_edit_tool: ImageEditTool::RemoveObject,
                image_edit_brush_mode: ImageEditBrushMode::Paint,
                image_edit_outpaint_preset: ImageOutpaintPreset::Frame,
                image_edit_has_mask: false,
                image_edit_mask_preview: None,
                image_edit_mask_strokes: &[],
            }
        }
    }

    #[allow(deprecated)]
    fn render_snapshot(path: &Path, pill_state: PillState, scenario: &SnapshotScenario) {
        let scale = 1.0_f32;
        let image_ratio = scenario
            .action_thumbnail
            .as_ref()
            .map(|image| image.width() as f32 / image.height().max(1) as f32);
        let (w, h, r) =
            crate::core::config::pill_dimensions_with_image_ratio(&pill_state, scale, image_ratio);
        let canvas_w = (w + 48.0).ceil() as i32;
        let canvas_h = (h + 48.0).ceil() as i32;

        let mut surface =
            surfaces::raster_n32_premul((canvas_w, canvas_h)).expect("create raster surface");
        let canvas = surface.canvas();
        canvas.clear(Color::TRANSPARENT);

        let offset_x = (canvas_w as f32 - w) * 0.5;
        let offset_y = 24.0_f32;
        let rect = Rect::from_xywh(offset_x, offset_y, w, h);
        let rrect = RRect::new_rect_xy(rect, r, r);

        let mut bg = Paint::default();
        bg.set_anti_alias(true);
        bg.set_color(Color::BLACK);
        canvas.draw_rrect(rrect, &bg);

        let data = scenario.frame_data(&pill_state);
        draw_pill_content(canvas, rect, scale, &data, 255);
        draw_border(
            canvas,
            &rrect,
            &[0.0; 4],
            w,
            offset_y,
            h,
            canvas_w as u32,
            scale,
        );

        let image = surface.image_snapshot();
        let encoded = image
            .encode_to_data(EncodedImageFormat::PNG)
            .expect("encode png");
        fs::write(path, encoded.as_bytes()).expect("write snapshot");
    }

    fn music_demo_state() -> music::MusicSceneState {
        let media = MediaInfo {
            title: "Qing Tian".to_string(),
            artist: "Jay Chou".to_string(),
            album: "Ye Hui Mei".to_string(),
            is_playing: true,
            thumbnail: None,
            spectrum: [0.24, 0.62, 0.35, 0.74, 0.41, 0.58],
            position_ms: 72_000,
            last_update: Instant::now(),
            lyrics: None,
        };
        music::MusicSceneState {
            media,
            spectrum: [0.24, 0.62, 0.35, 0.74, 0.41, 0.58],
            is_playing: true,
        }
    }

    fn demo_generated_thumbnail() -> Image {
        let mut surface =
            surfaces::raster_n32_premul((256, 256)).expect("create demo image surface");
        let canvas = surface.canvas();
        canvas.clear(Color::from_rgb(27, 14, 32));

        let mut bg = Paint::default();
        bg.set_anti_alias(true);
        bg.set_color(Color::from_argb(255, 255, 76, 148));
        canvas.draw_circle((72.0, 76.0), 76.0, &bg);

        bg.set_color(Color::from_argb(255, 103, 84, 255));
        canvas.draw_circle((196.0, 188.0), 95.0, &bg);

        let mut card = Paint::default();
        card.set_anti_alias(true);
        card.set_color(Color::from_argb(180, 255, 255, 255));
        canvas.draw_round_rect(Rect::from_xywh(42.0, 140.0, 172.0, 76.0), 18.0, 18.0, &card);

        let mut star = Paint::default();
        star.set_anti_alias(true);
        star.set_style(skia_safe::paint::Style::Stroke);
        star.set_stroke_width(6.0);
        star.set_stroke_cap(skia_safe::paint::Cap::Round);
        star.set_color(Color::from_argb(235, 255, 56, 116));
        canvas.draw_line((128.0, 38.0), (128.0, 92.0), &star);
        canvas.draw_line((101.0, 65.0), (155.0, 65.0), &star);

        surface.image_snapshot()
    }

    #[test]
    #[ignore = "manual visual verification snapshots"]
    fn generate_compact_style_snapshots() {
        let out_dir: PathBuf = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("test-screenshots")
            .join("2026-03-05-fullflow-verify");
        fs::create_dir_all(&out_dir).expect("create output dir");

        let mut scenario = SnapshotScenario::new();
        render_snapshot(
            &out_dir.join("00-idle-offscreen.png"),
            PillState::Idle,
            &scenario,
        );
        render_snapshot(
            &out_dir.join("00-chat-input-placeholder-offscreen.png"),
            PillState::Input,
            &scenario,
        );

        scenario.input_text =
            "Summarize today's tasks and propose the next concrete step.".to_string();
        render_snapshot(
            &out_dir.join("01-chat-input-offscreen.png"),
            PillState::Input,
            &scenario,
        );

        scenario.processing_label = "ai.reasoning".to_string();
        scenario.processing_progress = 0.26;
        render_snapshot(
            &out_dir.join("02-chat-thinking-offscreen.png"),
            PillState::Thinking,
            &scenario,
        );

        scenario.output_text =
            "The compact island rhythm is updated across chat, files, and image flows.".to_string();
        render_snapshot(
            &out_dir.join("03-chat-output-offscreen.png"),
            PillState::Output,
            &scenario,
        );

        scenario.filedrop_state.file_ext = "pdf".to_string();
        scenario.filedrop_state.file_name = "weekly-report.pdf".to_string();
        scenario.file_input_text.clear();
        render_snapshot(
            &out_dir.join("04-file-ready-offscreen.png"),
            PillState::FileReady,
            &scenario,
        );

        scenario.processing_label = "file.process".to_string();
        scenario.processing_progress = 0.58;
        render_snapshot(
            &out_dir.join("05-file-processing-offscreen.png"),
            PillState::FileProcessing,
            &scenario,
        );

        scenario.action_text = "Processing complete".to_string();
        scenario.action_file_name = "weekly-report.docx".to_string();
        scenario.action_progress = 0.42;
        scenario.action_requires_download = true;
        scenario.action_is_image = false;
        render_snapshot(
            &out_dir.join("06-file-action-offscreen.png"),
            PillState::FileAction,
            &scenario,
        );

        scenario.music_state = Some(music_demo_state());
        scenario.current_lyric = "The clouds in the sky are drifting slowly...".to_string();
        scenario.old_lyric = "Your smile is warm like sunshine".to_string();
        scenario.lyric_transition = 0.62;
        render_snapshot(
            &out_dir.join("07-music-wave-offscreen.png"),
            PillState::MusicWave,
            &scenario,
        );
        render_snapshot(
            &out_dir.join("08-music-lyric-offscreen.png"),
            PillState::MusicLyric,
            &scenario,
        );
        render_snapshot(
            &out_dir.join("09-music-expand-offscreen.png"),
            PillState::MusicExpand,
            &scenario,
        );

        scenario.processing_label = "generate.image".to_string();
        scenario.processing_progress = 0.64;
        scenario.action_thumbnail = None;
        scenario.frame_count += 36;
        render_snapshot(
            &out_dir.join("10-ai-image-processing-offscreen.png"),
            PillState::ImageProcessing,
            &scenario,
        );

        scenario.action_text = "Image ready".to_string();
        scenario.action_progress = 0.0;
        scenario.action_requires_download = true;
        scenario.action_thumbnail = Some(demo_generated_thumbnail());
        scenario.action_is_image = true;
        scenario.frame_count += 24;
        render_snapshot(
            &out_dir.join("11-ai-image-action-offscreen.png"),
            PillState::ImageAction,
            &scenario,
        );

        scenario.action_text = "Image ready".to_string();
        scenario.action_progress = 1.0;
        scenario.action_requires_download = false;
        scenario.frame_count += 18;
        render_snapshot(
            &out_dir.join("21-ai-image-preview-expanded-offscreen.png"),
            PillState::ImagePreview,
            &scenario,
        );

        scenario.processing_label = "pdf.merge".to_string();
        scenario.processing_progress = 0.47;
        scenario.frame_count += 18;
        render_snapshot(
            &out_dir.join("12-pdf-merge-processing-offscreen.png"),
            PillState::Processing,
            &scenario,
        );

        scenario.processing_label = "video.extract_audio".to_string();
        scenario.processing_progress = 0.53;
        scenario.frame_count += 18;
        render_snapshot(
            &out_dir.join("13-video-extract-processing-offscreen.png"),
            PillState::Processing,
            &scenario,
        );

        scenario.processing_label = "convert.json_format".to_string();
        scenario.processing_progress = 0.81;
        scenario.frame_count += 18;
        render_snapshot(
            &out_dir.join("14-json-format-processing-offscreen.png"),
            PillState::Processing,
            &scenario,
        );

        scenario.processing_label = "generate.dashboard".to_string();
        scenario.processing_progress = 0.66;
        scenario.frame_count += 16;
        render_snapshot(
            &out_dir.join("15-generate-dashboard-processing-offscreen.png"),
            PillState::Processing,
            &scenario,
        );

        scenario.processing_label = "web.search".to_string();
        scenario.processing_progress = 0.41;
        scenario.frame_count += 16;
        render_snapshot(
            &out_dir.join("16-web-search-processing-offscreen.png"),
            PillState::Processing,
            &scenario,
        );

        scenario.processing_label = "hash.sha256".to_string();
        scenario.processing_progress = 0.55;
        scenario.frame_count += 16;
        render_snapshot(
            &out_dir.join("17-hash-processing-offscreen.png"),
            PillState::Processing,
            &scenario,
        );

        scenario.processing_label = "file.upload".to_string();
        scenario.processing_progress = 0.24;
        scenario.frame_count += 16;
        render_snapshot(
            &out_dir.join("18-uploading-file-processing-offscreen.png"),
            PillState::Processing,
            &scenario,
        );

        scenario.action_text = "Execution complete".to_string();
        scenario.action_progress = 1.0;
        scenario.action_requires_download = false;
        scenario.action_thumbnail = None;
        scenario.action_is_image = false;
        scenario.frame_count += 12;
        render_snapshot(
            &out_dir.join("19-generate-dashboard-action-offscreen.png"),
            PillState::Action,
            &scenario,
        );

        scenario.action_text = "Search complete".to_string();
        scenario.action_progress = 1.0;
        scenario.action_requires_download = false;
        scenario.action_is_image = false;
        scenario.frame_count += 12;
        render_snapshot(
            &out_dir.join("20-web-search-action-offscreen.png"),
            PillState::Action,
            &scenario,
        );
    }
}

