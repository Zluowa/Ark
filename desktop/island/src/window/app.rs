// @input: winit event loop, HTTP commands, SMTC/audio state
// @output: Single-process Skia pill rendering with PillState transitions
// @position: Main application handler; owns all runtime state

use crate::core::ai_client;
use crate::core::audio::AudioProcessor;
use crate::core::capture::{AudioCaptureHandle, ScreenCaptureHandle};
use crate::core::command::{Command, CommandChannel};
use crate::core::config::{
    pill_dimensions, pill_dimensions_with_image_ratio, pill_max_dimensions, transition_duration_ms,
    AppConfig, FocusCompletionKind, FocusPhase, ImageEditBrushMode, ImageEditTool, ImageMaskPoint,
    ImageMaskStroke, ImageOutpaintPreset, PillState, IMAGE_EDIT_ACTION_HEIGHT,
    IMAGE_EDIT_ACTION_TOP, IMAGE_EDIT_CANVAS_BOTTOM_GAP, IMAGE_EDIT_CANVAS_SIDE_PADDING,
    IMAGE_EDIT_CANVAS_TOP, IMAGE_EDIT_PROMPT_HEIGHT, IMAGE_EDIT_PROMPT_TOP, MOTION_FEEDBACK_MS,
    PADDING, TOP_OFFSET, WINDOW_TITLE,
};
use crate::core::lyrics::LyricLine;
use crate::core::music_client::{self, MusicSearchResult};
use crate::core::persistence::load_config;
use crate::core::player::MusicPlayer;
use crate::core::render::{draw_island, estimate_wrapped_line_count, FrameData};
use crate::core::smtc::SmtcListener;
use crate::core::tool_client;
use crate::core::types::{AiState, ToolStatus};
use crate::ui::activities::filedrop::DropPhase;
use crate::ui::activities::{filedrop, music};
use crate::ui::bubble::{BubblePhase, BubbleState};
use crate::utils::clipboard;
use crate::utils::color::get_island_border_weights;
use crate::utils::icon::get_app_icon;
use crate::utils::mouse::{get_global_cursor_pos, is_left_button_pressed, is_point_in_rect};
use crate::utils::physics::{Spring, SPRING_CONTENT, SPRING_MAIN, SPRING_RADIUS, SPRING_SPLIT};
use crate::window::tray::{TrayAction, TrayManager};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use image::{DynamicImage, ImageBuffer, ImageFormat, Luma};
use serde_json::json;
use skia_safe::{surfaces, BlendMode, Color, Data, Image, Paint, Surface as SkSurface};
use softbuffer::{Context, Surface};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::Command as ProcessCommand;
use std::sync::Arc;
use std::time::{Duration, Instant};
use winit::application::ApplicationHandler;
use winit::dpi::{PhysicalPosition, PhysicalSize};
use winit::event::{ElementState, MouseButton, MouseScrollDelta, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow};
use winit::keyboard::{Key, ModifiersState, NamedKey};
use winit::platform::windows::WindowAttributesExtWindows;
use winit::window::{Window, WindowId, WindowLevel};

const INPUT_FONT_SIZE: f32 = 15.0;
const INPUT_LINE_HEIGHT_MULTIPLIER: f32 = 1.42;
const INPUT_WIDTH: f32 = 340.0;
const INPUT_MIN_HEIGHT: f32 = 44.0;
const INPUT_CORNER_RADIUS: f32 = 22.0;
const INPUT_PADDING_X: f32 = 16.0;
const INPUT_VERTICAL_PADDING: f32 = 12.0;
const INPUT_MAX_VISIBLE_LINES: usize = 5;

const FILE_READY_FONT_SIZE: f32 = 14.0;
const FILE_READY_LINE_HEIGHT_MULTIPLIER: f32 = 1.42;
const FILE_READY_WIDTH: f32 = 340.0;
const FILE_READY_MIN_HEIGHT: f32 = 56.0;
const FILE_READY_CORNER_RADIUS: f32 = 28.0;
const FILE_READY_PADDING_X: f32 = 16.0;
const FILE_READY_TOP_PADDING: f32 = 12.0;
const FILE_READY_BOTTOM_PADDING: f32 = 12.0;
const FILE_READY_ICON_SIZE: f32 = 34.0;
const FILE_READY_ICON_GAP: f32 = 10.0;
const FILE_READY_STATUS_HEIGHT: f32 = 12.0;
const FILE_READY_MAX_VISIBLE_LINES: usize = 4;
const FILE_READY_QUICK_ACTION_WIDTH: f32 = 78.0;
const FILE_READY_QUICK_ACTION_HEIGHT: f32 = 24.0;
const FILE_READY_QUICK_ACTION_GAP: f32 = 10.0;
const FILE_READY_QUICK_ACTION_BOTTOM_INSET: f32 = 15.0;
const FILE_READY_FOOTER_HEIGHT: f32 = 28.0;

const OUTPUT_FONT_SIZE: f32 = 15.0;
const OUTPUT_LINE_HEIGHT_MULTIPLIER: f32 = 1.6;
const OUTPUT_WIDTH: f32 = 348.0;
const OUTPUT_MIN_HEIGHT: f32 = 204.0;
const OUTPUT_MAX_HEIGHT: f32 = 268.0;
const OUTPUT_CORNER_RADIUS: f32 = 38.0;
const OUTPUT_PADDING_X: f32 = 22.0;
const OUTPUT_PADDING_TOP: f32 = 40.0;
const OUTPUT_PADDING_BOTTOM: f32 = 36.0;
const OUTPUT_MAX_VISIBLE_LINES: usize = 8;

const IMAGE_EDIT_DEFAULT_BRUSH: f32 = 20.0;
const IMAGE_EDIT_PREVIEW_MASK_LONG_SIDE: i32 = 640;
const FOCUS_DEFAULT_TOTAL_MS: u64 = 25 * 60 * 1000;
const FOCUS_BREAK_TOTAL_MS: u64 = 5 * 60 * 1000;
const FOCUS_PRESET_TOTALS_MS: [u64; 3] = [25 * 60 * 1000, 50 * 60 * 1000, 90 * 60 * 1000];

#[derive(Debug, Clone)]
struct OutputViewportState {
    scroll_offset: f32,
    max_scroll: f32,
    follow_stream: bool,
}

impl Default for OutputViewportState {
    fn default() -> Self {
        Self {
            scroll_offset: 0.0,
            max_scroll: 0.0,
            follow_stream: true,
        }
    }
}

impl OutputViewportState {
    fn reset(&mut self) {
        self.scroll_offset = 0.0;
        self.max_scroll = 0.0;
        self.follow_stream = true;
    }

    fn set_max_scroll(&mut self, max_scroll: f32) -> bool {
        let clamped = max_scroll.max(0.0);
        let prev_max = self.max_scroll;
        let prev_offset = self.scroll_offset;
        self.max_scroll = clamped;
        if self.follow_stream {
            self.scroll_offset = self.max_scroll;
        } else {
            self.scroll_offset = self.scroll_offset.clamp(0.0, self.max_scroll);
        }
        (prev_max - self.max_scroll).abs() > 0.5 || (prev_offset - self.scroll_offset).abs() > 0.5
    }

    fn scroll_by(&mut self, delta: f32) -> bool {
        let next = (self.scroll_offset + delta).clamp(0.0, self.max_scroll);
        if (next - self.scroll_offset).abs() <= 0.1 {
            self.follow_stream = self.at_end();
            return false;
        }
        self.scroll_offset = next;
        self.follow_stream = self.at_end();
        true
    }

    fn scroll_to_end(&mut self) -> bool {
        let changed = (self.scroll_offset - self.max_scroll).abs() > 0.1 || !self.follow_stream;
        self.scroll_offset = self.max_scroll;
        self.follow_stream = true;
        changed
    }

    fn at_end(&self) -> bool {
        self.max_scroll <= 1.0 || (self.max_scroll - self.scroll_offset).abs() <= 2.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StackAction {
    Music,
    Files,
    Studio,
    Focus,
    AudioNotes,
    ScreenRecord,
}

const STACK_ACTION_COUNT: usize = 6;

pub struct App {
    window: Option<Arc<Window>>,
    surface: Option<Surface<Arc<Window>, Arc<Window>>>,
    tray: Option<TrayManager>,
    cmd: CommandChannel,
    smtc: SmtcListener,
    audio: AudioProcessor,
    config: AppConfig,
    visible: bool,
    // Pill state machine
    pill_state: PillState,
    content_opacity: f32,
    content_scale: f32,
    content_delay_frames: u32,
    // Spring physics
    spring_w: Spring,
    spring_h: Spring,
    spring_r: Spring,
    border_weights: [f32; 4],
    target_border_weights: [f32; 4],
    // Window geometry
    os_w: u32,
    os_h: u32,
    win_x: i32,
    win_y: i32,
    frame_count: u64,
    // AI state
    ai_state: AiState,
    snippet_text: String,
    output_text: String,
    output_viewport: OutputViewportState,
    suppress_ai_updates: bool,
    // File drop
    filedrop_state: filedrop::FileDropSceneState,
    dropped_file_path: Option<String>,
    dropped_file_paths: Vec<String>,
    pending_file_ready: bool,
    // Processing state
    processing_progress: f32,
    processing_label: String,
    // Hit testing
    cursor_hittest: bool,
    last_global_left_down: bool,
    modifiers_state: ModifiersState,
    cursor_local_pos: Option<(f32, f32)>,
    // Gesture engine (long-press detection)
    press_start: Option<Instant>,
    is_pressing: bool,
    long_press_fired: bool,
    base_pill_state: PillState,
    // Action state
    action_text: String,
    action_progress: f32,
    action_download_url: Option<String>,
    action_file_name: String,
    action_requires_download: bool,
    action_downloading: bool,
    action_thumbnail: Option<Image>,
    action_image_aspect_ratio: Option<f32>,
    action_saved_path: Option<PathBuf>,
    action_is_image: bool,
    action_is_video: bool,
    action_detail_text: String,
    action_editor_url: Option<String>,
    image_preview_returns_to_file_ready: bool,
    image_edit_tool: ImageEditTool,
    image_edit_brush_mode: ImageEditBrushMode,
    image_edit_outpaint_preset: ImageOutpaintPreset,
    image_edit_mask_strokes: Vec<ImageMaskStroke>,
    image_edit_current_stroke: Option<ImageMaskStroke>,
    image_edit_mask_preview: Option<Image>,
    image_edit_mask_surface: Option<SkSurface>,
    image_edit_mask_surface_size: Option<(i32, i32)>,
    focus_phase: FocusPhase,
    focus_completion_kind: FocusCompletionKind,
    focus_total_ms: u64,
    focus_remaining_ms: u64,
    focus_selected_total_ms: u64,
    focus_running: bool,
    focus_anchor: Option<Instant>,
    focus_label_text: String,
    focus_label_cursor: usize,
    focus_rounds_completed: u32,
    focus_last_work_total_ms: u64,
    audio_capture_running: bool,
    audio_capture_anchor: Option<Instant>,
    audio_capture_elapsed_ms: u64,
    audio_capture_handle: Option<AudioCaptureHandle>,
    audio_capture_last_path: Option<PathBuf>,
    audio_capture_source_file: Option<PathBuf>,
    screen_capture_running: bool,
    screen_capture_anchor: Option<Instant>,
    screen_capture_elapsed_ms: u64,
    screen_capture_handle: Option<ScreenCaptureHandle>,
    screen_capture_last_path: Option<PathBuf>,
    last_tool_name: String,
    last_tool_result: String,
    // Music (SMTC passive)
    last_media_title: String,
    last_media_playing: bool,
    last_playing_time: Instant,
    local_music_playing: bool,
    local_playback_base_ms: u64,
    local_playback_anchor: Option<Instant>,
    local_lyrics_title: String,
    local_lyrics_artist: String,
    local_media_lyrics: Option<Arc<Vec<LyricLine>>>,
    current_lyric_text: String,
    old_lyric_text: String,
    lyric_transition: f32,
    // Tool panel page progress
    tools_view_progress: f32,
    tool_presses: [f32; STACK_ACTION_COUNT],
    // Auto-collapse
    active_since: Option<Instant>,
    // Idle hover warmup (0..1)
    idle_hover_progress: f32,
    // Text input
    input_text: String,
    input_cursor: usize,
    input_file_context_active: bool,
    ime_preedit: String,
    // File input (FileReady state)
    file_input_text: String,
    file_input_cursor: usize,
    // Bubble
    bubble: BubbleState,
    // Music search + playback
    music_player: Option<MusicPlayer>,
    music_current_index: Option<usize>,
    music_current_song_id: Option<u64>,
    music_netease_connection_known: bool,
    music_netease_connected: bool,
    music_netease_account_name: String,
    music_auth_session_id: Option<String>,
    music_auth_status: String,
    music_auth_qr_image: Option<Image>,
    music_auth_last_poll_at: Option<Instant>,
    music_playlist: Vec<MusicSearchResult>,
    music_results: Vec<MusicSearchResult>,
    music_results_context_label: String,
    music_search_query: String,
    music_search_cursor: usize,
    music_searching: bool,
    music_results_scroll: f32,
    music_cover_bytes: Option<Arc<Vec<u8>>>,
    music_result_cover_bytes: HashMap<u64, Arc<Vec<u8>>>,
    music_result_cover_images: HashMap<u64, Image>,
    music_cover_requests_inflight: HashSet<u64>,
    music_transition_pulse: f32,
}

impl Default for App {
    fn default() -> Self {
        let config = load_config();
        let (iw, ih, ir) = pill_dimensions(&PillState::Idle, config.global_scale);
        Self {
            window: None,
            surface: None,
            tray: None,
            cmd: CommandChannel::new(),
            config: config.clone(),
            visible: true,
            pill_state: PillState::Idle,
            content_opacity: 1.0,
            content_scale: 1.0,
            content_delay_frames: 0,
            spring_w: Spring::new(iw),
            spring_h: Spring::new(ih),
            spring_r: Spring::new(ir),
            border_weights: [0.0; 4],
            target_border_weights: [0.0; 4],
            smtc: SmtcListener::new(),
            audio: AudioProcessor::new(),
            os_w: 0,
            os_h: 0,
            win_x: 0,
            win_y: 0,
            frame_count: 0,
            ai_state: AiState::Idle,
            snippet_text: String::new(),
            output_text: String::new(),
            output_viewport: OutputViewportState::default(),
            suppress_ai_updates: false,
            filedrop_state: filedrop::FileDropSceneState::new(),
            dropped_file_path: None,
            dropped_file_paths: Vec::new(),
            pending_file_ready: false,
            processing_progress: 0.0,
            processing_label: String::new(),
            cursor_hittest: true,
            last_global_left_down: false,
            modifiers_state: ModifiersState::empty(),
            cursor_local_pos: None,
            press_start: None,
            is_pressing: false,
            long_press_fired: false,
            base_pill_state: PillState::Idle,
            action_text: String::new(),
            action_progress: 0.0,
            action_download_url: None,
            action_file_name: "omniagent-output.bin".to_string(),
            action_requires_download: false,
            action_downloading: false,
            action_thumbnail: None,
            action_image_aspect_ratio: None,
            action_saved_path: None,
            action_is_image: false,
            action_is_video: false,
            action_detail_text: String::new(),
            action_editor_url: None,
            image_preview_returns_to_file_ready: false,
            image_edit_tool: ImageEditTool::RemoveObject,
            image_edit_brush_mode: ImageEditBrushMode::Paint,
            image_edit_outpaint_preset: ImageOutpaintPreset::Wide,
            image_edit_mask_strokes: Vec::new(),
            image_edit_current_stroke: None,
            image_edit_mask_preview: None,
            image_edit_mask_surface: None,
            image_edit_mask_surface_size: None,
            focus_phase: FocusPhase::Work,
            focus_completion_kind: FocusCompletionKind::WorkFinished,
            focus_total_ms: 0,
            focus_remaining_ms: 0,
            focus_selected_total_ms: FOCUS_DEFAULT_TOTAL_MS,
            focus_running: false,
            focus_anchor: None,
            focus_label_text: String::new(),
            focus_label_cursor: 0,
            focus_rounds_completed: 0,
            focus_last_work_total_ms: FOCUS_DEFAULT_TOTAL_MS,
            audio_capture_running: false,
            audio_capture_anchor: None,
            audio_capture_elapsed_ms: 0,
            audio_capture_handle: None,
            audio_capture_last_path: None,
            audio_capture_source_file: None,
            screen_capture_running: false,
            screen_capture_anchor: None,
            screen_capture_elapsed_ms: 0,
            screen_capture_handle: None,
            screen_capture_last_path: None,
            last_tool_name: String::new(),
            last_tool_result: String::new(),
            last_media_title: String::new(),
            last_media_playing: false,
            last_playing_time: Instant::now(),
            local_music_playing: false,
            local_playback_base_ms: 0,
            local_playback_anchor: None,
            local_lyrics_title: String::new(),
            local_lyrics_artist: String::new(),
            local_media_lyrics: None,
            current_lyric_text: String::new(),
            old_lyric_text: String::new(),
            lyric_transition: 1.0,
            tools_view_progress: 0.0,
            tool_presses: [0.0; STACK_ACTION_COUNT],
            active_since: None,
            idle_hover_progress: 0.0,
            input_text: String::new(),
            input_cursor: 0,
            input_file_context_active: false,
            ime_preedit: String::new(),
            file_input_text: String::new(),
            file_input_cursor: 0,
            bubble: BubbleState::default(),
            music_player: MusicPlayer::new().ok(),
            music_current_index: None,
            music_current_song_id: None,
            music_netease_connection_known: false,
            music_netease_connected: false,
            music_netease_account_name: String::new(),
            music_auth_session_id: None,
            music_auth_status: String::new(),
            music_auth_qr_image: None,
            music_auth_last_poll_at: None,
            music_playlist: Vec::new(),
            music_results: Vec::new(),
            music_results_context_label: String::new(),
            music_search_query: String::new(),
            music_search_cursor: 0,
            music_searching: false,
            music_results_scroll: 0.0,
            music_cover_bytes: None,
            music_result_cover_bytes: HashMap::new(),
            music_result_cover_images: HashMap::new(),
            music_cover_requests_inflight: HashSet::new(),
            music_transition_pulse: 0.0,
        }
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        event_loop.set_control_flow(ControlFlow::Poll);
        if self.window.is_some() {
            return;
        }
        let (max_w, max_h) = pill_max_dimensions(self.config.global_scale);
        self.os_w = (max_w + PADDING) as u32;
        self.os_h = (max_h + PADDING) as u32;
        let attrs = Window::default_attributes()
            .with_title(WINDOW_TITLE)
            .with_inner_size(PhysicalSize::new(self.os_w, self.os_h))
            .with_transparent(true)
            .with_decorations(false)
            .with_window_level(WindowLevel::AlwaysOnTop)
            .with_skip_taskbar(true)
            .with_window_icon(get_app_icon());
        let window = Arc::new(event_loop.create_window(attrs).unwrap());
        if let Some(monitor) = window.current_monitor() {
            let mon_size = monitor.size();
            let mon_pos = monitor.position();
            let center_x = mon_pos.x + (mon_size.width as i32) / 2;
            self.win_x = center_x - (self.os_w as i32) / 2;
            self.win_y = mon_pos.y + TOP_OFFSET - (PADDING / 2.0) as i32;
            window.set_outer_position(PhysicalPosition::new(self.win_x, self.win_y));
        }
        let context = Context::new(window.clone()).unwrap();
        let mut surface = Surface::new(&context, window.clone()).unwrap();
        surface
            .resize(
                std::num::NonZeroU32::new(self.os_w).unwrap(),
                std::num::NonZeroU32::new(self.os_h).unwrap(),
            )
            .unwrap();
        self.surface = Some(surface);
        self.tray = Some(TrayManager::new());
        window.set_ime_allowed(true);
        window.request_redraw();
        self.window = Some(window);
    }

    fn window_event(&mut self, _event_loop: &ActiveEventLoop, id: WindowId, event: WindowEvent) {
        let Some(win) = self.window.clone() else {
            return;
        };
        if win.id() != id {
            return;
        }
        match event {
            WindowEvent::CloseRequested => (),
            WindowEvent::MouseInput {
                state: ElementState::Pressed,
                button: MouseButton::Left,
                ..
            } => {
                if self.pill_state == PillState::ImageEdit {
                    self.handle_image_edit_press_start(win.clone());
                } else {
                    self.handle_press_start(win.clone());
                }
            }
            WindowEvent::MouseInput {
                state: ElementState::Pressed,
                button: MouseButton::Right,
                ..
            } => {
                self.handle_right_click(win.clone());
            }
            WindowEvent::MouseInput {
                state: ElementState::Released,
                button: MouseButton::Left,
                ..
            } => {
                if self.pill_state == PillState::ImageEdit {
                    self.handle_image_edit_press_end(win.clone());
                } else {
                    self.handle_press_end(win.clone());
                }
            }
            WindowEvent::MouseWheel { delta, .. } => {
                if self.handle_mouse_wheel(delta) {
                    win.request_redraw();
                }
            }
            WindowEvent::CursorMoved { position, .. } => {
                self.cursor_local_pos = Some((position.x as f32, position.y as f32));
                if self.pill_state == PillState::ImageEdit
                    && self.handle_image_edit_cursor_move(position.x as f32, position.y as f32)
                {
                    win.request_redraw();
                }
            }
            WindowEvent::CursorLeft { .. } => {
                self.cursor_local_pos = None;
            }
            WindowEvent::DroppedFile(path) => {
                let p = path.to_string_lossy().to_string();
                eprintln!("[island] file dropped: {}", p);
                self.filedrop_state.set_dropped_file(&p);
                self.dropped_file_path = Some(p);
                if let Some(path_str) = self.dropped_file_path.clone() {
                    if !self
                        .dropped_file_paths
                        .iter()
                        .any(|existing| existing == &path_str)
                    {
                        self.dropped_file_paths.push(path_str);
                    }
                }
                self.file_input_text.clear();
                self.file_input_cursor = 0;
                self.filedrop_state
                    .transition_to(DropPhase::Absorbing, self.frame_count);
                self.pending_file_ready = true;
                if self.pill_state != PillState::DragHover {
                    self.transition_to(PillState::DragHover);
                }
                win.request_redraw();
            }
            WindowEvent::HoveredFile(_) => {
                self.transition_to(PillState::DragHover);
                self.filedrop_state
                    .transition_to(DropPhase::Hovering, self.frame_count);
                win.request_redraw();
            }
            WindowEvent::HoveredFileCancelled => {
                if self.pending_file_ready {
                    return;
                }
                self.dropped_file_paths.clear();
                self.transition_to(PillState::Idle);
                self.filedrop_state
                    .transition_to(DropPhase::Idle, self.frame_count);
                win.request_redraw();
            }
            WindowEvent::RedrawRequested => {
                self.do_draw();
            }
            WindowEvent::ModifiersChanged(modifiers) => {
                self.modifiers_state = modifiers.state();
            }
            WindowEvent::KeyboardInput { event, .. } => {
                self.update_modifiers_from_key(&event.logical_key, event.state);
                if event.state == ElementState::Pressed {
                    let mut handled = false;
                    if !event.repeat && self.handle_shortcut(&event.logical_key) {
                        handled = true;
                    } else if self.accepts_keyboard() {
                        self.handle_key(&event.logical_key, event.text.as_deref());
                        handled = true;
                    }
                    if handled {
                        win.request_redraw();
                    }
                }
            }
            WindowEvent::Ime(winit::event::Ime::Commit(text)) => match self.pill_state {
                PillState::Input => {
                    self.input_text.insert_str(self.input_cursor, &text);
                    self.input_cursor += text.len();
                    self.ime_preedit.clear();
                    self.reset_auto_collapse();
                    win.request_redraw();
                }
                PillState::FileReady => {
                    self.file_input_text
                        .insert_str(self.file_input_cursor, &text);
                    self.file_input_cursor += text.len();
                    self.reset_auto_collapse();
                    win.request_redraw();
                }
                PillState::MusicSearch => {
                    self.music_search_query
                        .insert_str(self.music_search_cursor, &text);
                    self.music_search_cursor += text.len();
                    self.reset_auto_collapse();
                    win.request_redraw();
                }
                PillState::ImageEdit => {
                    self.file_input_text
                        .insert_str(self.file_input_cursor, &text);
                    self.file_input_cursor += text.len();
                    self.refresh_image_edit_intent();
                    self.reset_auto_collapse();
                    win.request_redraw();
                }
                PillState::FocusSetup => {
                    self.focus_label_text
                        .insert_str(self.focus_label_cursor, &text);
                    self.focus_label_cursor += text.len();
                    self.reset_auto_collapse();
                    win.request_redraw();
                }
                _ => {}
            },
            WindowEvent::Ime(winit::event::Ime::Preedit(text, _)) => {
                if self.pill_state == PillState::Input {
                    self.ime_preedit = text;
                    win.request_redraw();
                }
            }
            WindowEvent::Ime(_) => {}
            _ => (),
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        let Some(window) = self.window.clone() else {
            return;
        };
        let frame_start = Instant::now();
        self.poll_tray(&window, event_loop);
        self.poll_commands(&window, event_loop);
        if !self.visible {
            std::thread::sleep(Duration::from_millis(16));
            return;
        }
        self.check_long_press(&window);
        self.tick_global_outside_collapse(&window);
        self.update_idle_hover(&window);
        self.tick_focus_timer(&window);
        self.tick_action();
        self.tick_music_auth(&window);
        self.tick_image_edit_brush(&window);
        self.update_output_viewport_metrics();
        self.tick_tools_panel(&window);
        self.check_auto_collapse(&window);
        self.update_cursor_hittest(&window);
        self.update_border_weights(&window);
        self.update_media_state(&window);
        self.update_lyric_transition(&window);
        self.tick_music_transition(&window);
        self.update_springs();
        self.update_content_transition();
        self.frame_count += 1;
        self.filedrop_state.tick(self.frame_count);
        if self.pending_file_ready && self.filedrop_state.phase == DropPhase::Processing {
            self.pending_file_ready = false;
            self.filedrop_state
                .transition_to(DropPhase::Idle, self.frame_count);
            self.transition_to(PillState::FileReady);
            window.request_redraw();
        }
        self.bubble.tick(self.frame_count);
        let needs_redraw = self.pill_state != PillState::Idle
            || self.is_pressing
            || matches!(
                self.pill_state,
                PillState::FocusSetup
                    | PillState::FocusRun
                    | PillState::AudioRun
                    | PillState::AudioExpand
                    | PillState::ScreenRun
                    | PillState::ScreenExpand
                    | PillState::MusicAuth
                    | PillState::FocusExpand
                    | PillState::FocusComplete
                    | PillState::MusicSearch
                    | PillState::MusicResults
                    | PillState::MusicWave
                    | PillState::MusicLyric
                    | PillState::MusicExpand
                    | PillState::ToolPanel
                    | PillState::FileProcessing
                    | PillState::Processing
                    | PillState::ImageProcessing
                    | PillState::Action
                    | PillState::FileAction
                    | PillState::VideoAction
                    | PillState::ImageAction
                    | PillState::ImagePreview
                    | PillState::ImageEdit
            )
            || matches!(self.ai_state, AiState::Thinking | AiState::Streaming)
            || self.filedrop_state.phase != DropPhase::Idle
            || self.bubble.phase != BubblePhase::Hidden
            || self.tools_view_progress > 0.001
            || self.tool_presses.iter().any(|v| *v > 0.01)
            || self.focus_is_live()
            || self.spring_w.velocity.abs() > 0.01
            || self.spring_h.velocity.abs() > 0.01
            || self.content_opacity < 0.99
            || self.idle_hover_progress > 0.01;
        if needs_redraw {
            window.request_redraw();
        }
        let elapsed = frame_start.elapsed();
        let target = Duration::from_micros(16666);
        if elapsed < target {
            std::thread::sleep(target - elapsed);
        }
    }
}

impl App {
    fn transition_to(&mut self, new_state: PillState) {
        if self.pill_state == new_state {
            return;
        }
        let from_state = self.pill_state.clone();
        if new_state != PillState::Input {
            self.input_file_context_active = false;
        }
        if new_state != PillState::Output {
            self.output_viewport.reset();
        }
        if matches!(
            new_state,
            PillState::Input
                | PillState::Thinking
                | PillState::FileProcessing
                | PillState::Processing
                | PillState::ImageProcessing
        ) {
            self.suppress_ai_updates = false;
        }
        // Dampen momentum for smoother direction change
        self.spring_w.velocity *= 0.2;
        self.spring_h.velocity *= 0.2;
        self.spring_r.velocity *= 0.2;
        let dur_ms = transition_duration_ms(&from_state, &new_state);
        self.pill_state = new_state;
        if self.pill_state != PillState::ToolPanel {
            self.tools_view_progress = 0.0;
            self.tool_presses.fill(0.0);
        }
        if self.config.motion_blur {
            self.content_opacity = 0.0;
            self.content_scale = 0.95;
            let delay_ms = (dur_ms as f32 * 0.35).round() as u64;
            self.content_delay_frames = ((delay_ms as f32 / 1000.0) * 60.0).round() as u32;
        } else {
            // Reduce-motion fallback: no position/scale choreography, keep opacity-only transition.
            self.content_opacity = if dur_ms <= MOTION_FEEDBACK_MS {
                1.0
            } else {
                0.2
            };
            self.content_scale = 1.0;
            self.content_delay_frames = 0;
        }
        self.active_since = Some(Instant::now());
    }

    fn accepts_keyboard(&self) -> bool {
        matches!(
            self.pill_state,
            PillState::FocusSetup
                | PillState::FocusExpand
                | PillState::Input
                | PillState::Output
                | PillState::FileReady
                | PillState::ImageEdit
                | PillState::MusicSearch
                | PillState::MusicExpand
        )
    }

    fn is_ai_busy(&self) -> bool {
        matches!(self.ai_state, AiState::Thinking | AiState::Streaming)
    }

    fn is_tool_busy(&self) -> bool {
        self.music_searching
            || matches!(
                self.pill_state,
                PillState::FileProcessing | PillState::Processing | PillState::ImageProcessing
            )
            || self.action_downloading
            || self.action_requires_download
    }

    fn is_realtime_locked(&self) -> bool {
        self.is_ai_busy() || self.is_tool_busy()
    }

    fn is_cursor_inside_pill(&self) -> bool {
        let (px, py) = get_global_cursor_pos();
        let rel_x = (px - self.win_x) as f64;
        let rel_y = (py - self.win_y) as f64;
        let offset_x = (self.os_w as f64 - self.spring_w.value as f64) / 2.0;
        let pill_y = PADDING as f64 / 2.0;
        is_point_in_rect(
            rel_x,
            rel_y,
            offset_x,
            pill_y,
            self.spring_w.value as f64,
            self.spring_h.value as f64,
        )
    }

    fn is_cursor_on_input_tools_trigger(&self) -> bool {
        if self.pill_state != PillState::Input {
            return false;
        }
        let (px, py) = get_global_cursor_pos();
        let rel_x = (px - self.win_x) as f64;
        let rel_y = (py - self.win_y) as f64;
        let left = (self.os_w as f64 - self.spring_w.value as f64) / 2.0;
        let top = PADDING as f64 / 2.0;
        let width = self.spring_w.value as f64;
        let height = self.spring_h.value as f64;
        if !is_point_in_rect(rel_x, rel_y, left, top, width, height) {
            return false;
        }
        let trigger_w = 56.0 * self.config.global_scale as f64;
        rel_x >= left + width - trigger_w
    }

    fn handle_press_start(&mut self, win: Arc<Window>) {
        let inside = self.is_cursor_inside_pill();
        // Outside click should collapse active surfaces.
        if !inside {
            if self.is_realtime_locked() {
                return;
            }
            match self.pill_state {
                PillState::Input => {
                    self.input_text.clear();
                    self.input_cursor = 0;
                    self.ime_preedit.clear();
                    self.restore_base();
                    win.request_redraw();
                }
                PillState::FileReady => {
                    self.file_input_text.clear();
                    self.file_input_cursor = 0;
                    self.dropped_file_path = None;
                    self.pending_file_ready = false;
                    self.image_preview_returns_to_file_ready = false;
                    self.filedrop_state
                        .transition_to(DropPhase::Idle, self.frame_count);
                    self.restore_base();
                    win.request_redraw();
                }
                PillState::ImageEdit => {
                    self.clear_image_edit_session(false);
                    self.transition_to(PillState::ImagePreview);
                    win.request_redraw();
                }
                PillState::FocusSetup
                | PillState::FocusExpand
                | PillState::AudioExpand
                | PillState::ScreenExpand => {
                    self.restore_base();
                    win.request_redraw();
                }
                PillState::FocusComplete => {
                    self.clear_focus_session(false);
                    self.restore_base();
                    win.request_redraw();
                }
                PillState::Output
                | PillState::Thinking
                | PillState::MusicSearch
                | PillState::MusicResults
                | PillState::MusicExpand
                | PillState::ToolPanel
                | PillState::Action
                | PillState::FileAction
                | PillState::VideoAction
                | PillState::ImageAction
                | PillState::ImagePreview
                | PillState::FileProcessing
                | PillState::Processing
                | PillState::ImageProcessing => {
                    self.restore_base();
                    win.request_redraw();
                }
                _ => {}
            }
            return;
        }

        // Input: allow right trigger zone to open tools panel, otherwise keep typing flow.
        if self.pill_state == PillState::Input {
            if self.is_cursor_on_input_tools_trigger() {
                self.tools_view_progress = 0.0;
                self.transition_to(PillState::ToolPanel);
                win.request_redraw();
            }
            return;
        }

        if self.pill_state == PillState::FileReady {
            if self.is_cursor_on_file_ready_quick_action() {
                if self.current_file_ready_audio_path().is_some() {
                    self.start_file_ready_audio_transcription();
                } else {
                    self.start_file_ready_text_follow_up();
                }
                self.reset_auto_collapse();
                win.request_redraw();
            } else if self.is_cursor_on_file_ready_artifact() && self.open_file_ready_artifact() {
                self.reset_auto_collapse();
                win.request_redraw();
            }
            return;
        }

        if self.pill_state == PillState::MusicSearch {
            return;
        }

        self.press_start = Some(Instant::now());
        self.is_pressing = true;
        self.long_press_fired = false;
        win.request_redraw();
    }

    fn handle_press_end(&mut self, win: Arc<Window>) {
        if !self.is_pressing {
            return;
        }
        self.is_pressing = false;
        self.press_start = None;
        if !self.long_press_fired {
            self.handle_tap(&win);
        }
        win.request_redraw();
    }

    fn check_long_press(&mut self, window: &Arc<Window>) {
        if !self.is_pressing || self.long_press_fired {
            return;
        }
        if let Some(start) = self.press_start {
            if start.elapsed() >= Duration::from_millis(500) {
                if !matches!(
                    self.pill_state,
                    PillState::Idle | PillState::MusicWave | PillState::MusicLyric
                ) {
                    return;
                }
                self.long_press_fired = true;
                self.is_pressing = false;
                self.press_start = None;
                self.transition_to(PillState::Input);
                window.set_ime_allowed(true);
                window.request_redraw();
            }
        }
    }

    fn handle_tap(&mut self, _win: &Arc<Window>) {
        match self.pill_state {
            PillState::Idle => {
                self.transition_to(PillState::Input);
            }
            PillState::FocusRun => {
                self.transition_to(PillState::FocusExpand);
            }
            PillState::AudioRun => {
                self.transition_to(PillState::AudioExpand);
            }
            PillState::ScreenRun => {
                self.transition_to(PillState::ScreenExpand);
            }
            PillState::FocusSetup => {
                if !self.handle_focus_setup_tap() {
                    self.restore_base();
                }
            }
            PillState::AudioExpand => {
                if !self.handle_audio_expand_tap() {
                    self.restore_base();
                }
            }
            PillState::ScreenExpand => {
                if !self.handle_screen_expand_tap() {
                    self.restore_base();
                }
            }
            PillState::FocusExpand => {
                if !self.handle_focus_expand_tap() {
                    self.restore_base();
                }
            }
            PillState::FocusComplete => {
                if !self.handle_focus_complete_tap() {
                    self.clear_focus_session(false);
                    self.restore_base();
                }
            }
            PillState::MusicWave | PillState::MusicLyric => {
                self.transition_to(PillState::MusicExpand);
            }
            PillState::MusicAuth => {
                self.handle_music_auth_tap();
            }
            PillState::MusicSearch => {}
            PillState::MusicResults => {
                if !self.handle_music_results_tap() {
                    self.restore_base();
                }
            }
            PillState::MusicExpand => {
                if !self.handle_music_expand_tap() {
                    self.restore_base();
                }
            }
            PillState::ToolPanel => {
                if self.handle_tool_panel_back_tap() {
                    self.transition_to(PillState::Input);
                } else if self.handle_tool_panel_primary_tap() {
                    self.reset_auto_collapse();
                } else if self.handle_tools_panel_tap() {
                    self.reset_auto_collapse();
                } else {
                    self.transition_to(PillState::Input);
                }
            }
            PillState::Output => {
                if self.is_cursor_on_output_energy_pill() && self.output_viewport.at_end() {
                    self.transition_to(PillState::Input);
                } else {
                    self.output_viewport.scroll_to_end();
                }
            }
            PillState::Action | PillState::FileAction => {
                if self.action_is_image && self.is_cursor_on_action_thumbnail() {
                    self.transition_to(PillState::ImagePreview);
                } else if self.action_requires_download
                    && self.is_cursor_on_action_download_button()
                {
                    self.begin_download_action();
                } else if self.action_downloading || self.action_requires_download {
                    // Keep action surface stable while user can still download/save.
                } else if self.action_is_image {
                    self.transition_to(PillState::ImagePreview);
                } else {
                    self.restore_base();
                }
            }
            PillState::VideoAction => {
                if self.action_requires_download && self.is_cursor_on_action_download_button() {
                    self.begin_download_action();
                } else if self.action_downloading || self.action_requires_download {
                    // Keep the video delivery surface stable while save remains available.
                } else {
                    // Keep the saved state visible until the user dismisses it explicitly.
                }
            }
            PillState::ImageAction => {
                if self.action_is_image && self.is_cursor_on_action_thumbnail() {
                    self.transition_to(PillState::ImagePreview);
                } else if self.action_requires_download
                    && self.is_cursor_on_action_download_button()
                {
                    self.begin_download_action();
                } else if self.action_downloading || self.action_requires_download {
                    // Keep image action surface stable while downloading is still possible.
                } else if self.action_is_image {
                    self.transition_to(PillState::ImagePreview);
                } else {
                    self.restore_base();
                }
            }
            PillState::ImagePreview => {
                if self.action_requires_download && self.is_cursor_on_preview_download_button() {
                    self.begin_download_action();
                } else if self.is_cursor_on_preview_edit_button() {
                    self.begin_image_edit();
                } else if !self.action_downloading && self.is_cursor_on_preview_shrink_affordance()
                {
                    self.transition_to(self.image_preview_back_state());
                } else {
                    // Keep expanded preview stable unless user explicitly taps shrink affordance.
                }
            }
            _ => {}
        }
    }

    fn begin_image_edit(&mut self) {
        if !self.action_is_image {
            return;
        }
        self.clear_image_edit_session(true);
        self.transition_to(PillState::ImageEdit);
    }

    fn open_image_preview(&mut self) -> bool {
        match self.pill_state {
            PillState::FileReady => self.open_dropped_image_preview(),
            PillState::ImageAction | PillState::Action | PillState::FileAction => {
                if !self.action_is_image {
                    return false;
                }
                self.transition_to(PillState::ImagePreview);
                true
            }
            PillState::ImagePreview => true,
            _ => false,
        }
    }

    fn open_dropped_image_preview(&mut self) -> bool {
        let Some(path) = self.current_file_ready_image_path() else {
            return false;
        };

        let file_name = Path::new(&path)
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("image")
            .to_string();
        self.action_text = "Original image".to_string();
        self.action_progress = 1.0;
        self.action_download_url = Some(path.clone());
        self.action_file_name = file_name;
        self.action_requires_download = false;
        self.action_downloading = false;
        self.action_saved_path = Some(PathBuf::from(path.clone()));
        self.action_is_image = true;
        self.action_is_video = false;
        self.action_detail_text =
            "Type directly to remove background, clean watermark, or enhance. Tap Edit to brush only if needed."
                .to_string();
        self.action_editor_url = None;
        self.image_preview_returns_to_file_ready = true;

        if let Ok(bytes) = fs::read(&path) {
            self.action_thumbnail = Image::from_encoded(Data::new_copy(&bytes))
                .or_else(|| self.filedrop_state.thumbnail.clone());
        } else {
            self.action_thumbnail = self.filedrop_state.thumbnail.clone();
        }
        self.action_image_aspect_ratio = self
            .action_thumbnail
            .as_ref()
            .and_then(|image| image_aspect_ratio(image.width(), image.height()));

        self.transition_to(PillState::ImagePreview);
        true
    }

    fn image_preview_back_state(&self) -> PillState {
        if self.image_preview_returns_to_file_ready {
            PillState::FileReady
        } else if self.action_is_image {
            PillState::ImageAction
        } else {
            PillState::Action
        }
    }

    fn current_file_ready_image_path(&self) -> Option<String> {
        if self.dropped_file_paths.len() > 1 {
            return None;
        }
        let path = self
            .dropped_file_path
            .clone()
            .or_else(|| self.dropped_file_paths.first().cloned())?;
        if !is_image_file_name(&path) {
            return None;
        }
        Some(path)
    }

    fn current_file_ready_path(&self) -> Option<String> {
        if self.dropped_file_paths.len() > 1 {
            return None;
        }
        self.dropped_file_path
            .clone()
            .or_else(|| self.dropped_file_paths.first().cloned())
    }

    fn current_file_ready_audio_path(&self) -> Option<String> {
        if self.dropped_file_paths.len() > 1 {
            return None;
        }
        let path = self
            .dropped_file_path
            .clone()
            .or_else(|| self.dropped_file_paths.first().cloned())?;
        if !is_audio_file_name(&path) {
            return None;
        }
        Some(path)
    }

    fn current_file_ready_text_path(&self) -> Option<String> {
        if self.dropped_file_paths.len() > 1 {
            return None;
        }
        let path = self
            .dropped_file_path
            .clone()
            .or_else(|| self.dropped_file_paths.first().cloned())?;
        if !is_text_file_name(&path) {
            return None;
        }
        Some(path)
    }

    fn active_input_file_context_name(&self) -> String {
        let path = self
            .current_file_ready_text_path()
            .or_else(|| self.current_file_ready_audio_path())
            .or_else(|| self.current_file_ready_path());
        path.and_then(|value| {
            Path::new(&value)
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.to_string())
        })
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "Attached file".to_string())
    }

    fn start_file_ready_audio_transcription(&mut self) -> bool {
        if self.pill_state != PillState::FileReady || self.current_file_ready_audio_path().is_none()
        {
            return false;
        }
        self.file_input_text = "transcribe to text file".to_string();
        self.file_input_cursor = self.file_input_text.len();
        self.submit_file_ready();
        true
    }

    fn start_file_ready_text_follow_up(&mut self) -> bool {
        if self.pill_state != PillState::FileReady {
            return false;
        }
        self.enter_input_with_file_context()
    }

    fn enter_input_with_file_context(&mut self) -> bool {
        if self.current_file_ready_text_path().is_none() {
            return false;
        }
        self.input_text.clear();
        self.input_cursor = 0;
        self.input_file_context_active = true;
        self.transition_to(PillState::Input);
        self.bubble = BubbleState::complete(
            "Transcript attached. Type what to do next.".to_string(),
            self.frame_count,
        );
        true
    }

    fn open_file_ready_artifact(&mut self) -> bool {
        let Some(path) = self.current_file_ready_path() else {
            return false;
        };
        if self.current_file_ready_image_path().is_some() {
            return self.open_dropped_image_preview();
        }
        match open_external_target(&path) {
            Ok(()) => {
                let label = if self.current_file_ready_audio_path().is_some() {
                    "Opened audio file"
                } else if self.current_file_ready_text_path().is_some() {
                    "Opened text file"
                } else {
                    "Opened file"
                };
                self.bubble = BubbleState::complete(label.to_string(), self.frame_count);
            }
            Err(err) => {
                self.bubble = BubbleState::error(err);
            }
        }
        true
    }

    fn clear_image_edit_session(&mut self, clear_prompt: bool) {
        self.image_edit_tool = ImageEditTool::RemoveObject;
        self.image_edit_brush_mode = ImageEditBrushMode::Paint;
        self.image_edit_outpaint_preset = ImageOutpaintPreset::Wide;
        self.image_edit_mask_strokes.clear();
        self.image_edit_current_stroke = None;
        self.clear_image_edit_mask_preview();
        if clear_prompt {
            self.file_input_text.clear();
            self.file_input_cursor = 0;
        }
        self.refresh_image_edit_intent();
    }

    fn focus_is_live(&self) -> bool {
        self.focus_total_ms > 0
            || self.pill_state == PillState::FocusComplete
            || matches!(self.base_pill_state, PillState::FocusRun)
    }

    fn audio_capture_is_live(&self) -> bool {
        self.audio_capture_running
            || matches!(
                self.pill_state,
                PillState::AudioRun | PillState::AudioExpand
            )
    }

    fn screen_capture_is_live(&self) -> bool {
        self.screen_capture_running
            || matches!(
                self.pill_state,
                PillState::ScreenRun | PillState::ScreenExpand
            )
    }

    fn current_audio_capture_elapsed_ms(&self) -> u64 {
        self.audio_capture_elapsed_ms
            + self
                .audio_capture_anchor
                .map(|anchor| anchor.elapsed().as_millis() as u64)
                .unwrap_or(0)
    }

    fn current_screen_capture_elapsed_ms(&self) -> u64 {
        self.screen_capture_elapsed_ms
            + self
                .screen_capture_anchor
                .map(|anchor| anchor.elapsed().as_millis() as u64)
                .unwrap_or(0)
    }

    fn open_audio_notes_surface(&mut self) {
        if self.audio_capture_running {
            self.transition_to(PillState::AudioExpand);
            return;
        }
        self.start_audio_capture();
    }

    fn open_screen_record_surface(&mut self) {
        if self.screen_capture_running {
            self.transition_to(PillState::ScreenExpand);
            return;
        }
        self.start_screen_capture();
    }

    fn start_audio_capture(&mut self) {
        if self.audio_capture_running {
            self.transition_to(PillState::AudioExpand);
            return;
        }
        if self.screen_capture_running {
            self.transition_to(PillState::ScreenExpand);
            self.bubble = BubbleState::error("Stop screen recording first".to_string());
            return;
        }
        let capture_result = if let Some(source_file) = self.audio_capture_source_file.as_deref() {
            AudioCaptureHandle::start_with_source(&self.config.download_dir, Some(source_file))
        } else {
            AudioCaptureHandle::start(&self.config.download_dir)
        };
        match capture_result {
            Ok(handle) => {
                self.audio_capture_handle = Some(handle);
                self.audio_capture_running = true;
                self.audio_capture_anchor = Some(Instant::now());
                self.audio_capture_elapsed_ms = 0;
                self.audio_capture_last_path = None;
                self.base_pill_state = PillState::AudioRun;
                self.transition_to(PillState::AudioExpand);
                self.bubble =
                    BubbleState::complete("Audio Notes recording".to_string(), self.frame_count);
            }
            Err(err) => {
                self.output_text = err;
                self.transition_to(PillState::Output);
            }
        }
    }

    fn stop_audio_capture(&mut self) {
        if !self.audio_capture_running {
            return;
        }
        self.audio_capture_running = false;
        self.audio_capture_elapsed_ms = self.current_audio_capture_elapsed_ms();
        self.audio_capture_anchor = None;
        self.base_pill_state = self.passive_base_state();

        let Some(handle) = self.audio_capture_handle.take() else {
            self.output_text = "Audio recorder handle was missing.".to_string();
            self.transition_to(PillState::Output);
            return;
        };
        self.processing_label = "Finishing audio notes".to_string();
        self.processing_progress = 0.14;
        self.transition_to(PillState::Processing);
        let tx = self.cmd.tx.clone();
        std::thread::spawn(move || match handle.stop() {
            Ok(result) => {
                let _ = tx.send(Command::AudioNotesCaptured {
                    path: result.path.to_string_lossy().to_string(),
                    duration_ms: result.duration_ms,
                });
            }
            Err(err) => {
                let _ = tx.send(Command::AudioNotesCaptureFailed { message: err });
            }
        });
    }

    fn set_audio_capture_source_file(&mut self, path: String) {
        let trimmed = path.trim();
        self.audio_capture_source_file = if trimmed.is_empty() {
            None
        } else {
            Some(PathBuf::from(trimmed))
        };
    }

    fn start_screen_capture(&mut self) {
        if self.screen_capture_running {
            self.transition_to(PillState::ScreenExpand);
            return;
        }
        if self.audio_capture_running {
            self.transition_to(PillState::AudioExpand);
            self.bubble = BubbleState::error("Stop Audio Notes first".to_string());
            return;
        }
        match ScreenCaptureHandle::start(&self.config.download_dir) {
            Ok(handle) => {
                self.screen_capture_handle = Some(handle);
                self.screen_capture_running = true;
                self.screen_capture_anchor = Some(Instant::now());
                self.screen_capture_elapsed_ms = 0;
                self.screen_capture_last_path = None;
                self.base_pill_state = PillState::ScreenRun;
                self.transition_to(PillState::ScreenExpand);
                self.bubble =
                    BubbleState::complete("Screen recording".to_string(), self.frame_count);
            }
            Err(err) => {
                self.output_text = err;
                self.transition_to(PillState::Output);
            }
        }
    }

    fn stop_screen_capture(&mut self) {
        if !self.screen_capture_running {
            return;
        }
        self.screen_capture_running = false;
        self.screen_capture_elapsed_ms = self.current_screen_capture_elapsed_ms();
        self.screen_capture_anchor = None;
        self.base_pill_state = self.passive_base_state();

        let Some(handle) = self.screen_capture_handle.take() else {
            self.output_text = "Screen recorder handle was missing.".to_string();
            self.transition_to(PillState::Output);
            return;
        };
        self.processing_label = "Finishing screen record".to_string();
        self.processing_progress = 0.14;
        self.transition_to(PillState::Processing);
        let tx = self.cmd.tx.clone();
        std::thread::spawn(move || match handle.stop() {
            Ok(result) => {
                let _ = tx.send(Command::ScreenRecordCaptured {
                    path: result.path.to_string_lossy().to_string(),
                    duration_ms: result.duration_ms,
                });
            }
            Err(err) => {
                let _ = tx.send(Command::ScreenRecordCaptureFailed { message: err });
            }
        });
    }

    fn passive_base_state(&self) -> PillState {
        if self.audio_capture_running {
            return PillState::AudioRun;
        }
        if self.screen_capture_running {
            return PillState::ScreenRun;
        }
        if self.effective_music_playing() {
            let lyric_ready =
                self.config.show_lyrics && self.current_local_playback_position_ms() >= 1100;
            if lyric_ready && !self.current_lyric_text.is_empty() {
                PillState::MusicLyric
            } else {
                PillState::MusicWave
            }
        } else {
            PillState::Idle
        }
    }

    fn open_focus_surface(&mut self) {
        if self.focus_total_ms > 0 {
            self.transition_to(PillState::FocusExpand);
        } else if self.pill_state == PillState::FocusComplete {
            self.transition_to(PillState::FocusComplete);
        } else {
            self.transition_to(PillState::FocusSetup);
        }
    }

    fn set_focus_duration(&mut self, total_ms: u64) {
        self.focus_selected_total_ms = total_ms.clamp(5_000, 3 * 60 * 60 * 1000);
        self.reset_auto_collapse();
    }

    fn start_focus_session(&mut self, phase: FocusPhase, total_ms: u64) {
        let duration_ms = total_ms.clamp(5_000, 3 * 60 * 60 * 1000);
        self.focus_phase = phase;
        self.focus_completion_kind = match phase {
            FocusPhase::Work => FocusCompletionKind::WorkFinished,
            FocusPhase::Break => FocusCompletionKind::BreakFinished,
        };
        self.focus_total_ms = duration_ms;
        self.focus_remaining_ms = duration_ms;
        self.focus_running = true;
        self.focus_anchor = Some(Instant::now());
        if phase == FocusPhase::Work {
            self.focus_last_work_total_ms = duration_ms;
            self.focus_selected_total_ms = duration_ms;
        }
        self.base_pill_state = PillState::FocusRun;
        self.transition_to(PillState::FocusRun);
        self.bubble = BubbleState::complete(
            match phase {
                FocusPhase::Work => "Focus started".to_string(),
                FocusPhase::Break => "Break started".to_string(),
            },
            self.frame_count,
        );
    }

    fn clear_focus_session(&mut self, clear_label: bool) {
        self.focus_total_ms = 0;
        self.focus_remaining_ms = 0;
        self.focus_running = false;
        self.focus_anchor = None;
        self.focus_phase = FocusPhase::Work;
        self.focus_completion_kind = FocusCompletionKind::WorkFinished;
        if clear_label {
            self.focus_label_text.clear();
            self.focus_label_cursor = 0;
        }
        self.base_pill_state = self.passive_base_state();
    }

    fn pause_focus_session(&mut self) {
        if !self.focus_running || self.focus_total_ms == 0 {
            return;
        }
        self.tick_focus_clock(None);
        self.focus_running = false;
        self.focus_anchor = None;
        self.bubble = BubbleState::complete("Focus paused".to_string(), self.frame_count);
        self.reset_auto_collapse();
    }

    fn resume_focus_session(&mut self) {
        if self.focus_total_ms == 0 || self.focus_running || self.focus_remaining_ms == 0 {
            return;
        }
        self.focus_running = true;
        self.focus_anchor = Some(Instant::now());
        self.base_pill_state = PillState::FocusRun;
        self.bubble = BubbleState::complete("Focus resumed".to_string(), self.frame_count);
        self.reset_auto_collapse();
    }

    fn advance_focus_session(&mut self, elapsed_ms: u64) {
        if self.focus_total_ms == 0 || elapsed_ms == 0 {
            return;
        }
        self.tick_focus_clock(Some(elapsed_ms));
    }

    fn tick_focus_clock(&mut self, forced_elapsed_ms: Option<u64>) {
        if self.focus_total_ms == 0 || !self.focus_running {
            return;
        }
        let elapsed_ms = if let Some(value) = forced_elapsed_ms {
            value
        } else {
            self.focus_anchor
                .map(|anchor| anchor.elapsed().as_millis() as u64)
                .unwrap_or(0)
        };
        if elapsed_ms == 0 {
            return;
        }
        self.focus_remaining_ms = self.focus_remaining_ms.saturating_sub(elapsed_ms);
        self.focus_anchor = Some(Instant::now());
        if self.focus_remaining_ms == 0 {
            self.finish_focus_session();
        }
    }

    fn finish_focus_session(&mut self) {
        if self.focus_total_ms == 0 {
            return;
        }
        self.focus_running = false;
        self.focus_anchor = None;
        self.focus_completion_kind = match self.focus_phase {
            FocusPhase::Work => {
                self.focus_rounds_completed = self.focus_rounds_completed.saturating_add(1);
                FocusCompletionKind::WorkFinished
            }
            FocusPhase::Break => FocusCompletionKind::BreakFinished,
        };
        self.base_pill_state = self.passive_base_state();
        self.transition_to(PillState::FocusComplete);
        self.bubble = BubbleState::complete(
            match self.focus_phase {
                FocusPhase::Work => "Focus complete".to_string(),
                FocusPhase::Break => "Break complete".to_string(),
            },
            self.frame_count,
        );
    }

    fn skip_focus_session(&mut self) {
        if self.focus_total_ms == 0 {
            return;
        }
        self.focus_remaining_ms = 0;
        self.finish_focus_session();
    }

    fn start_focus_break(&mut self) {
        self.start_focus_session(FocusPhase::Break, FOCUS_BREAK_TOTAL_MS);
    }

    fn start_focus_next_round(&mut self) {
        let total_ms = self.focus_last_work_total_ms.max(FOCUS_DEFAULT_TOTAL_MS);
        self.start_focus_session(FocusPhase::Work, total_ms);
    }

    fn extend_focus_session(&mut self, extra_ms: u64) {
        if self.focus_total_ms == 0 || extra_ms == 0 {
            return;
        }
        self.focus_total_ms = self.focus_total_ms.saturating_add(extra_ms);
        self.focus_remaining_ms = self.focus_remaining_ms.saturating_add(extra_ms);
        if self.focus_running {
            self.focus_anchor = Some(Instant::now());
        }
        self.reset_auto_collapse();
    }

    fn focus_log_prompt(&self) -> String {
        let minutes = (self.focus_last_work_total_ms / 60_000).max(1);
        let label = self.focus_label_text.trim();
        if label.is_empty() {
            format!(
                "我刚完成了一轮 {minutes} 分钟专注。请帮我总结刚才的进展，并给出最合理的下一步。"
            )
        } else {
            format!(
                "我刚完成了一轮 {minutes} 分钟专注，主题是“{label}”。请帮我总结刚才的进展，并给出最合理的下一步。"
            )
        }
    }

    fn log_focus_progress(&mut self) {
        self.input_text = self.focus_log_prompt();
        self.input_cursor = self.input_text.len();
        self.ime_preedit.clear();
        self.clear_focus_session(false);
        self.transition_to(PillState::Input);
    }

    fn tick_focus_timer(&mut self, window: &Arc<Window>) {
        let before = self.focus_remaining_ms;
        let was_state = self.pill_state.clone();
        self.tick_focus_clock(None);
        if self.focus_remaining_ms != before || self.pill_state != was_state {
            window.request_redraw();
        }
    }

    fn apply_external_timer_update(&mut self, label: String, remaining_ms: u64, total_ms: u64) {
        self.focus_label_text = label;
        self.focus_label_cursor = self.focus_label_text.len();
        self.focus_phase = FocusPhase::Work;
        self.focus_total_ms = total_ms.max(1_000);
        self.focus_remaining_ms = remaining_ms.min(self.focus_total_ms);
        self.focus_selected_total_ms = self.focus_total_ms;
        self.focus_last_work_total_ms = self.focus_total_ms;
        self.focus_anchor = None;
        self.focus_running = self.focus_remaining_ms > 0;
        if self.focus_running {
            self.base_pill_state = PillState::FocusRun;
            self.transition_to(PillState::FocusRun);
        } else {
            self.focus_completion_kind = FocusCompletionKind::WorkFinished;
            self.base_pill_state = self.passive_base_state();
            self.transition_to(PillState::FocusComplete);
        }
    }

    fn write_debug_state(&self, path: &str) {
        if path.trim().is_empty() {
            return;
        }
        let payload = json!({
            "pill_state": pill_state_id(&self.pill_state),
            "music_search_query": self.music_search_query,
            "music_searching": self.music_searching,
            "music_queue_len": self.music_playlist.len(),
            "music_current_index": self.music_current_index,
            "music_current_song_id": self.music_current_song_id,
            "music_playing": self.effective_music_playing(),
            "music_netease_connected": self.music_netease_connected,
            "music_netease_account_name": self.music_netease_account_name,
            "music_auth_status": self.music_auth_status,
            "music_auth_session_id": self.music_auth_session_id,
            "music_auth_qr_ready": self.music_auth_qr_image.is_some(),
            "music_results_context_label": self.music_results_context_label,
            "music_progress_fraction": self.current_music_progress_fraction(),
            "music_local_title": self.local_lyrics_title,
            "music_local_artist": self.local_lyrics_artist,
            "music_current_lyric": self.current_lyric_text,
            "music_local_lyrics_ready": self.local_media_lyrics.as_ref().map(|lines| lines.len()).unwrap_or(0),
            "action_is_image": self.action_is_image,
            "action_is_video": self.action_is_video,
            "action_text": self.action_text,
            "action_detail_text": self.action_detail_text,
            "action_file_name": self.action_file_name,
            "action_download_url": self.action_download_url,
            "action_requires_download": self.action_requires_download,
            "action_downloading": self.action_downloading,
            "action_thumbnail_ready": self.action_thumbnail.is_some(),
            "action_editor_available": self.action_editor_url.is_some(),
            "action_image_ratio": self.action_image_aspect_ratio,
            "image_edit_tool": edit_tool_id(self.image_edit_tool),
            "image_edit_prompt": self.file_input_text,
            "image_edit_has_mask": !self.image_edit_mask_strokes.is_empty()
                || self.image_edit_current_stroke.is_some(),
            "focus_phase": focus_phase_id(self.focus_phase),
            "focus_completion_kind": focus_completion_id(self.focus_completion_kind),
            "focus_total_ms": self.focus_total_ms,
            "focus_remaining_ms": self.focus_remaining_ms,
            "focus_selected_total_ms": self.focus_selected_total_ms,
            "focus_running": self.focus_running,
            "focus_label_text": self.focus_label_text,
            "focus_rounds_completed": self.focus_rounds_completed,
            "audio_capture_running": self.audio_capture_running,
            "audio_capture_elapsed_ms": self.current_audio_capture_elapsed_ms(),
            "screen_capture_running": self.screen_capture_running,
            "screen_capture_elapsed_ms": self.current_screen_capture_elapsed_ms(),
            "input_file_context_active": self.input_file_context_active,
            "input_file_context_name": if self.input_file_context_active {
                self.active_input_file_context_name()
            } else {
                String::new()
            },
            "processing_label": self.processing_label,
            "processing_progress": self.processing_progress,
            "output_text": self.output_text,
        });
        if let Ok(bytes) = serde_json::to_vec_pretty(&payload) {
            let _ = fs::write(path, bytes);
        }
    }

    fn handle_image_edit_press_start(&mut self, win: Arc<Window>) {
        if !self.is_cursor_inside_pill() {
            self.clear_image_edit_session(false);
            self.transition_to(PillState::ImagePreview);
            win.request_redraw();
            return;
        }

        if !image_edit_tool_uses_mask(self.image_edit_tool) {
            return;
        }

        if let Some(point) = self.current_image_edit_point() {
            let erase = self.modifiers_state.shift_key();
            self.image_edit_brush_mode = if erase {
                ImageEditBrushMode::Erase
            } else {
                ImageEditBrushMode::Paint
            };
            let radius_norm = self.current_image_edit_radius_norm();
            self.image_edit_current_stroke = Some(ImageMaskStroke {
                erase,
                radius_norm,
                points: vec![point.clone()],
            });
            self.draw_image_edit_preview_segment(None, &point, erase, radius_norm);
            self.reset_auto_collapse();
            win.request_redraw();
        }
    }

    fn handle_image_edit_press_end(&mut self, win: Arc<Window>) {
        if self.image_edit_current_stroke.is_some() {
            self.commit_image_edit_stroke();
        } else {
            self.handle_image_edit_tap();
        }
        win.request_redraw();
    }

    fn tick_image_edit_brush(&mut self, window: &Arc<Window>) {
        if self.pill_state != PillState::ImageEdit {
            return;
        }
        if self.image_edit_current_stroke.is_none() {
            return;
        }
        if !is_left_button_pressed() {
            self.commit_image_edit_stroke();
            window.request_redraw();
        }
    }

    fn current_image_edit_radius_norm(&self) -> f32 {
        let rect = self.image_edit_display_rect();
        let basis = rect.width().max(rect.height()).max(1.0);
        (IMAGE_EDIT_DEFAULT_BRUSH * self.config.global_scale / basis).clamp(0.01, 0.18)
    }

    fn current_image_edit_point(&self) -> Option<ImageMaskPoint> {
        if let Some((rel_x, rel_y)) = self.cursor_local_pos {
            if let Some(point) = self.image_edit_point_from_local(rel_x, rel_y) {
                return Some(point);
            }
        }
        let (px, py) = get_global_cursor_pos();
        self.image_edit_point_from_local((px - self.win_x) as f32, (py - self.win_y) as f32)
    }

    fn image_edit_point_from_local(&self, rel_x: f32, rel_y: f32) -> Option<ImageMaskPoint> {
        let rect = self.image_edit_display_rect();
        if rel_x < rect.left()
            || rel_x > rect.right()
            || rel_y < rect.top()
            || rel_y > rect.bottom()
        {
            return None;
        }
        Some(ImageMaskPoint {
            x: ((rel_x - rect.left()) / rect.width()).clamp(0.0, 1.0),
            y: ((rel_y - rect.top()) / rect.height()).clamp(0.0, 1.0),
        })
    }

    fn handle_image_edit_cursor_move(&mut self, rel_x: f32, rel_y: f32) -> bool {
        if self.image_edit_current_stroke.is_none() {
            return false;
        }
        if !is_left_button_pressed() {
            self.commit_image_edit_stroke();
            return true;
        }
        let Some(point) = self.image_edit_point_from_local(rel_x, rel_y) else {
            return false;
        };
        self.push_image_edit_point(point)
    }

    fn push_image_edit_point(&mut self, point: ImageMaskPoint) -> bool {
        let mut segment_start = None;
        let (erase, radius_norm);
        {
            let Some(stroke) = self.image_edit_current_stroke.as_mut() else {
                return false;
            };
            if let Some(last) = stroke.points.last() {
                let dx = point.x - last.x;
                let dy = point.y - last.y;
                if dx * dx + dy * dy <= 0.00001 {
                    return false;
                }
                segment_start = Some(last.clone());
            }
            erase = stroke.erase;
            radius_norm = stroke.radius_norm;
            stroke.points.push(point.clone());
        }
        self.draw_image_edit_preview_segment(segment_start.as_ref(), &point, erase, radius_norm);
        true
    }

    fn commit_image_edit_stroke(&mut self) {
        if let Some(stroke) = self.image_edit_current_stroke.take() {
            if !stroke.points.is_empty() {
                self.image_edit_mask_strokes.push(stroke);
                self.refresh_image_edit_intent();
                self.reset_auto_collapse();
            }
        }
    }

    fn handle_image_edit_tap(&mut self) {
        if self.is_cursor_on_image_edit_clear_button() {
            let had_mask = !self.image_edit_mask_strokes.is_empty()
                || self.image_edit_current_stroke.is_some();
            let had_prompt = !self.file_input_text.trim().is_empty();
            self.image_edit_mask_strokes.clear();
            self.image_edit_current_stroke = None;
            self.clear_image_edit_mask_preview();
            if had_prompt {
                self.file_input_text.clear();
                self.file_input_cursor = 0;
            }
            self.refresh_image_edit_intent();
            let message = if had_mask && had_prompt {
                "Mask and prompt cleared"
            } else if had_prompt {
                "Prompt cleared"
            } else {
                "Mask cleared"
            };
            self.bubble = BubbleState::complete(message.to_string(), self.frame_count);
            self.reset_auto_collapse();
            return;
        }
        if self.is_cursor_on_image_edit_studio_button() {
            let _ = self.open_image_editor();
            return;
        }
        if self.is_cursor_on_image_edit_apply_button() {
            self.apply_image_edit();
            return;
        }
        if self.is_cursor_on_image_edit_prompt_rect() {
            self.file_input_cursor = self.file_input_text.len();
            self.reset_auto_collapse();
            return;
        }
    }

    fn handle_image_edit_key(&mut self, key: &Key, text: Option<&str>) {
        match key {
            Key::Named(NamedKey::Escape) => {
                if !self.file_input_text.is_empty() {
                    self.file_input_text.clear();
                    self.file_input_cursor = 0;
                    self.refresh_image_edit_intent();
                } else {
                    self.clear_image_edit_session(false);
                    self.transition_to(PillState::ImagePreview);
                }
            }
            Key::Named(NamedKey::Backspace) => {
                if self.file_input_cursor > 0 {
                    let bp = prev_char_boundary(&self.file_input_text, self.file_input_cursor);
                    self.file_input_text.remove(bp);
                    self.file_input_cursor = bp;
                    self.refresh_image_edit_intent();
                    self.reset_auto_collapse();
                }
            }
            Key::Named(NamedKey::ArrowLeft) => {
                self.file_input_cursor =
                    prev_char_boundary(&self.file_input_text, self.file_input_cursor);
            }
            Key::Named(NamedKey::ArrowRight) => {
                self.file_input_cursor =
                    next_char_boundary(&self.file_input_text, self.file_input_cursor);
            }
            Key::Named(NamedKey::Home) => {
                self.file_input_cursor = 0;
            }
            Key::Named(NamedKey::End) => {
                self.file_input_cursor = self.file_input_text.len();
            }
            Key::Named(NamedKey::Enter) => {
                if self.modifiers_state.shift_key() {
                    self.file_input_text.insert(self.file_input_cursor, '\n');
                    self.file_input_cursor += '\n'.len_utf8();
                    self.refresh_image_edit_intent();
                    self.reset_auto_collapse();
                    return;
                }
                self.apply_image_edit();
            }
            _ => {
                if let Some(s) = text {
                    self.file_input_text.insert_str(self.file_input_cursor, s);
                    self.file_input_cursor += s.len();
                    self.refresh_image_edit_intent();
                    self.reset_auto_collapse();
                }
            }
        }
    }

    fn apply_image_edit(&mut self) {
        let Some(source_url) = self.action_download_url.clone() else {
            self.bubble = BubbleState::error("Image source is not available".to_string());
            return;
        };

        self.refresh_image_edit_intent();
        let mut prompt = self.file_input_text.trim().to_string();
        let edit_tool = self.image_edit_tool;
        let outpaint_preset = self.image_edit_outpaint_preset;
        let tool_label = match edit_tool {
            ImageEditTool::RemoveObject => "Cleaning image",
            ImageEditTool::ReplaceObject => "Replacing subject",
            ImageEditTool::AddText => "Rendering text",
            ImageEditTool::Outpaint => "Extending frame",
            ImageEditTool::RemoveBackground => "Cutting out subject",
            ImageEditTool::RemoveWatermark => "Cleaning watermark",
            ImageEditTool::Upscale => "Enhancing resolution",
            ImageEditTool::FaceRestore => "Restoring face",
        };

        let mask_data_url = if !image_edit_tool_uses_mask(edit_tool) {
            None
        } else {
            match self.build_image_edit_mask_data_url() {
                Ok(mask) => Some(mask),
                Err(err) => {
                    self.bubble = BubbleState::error(err);
                    return;
                }
            }
        };

        if matches!(edit_tool, ImageEditTool::ReplaceObject) && prompt.is_empty() {
            self.bubble = BubbleState::error("Describe the replacement first".to_string());
            return;
        }
        if matches!(edit_tool, ImageEditTool::AddText) && prompt.is_empty() {
            self.bubble = BubbleState::error("Type the text to insert first".to_string());
            return;
        }
        if matches!(edit_tool, ImageEditTool::RemoveWatermark) && prompt.is_empty() {
            prompt = "remove the watermark cleanly".to_string();
            self.file_input_text = prompt.clone();
            self.file_input_cursor = prompt.len();
        }
        if matches!(edit_tool, ImageEditTool::RemoveBackground) && prompt.is_empty() {
            prompt = "remove the background and keep the subject clean".to_string();
            self.file_input_text = prompt.clone();
            self.file_input_cursor = prompt.len();
        }

        self.processing_label = tool_label.to_string();
        self.processing_progress = 0.0;
        self.action_requires_download = false;
        self.action_downloading = false;
        self.action_saved_path = None;
        self.transition_to(PillState::ImageProcessing);

        crate::core::file_client::process_image_edit(
            source_url,
            edit_tool_id(edit_tool).to_string(),
            prompt,
            mask_data_url,
            outpaint_expansion(outpaint_preset),
            self.cmd.tx.clone(),
        );
    }

    fn image_edit_canvas_rect(&self) -> skia_safe::Rect {
        let rect = self.pill_rect();
        let scale = self.config.global_scale;
        skia_safe::Rect::from_xywh(
            rect.left() + IMAGE_EDIT_CANVAS_SIDE_PADDING * scale,
            rect.top() + IMAGE_EDIT_CANVAS_TOP * scale,
            rect.width() - IMAGE_EDIT_CANVAS_SIDE_PADDING * 2.0 * scale,
            rect.height() - IMAGE_EDIT_CANVAS_BOTTOM_GAP * scale - IMAGE_EDIT_CANVAS_TOP * scale,
        )
    }

    fn image_edit_display_rect(&self) -> skia_safe::Rect {
        let container = self.image_edit_canvas_rect();
        let ratio = self
            .action_image_aspect_ratio
            .unwrap_or(1.0)
            .clamp(0.2, 5.0);
        fit_rect_with_ratio(container, ratio)
    }

    fn image_edit_clear_button_rect(&self) -> skia_safe::Rect {
        let rect = self.pill_rect();
        let scale = self.config.global_scale;
        skia_safe::Rect::from_xywh(
            rect.left() + 18.0 * scale,
            rect.top() + IMAGE_EDIT_ACTION_TOP * scale,
            54.0 * scale,
            IMAGE_EDIT_ACTION_HEIGHT * scale,
        )
    }

    fn image_edit_studio_button_rect(&self) -> skia_safe::Rect {
        let rect = self.pill_rect();
        let scale = self.config.global_scale;
        skia_safe::Rect::from_xywh(
            rect.right() - 138.0 * scale,
            rect.top() + IMAGE_EDIT_ACTION_TOP * scale,
            60.0 * scale,
            IMAGE_EDIT_ACTION_HEIGHT * scale,
        )
    }

    fn image_edit_apply_button_rect(&self) -> skia_safe::Rect {
        let rect = self.pill_rect();
        let scale = self.config.global_scale;
        skia_safe::Rect::from_xywh(
            rect.right() - 70.0 * scale,
            rect.top() + IMAGE_EDIT_ACTION_TOP * scale,
            52.0 * scale,
            IMAGE_EDIT_ACTION_HEIGHT * scale,
        )
    }

    fn image_edit_prompt_rect(&self) -> skia_safe::Rect {
        let rect = self.pill_rect();
        let scale = self.config.global_scale;
        skia_safe::Rect::from_xywh(
            rect.left() + 18.0 * scale,
            rect.top() + IMAGE_EDIT_PROMPT_TOP * scale,
            rect.width() - 36.0 * scale,
            IMAGE_EDIT_PROMPT_HEIGHT * scale,
        )
    }

    fn is_cursor_on_image_edit_clear_button(&self) -> bool {
        point_in_rect_from_cursor(self.win_x, self.win_y, self.image_edit_clear_button_rect())
    }

    fn is_cursor_on_image_edit_studio_button(&self) -> bool {
        point_in_rect_from_cursor(self.win_x, self.win_y, self.image_edit_studio_button_rect())
    }

    fn is_cursor_on_image_edit_apply_button(&self) -> bool {
        point_in_rect_from_cursor(self.win_x, self.win_y, self.image_edit_apply_button_rect())
    }

    fn is_cursor_on_image_edit_prompt_rect(&self) -> bool {
        point_in_rect_from_cursor(self.win_x, self.win_y, self.image_edit_prompt_rect())
    }

    fn focus_setup_preset_rect(&self, index: usize) -> skia_safe::Rect {
        let rect = self.pill_rect();
        let scale = self.config.global_scale;
        let left = rect.left() + 16.0 * scale;
        let top = rect.top() + 92.0 * scale;
        let gap = 8.0 * scale;
        let chip_w = (rect.width() - 32.0 * scale - gap * 2.0) / 3.0;
        skia_safe::Rect::from_xywh(
            left + index as f32 * (chip_w + gap),
            top,
            chip_w,
            30.0 * scale,
        )
    }

    fn focus_setup_label_rect(&self) -> skia_safe::Rect {
        let rect = self.pill_rect();
        let scale = self.config.global_scale;
        skia_safe::Rect::from_xywh(
            rect.left() + 16.0 * scale,
            rect.top() + 128.0 * scale,
            rect.width() - 32.0 * scale,
            40.0 * scale,
        )
    }

    fn focus_setup_cancel_rect(&self) -> skia_safe::Rect {
        let rect = self.pill_rect();
        let scale = self.config.global_scale;
        skia_safe::Rect::from_xywh(
            rect.left() + 16.0 * scale,
            rect.bottom() - 40.0 * scale,
            68.0 * scale,
            28.0 * scale,
        )
    }

    fn focus_setup_start_rect(&self) -> skia_safe::Rect {
        let rect = self.pill_rect();
        let scale = self.config.global_scale;
        skia_safe::Rect::from_xywh(
            rect.right() - 84.0 * scale,
            rect.bottom() - 40.0 * scale,
            68.0 * scale,
            28.0 * scale,
        )
    }

    fn focus_expand_toggle_rect(&self) -> skia_safe::Rect {
        let rect = self.pill_rect();
        let scale = self.config.global_scale;
        skia_safe::Rect::from_xywh(
            rect.left() + 16.0 * scale,
            rect.bottom() - 42.0 * scale,
            86.0 * scale,
            30.0 * scale,
        )
    }

    fn focus_expand_extend_rect(&self) -> skia_safe::Rect {
        let rect = self.pill_rect();
        let scale = self.config.global_scale;
        skia_safe::Rect::from_xywh(
            rect.center_x() - 36.0 * scale,
            rect.bottom() - 42.0 * scale,
            72.0 * scale,
            30.0 * scale,
        )
    }

    fn focus_expand_skip_rect(&self) -> skia_safe::Rect {
        let rect = self.pill_rect();
        let scale = self.config.global_scale;
        skia_safe::Rect::from_xywh(
            rect.right() - 88.0 * scale,
            rect.bottom() - 42.0 * scale,
            72.0 * scale,
            30.0 * scale,
        )
    }

    fn focus_complete_again_rect(&self) -> skia_safe::Rect {
        let rect = self.pill_rect();
        let scale = self.config.global_scale;
        skia_safe::Rect::from_xywh(
            rect.left() + 14.0 * scale,
            rect.bottom() - 40.0 * scale,
            84.0 * scale,
            28.0 * scale,
        )
    }

    fn focus_complete_secondary_rect(&self) -> skia_safe::Rect {
        let rect = self.pill_rect();
        let scale = self.config.global_scale;
        skia_safe::Rect::from_xywh(
            rect.center_x() - 44.0 * scale,
            rect.bottom() - 40.0 * scale,
            88.0 * scale,
            28.0 * scale,
        )
    }

    fn focus_complete_log_rect(&self) -> skia_safe::Rect {
        let rect = self.pill_rect();
        let scale = self.config.global_scale;
        skia_safe::Rect::from_xywh(
            rect.right() - 94.0 * scale,
            rect.bottom() - 40.0 * scale,
            80.0 * scale,
            28.0 * scale,
        )
    }

    fn audio_expand_stop_rect(&self) -> skia_safe::Rect {
        let rect = self.pill_rect();
        let scale = self.config.global_scale;
        skia_safe::Rect::from_xywh(
            rect.right() - 112.0 * scale,
            rect.bottom() - 42.0 * scale,
            92.0 * scale,
            30.0 * scale,
        )
    }

    fn screen_expand_stop_rect(&self) -> skia_safe::Rect {
        let rect = self.pill_rect();
        let scale = self.config.global_scale;
        skia_safe::Rect::from_xywh(
            rect.right() - 112.0 * scale,
            rect.bottom() - 42.0 * scale,
            92.0 * scale,
            30.0 * scale,
        )
    }

    fn handle_focus_setup_tap(&mut self) -> bool {
        for (index, preset_ms) in FOCUS_PRESET_TOTALS_MS.iter().enumerate() {
            if point_in_rect_from_cursor(
                self.win_x,
                self.win_y,
                self.focus_setup_preset_rect(index),
            ) {
                self.set_focus_duration(*preset_ms);
                return true;
            }
        }
        if point_in_rect_from_cursor(self.win_x, self.win_y, self.focus_setup_label_rect()) {
            self.reset_auto_collapse();
            return true;
        }
        if point_in_rect_from_cursor(self.win_x, self.win_y, self.focus_setup_cancel_rect()) {
            return false;
        }
        if point_in_rect_from_cursor(self.win_x, self.win_y, self.focus_setup_start_rect()) {
            self.start_focus_session(FocusPhase::Work, self.focus_selected_total_ms);
            return true;
        }
        false
    }

    fn handle_focus_expand_tap(&mut self) -> bool {
        if point_in_rect_from_cursor(self.win_x, self.win_y, self.focus_expand_toggle_rect()) {
            if self.focus_running {
                self.pause_focus_session();
            } else {
                self.resume_focus_session();
            }
            return true;
        }
        if point_in_rect_from_cursor(self.win_x, self.win_y, self.focus_expand_extend_rect()) {
            self.extend_focus_session(5 * 60 * 1000);
            return true;
        }
        if point_in_rect_from_cursor(self.win_x, self.win_y, self.focus_expand_skip_rect()) {
            self.skip_focus_session();
            return true;
        }
        false
    }

    fn handle_focus_complete_tap(&mut self) -> bool {
        if point_in_rect_from_cursor(self.win_x, self.win_y, self.focus_complete_again_rect()) {
            self.start_focus_next_round();
            return true;
        }
        if point_in_rect_from_cursor(self.win_x, self.win_y, self.focus_complete_secondary_rect()) {
            if self.focus_completion_kind == FocusCompletionKind::WorkFinished {
                self.start_focus_break();
            } else {
                self.clear_focus_session(false);
                self.restore_base();
            }
            return true;
        }
        if point_in_rect_from_cursor(self.win_x, self.win_y, self.focus_complete_log_rect()) {
            self.log_focus_progress();
            return true;
        }
        false
    }

    fn handle_audio_expand_tap(&mut self) -> bool {
        if point_in_rect_from_cursor(self.win_x, self.win_y, self.audio_expand_stop_rect()) {
            self.stop_audio_capture();
            return true;
        }
        false
    }

    fn handle_screen_expand_tap(&mut self) -> bool {
        if point_in_rect_from_cursor(self.win_x, self.win_y, self.screen_expand_stop_rect()) {
            self.stop_screen_capture();
            return true;
        }
        false
    }

    fn handle_music_auth_tap(&mut self) -> bool {
        match self.music_auth_status.as_str() {
            "failed" | "expired" => {
                self.music_auth_session_id = None;
                self.music_auth_qr_image = None;
                self.music_auth_status = "starting".to_string();
                music_client::start_auth(self.cmd.tx.clone());
                self.reset_auto_collapse();
                true
            }
            "success" => {
                self.load_music_recommendations();
                true
            }
            _ => true,
        }
    }

    fn current_image_pixel_size(&self) -> (u32, u32) {
        if let Some(image) = self.action_thumbnail.as_ref() {
            let width = image.width().max(1) as u32;
            let height = image.height().max(1) as u32;
            return (width, height);
        }
        let ratio = self
            .action_image_aspect_ratio
            .unwrap_or(1.0)
            .clamp(0.2, 5.0);
        if ratio >= 1.0 {
            (1024, (1024.0 / ratio).round().max(1.0) as u32)
        } else {
            ((1024.0 * ratio).round().max(1.0) as u32, 1024)
        }
    }

    fn image_edit_preview_mask_size(&self) -> (i32, i32) {
        let ratio = self
            .action_image_aspect_ratio
            .unwrap_or(1.0)
            .clamp(0.2, 5.0);
        if ratio >= 1.0 {
            (
                IMAGE_EDIT_PREVIEW_MASK_LONG_SIDE,
                ((IMAGE_EDIT_PREVIEW_MASK_LONG_SIDE as f32) / ratio)
                    .round()
                    .max(1.0) as i32,
            )
        } else {
            (
                ((IMAGE_EDIT_PREVIEW_MASK_LONG_SIDE as f32) * ratio)
                    .round()
                    .max(1.0) as i32,
                IMAGE_EDIT_PREVIEW_MASK_LONG_SIDE,
            )
        }
    }

    fn ensure_image_edit_mask_surface(&mut self) {
        let size = self.image_edit_preview_mask_size();
        if self.image_edit_mask_surface.is_some() && self.image_edit_mask_surface_size == Some(size)
        {
            return;
        }

        self.image_edit_mask_surface = surfaces::raster_n32_premul((size.0, size.1))
            .map(Some)
            .unwrap_or(None);
        self.image_edit_mask_surface_size = self.image_edit_mask_surface.as_ref().map(|_| size);
        self.redraw_image_edit_mask_preview();
    }

    fn clear_image_edit_mask_preview(&mut self) {
        if let Some(surface) = self.image_edit_mask_surface.as_mut() {
            surface.canvas().clear(Color::TRANSPARENT);
        }
        self.image_edit_mask_preview = None;
    }

    fn sync_image_edit_mask_preview(&mut self) {
        self.image_edit_mask_preview = self
            .image_edit_mask_surface
            .as_mut()
            .map(|surface| surface.image_snapshot());
    }

    fn redraw_image_edit_mask_preview(&mut self) {
        let strokes = self.image_edit_mask_strokes.clone();
        let pending = self.image_edit_current_stroke.clone();
        let size = self.image_edit_preview_mask_size();
        if self.image_edit_mask_surface.is_none() || self.image_edit_mask_surface_size != Some(size)
        {
            self.image_edit_mask_surface = surfaces::raster_n32_premul((size.0, size.1))
                .map(Some)
                .unwrap_or(None);
            self.image_edit_mask_surface_size = self.image_edit_mask_surface.as_ref().map(|_| size);
        }

        let Some(surface) = self.image_edit_mask_surface.as_mut() else {
            self.image_edit_mask_preview = None;
            return;
        };
        surface.canvas().clear(Color::TRANSPARENT);
        for stroke in &strokes {
            draw_mask_preview_stroke(surface, size.0, size.1, stroke);
        }
        if let Some(stroke) = pending.as_ref() {
            draw_mask_preview_stroke(surface, size.0, size.1, stroke);
        }
        self.sync_image_edit_mask_preview();
    }

    fn draw_image_edit_preview_segment(
        &mut self,
        from: Option<&ImageMaskPoint>,
        to: &ImageMaskPoint,
        erase: bool,
        radius_norm: f32,
    ) {
        self.ensure_image_edit_mask_surface();
        let Some(surface) = self.image_edit_mask_surface.as_mut() else {
            return;
        };
        let Some((width, height)) = self.image_edit_mask_surface_size else {
            return;
        };
        draw_mask_preview_segment(surface, width, height, from, to, erase, radius_norm);
        self.sync_image_edit_mask_preview();
    }

    fn build_image_edit_mask_data_url(&self) -> Result<String, String> {
        if self.image_edit_mask_strokes.is_empty() && self.image_edit_current_stroke.is_none() {
            return Err("Paint or segment a mask first".to_string());
        }

        let (width, height) = self.current_image_pixel_size();
        let mut buffer = vec![0_u8; (width * height) as usize];
        rasterize_mask_strokes(
            &mut buffer,
            width,
            height,
            &self.image_edit_mask_strokes,
            self.image_edit_current_stroke.as_ref(),
        );
        if !buffer.iter().any(|value| *value > 0) {
            return Err("Mask is empty".to_string());
        }
        let image = ImageBuffer::<Luma<u8>, Vec<u8>>::from_raw(width, height, buffer)
            .ok_or_else(|| "Failed to build mask image".to_string())?;
        let mut bytes = Vec::new();
        DynamicImage::ImageLuma8(image)
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .map_err(|err| format!("Failed to encode mask: {err}"))?;
        Ok(format!(
            "data:image/png;base64,{}",
            BASE64_STANDARD.encode(bytes)
        ))
    }

    fn refresh_image_edit_intent(&mut self) {
        let has_mask =
            !self.image_edit_mask_strokes.is_empty() || self.image_edit_current_stroke.is_some();
        self.image_edit_tool = infer_image_edit_tool(&self.file_input_text, has_mask);
        if self.image_edit_tool == ImageEditTool::Outpaint {
            self.image_edit_outpaint_preset = infer_outpaint_preset(&self.file_input_text);
        }
    }

    fn set_image_edit_tool_from_label(&mut self, tool: &str) -> bool {
        let normalized = tool.trim().to_ascii_lowercase();
        let next_tool = match normalized.as_str() {
            "remove" | "remove-object" | "remove_object" => ImageEditTool::RemoveObject,
            "replace" | "replace-object" | "replace_object" => ImageEditTool::ReplaceObject,
            "text" | "add-text" | "add_text" => ImageEditTool::AddText,
            "outpaint" => ImageEditTool::Outpaint,
            "background" | "remove-background" | "remove_background" => {
                ImageEditTool::RemoveBackground
            }
            "watermark" | "remove-watermark" | "remove_watermark" => ImageEditTool::RemoveWatermark,
            "upscale" | "enhance" => ImageEditTool::Upscale,
            "face-restore" | "face_restore" | "portrait" => ImageEditTool::FaceRestore,
            _ => return false,
        };
        self.image_edit_tool = next_tool;
        if next_tool == ImageEditTool::Outpaint {
            self.image_edit_outpaint_preset = infer_outpaint_preset(&self.file_input_text);
            self.image_edit_current_stroke = None;
        } else if !image_edit_tool_uses_mask(next_tool) {
            self.image_edit_current_stroke = None;
        }
        self.reset_auto_collapse();
        true
    }

    fn set_image_edit_prompt_text(&mut self, text: String) {
        self.file_input_text = text;
        self.file_input_cursor = self.file_input_text.len();
        self.refresh_image_edit_intent();
        self.reset_auto_collapse();
    }

    fn add_image_edit_mask_rect(
        &mut self,
        left_norm: f32,
        top_norm: f32,
        width_norm: f32,
        height_norm: f32,
    ) {
        let left = left_norm.clamp(0.0, 1.0);
        let top = top_norm.clamp(0.0, 1.0);
        let right = (left + width_norm.max(0.02)).clamp(left, 1.0);
        let bottom = (top + height_norm.max(0.02)).clamp(top, 1.0);
        let mut points = Vec::with_capacity(14);
        for index in 0..7 {
            let y = top + (bottom - top) * index as f32 / 6.0;
            if index % 2 == 0 {
                points.push(ImageMaskPoint { x: left, y });
                points.push(ImageMaskPoint { x: right, y });
            } else {
                points.push(ImageMaskPoint { x: right, y });
                points.push(ImageMaskPoint { x: left, y });
            }
        }
        self.image_edit_mask_strokes.push(ImageMaskStroke {
            erase: false,
            radius_norm: self.current_image_edit_radius_norm(),
            points,
        });
        self.redraw_image_edit_mask_preview();
        self.refresh_image_edit_intent();
        self.reset_auto_collapse();
    }

    fn restore_base(&mut self) {
        self.transition_to(self.base_pill_state.clone());
    }

    fn tick_action(&mut self) {
        if !matches!(
            self.pill_state,
            PillState::Action
                | PillState::FileAction
                | PillState::VideoAction
                | PillState::ImageAction
        ) {
            return;
        }
        if self.action_downloading {
            self.action_progress = (self.action_progress + 0.03).min(0.9);
            return;
        }
        if self.action_requires_download {
            return;
        }
        if self.action_progress < 1.0 {
            self.action_progress = (self.action_progress + 0.02).min(1.0);
            if self.action_progress >= 1.0 {
                self.action_text = "Saved".to_string();
                self.active_since = Some(Instant::now());
            }
        }
    }

    fn handle_mouse_wheel(&mut self, delta: MouseScrollDelta) -> bool {
        let amount = match delta {
            MouseScrollDelta::LineDelta(_, y) => {
                -y * output_line_height(self.config.global_scale) * 1.35
            }
            MouseScrollDelta::PixelDelta(pos) => -(pos.y as f32),
        };
        match self.pill_state {
            PillState::Output => self.scroll_output_by(amount),
            PillState::MusicResults => self.scroll_music_results_by(amount),
            _ => false,
        }
    }

    fn scroll_output_by(&mut self, delta: f32) -> bool {
        self.update_output_viewport_metrics();
        self.output_viewport.scroll_by(delta)
    }

    fn scroll_music_results_by(&mut self, delta: f32) -> bool {
        if self.music_results.is_empty() {
            return false;
        }
        let row_h = 52.0 * self.config.global_scale;
        let gap = 6.0 * self.config.global_scale;
        let content_h = self.music_results.len() as f32 * (row_h + gap);
        let view_h = (260.0 - 52.0) * self.config.global_scale;
        let max_scroll = (content_h - view_h).max(0.0);
        let next = (self.music_results_scroll + delta).clamp(0.0, max_scroll);
        if (next - self.music_results_scroll).abs() <= 0.1 {
            return false;
        }
        self.music_results_scroll = next;
        true
    }

    fn update_output_viewport_metrics(&mut self) {
        let max_scroll = estimate_output_max_scroll(self.config.global_scale, &self.output_text);
        self.output_viewport.set_max_scroll(max_scroll);
    }

    fn is_cursor_on_output_energy_pill(&self) -> bool {
        if self.pill_state != PillState::Output {
            return false;
        }
        let (px, py) = get_global_cursor_pos();
        let rel_x = (px - self.win_x) as f64;
        let rel_y = (py - self.win_y) as f64;
        let rect = self.pill_rect();
        let scale = self.config.global_scale as f64;
        let highlight = self.output_viewport.at_end();
        let pill_w = if highlight {
            100.0 * scale
        } else {
            36.0 * scale
        };
        let pill_h = if highlight { 12.0 * scale } else { 5.0 * scale };
        let pill_x = rect.center_x() as f64 - pill_w * 0.5;
        let pill_y = rect.bottom() as f64 - 14.0 * scale - pill_h;
        is_point_in_rect(rel_x, rel_y, pill_x, pill_y, pill_w, pill_h)
    }

    fn tick_global_outside_collapse(&mut self, window: &Arc<Window>) {
        let down = is_left_button_pressed();
        let triggered = down && !self.last_global_left_down;
        self.last_global_left_down = down;
        if !triggered || self.is_cursor_inside_pill() {
            return;
        }
        if self.is_realtime_locked() {
            return;
        }

        match self.pill_state {
            PillState::Input => {
                self.input_text.clear();
                self.input_cursor = 0;
                self.ime_preedit.clear();
                self.restore_base();
            }
            PillState::FileReady => {
                self.file_input_text.clear();
                self.file_input_cursor = 0;
                self.dropped_file_path = None;
                self.pending_file_ready = false;
                self.filedrop_state
                    .transition_to(DropPhase::Idle, self.frame_count);
                self.restore_base();
            }
            PillState::ImageEdit => {
                self.clear_image_edit_session(false);
                self.transition_to(PillState::ImagePreview);
            }
            PillState::Thinking
            | PillState::Output
            | PillState::MusicSearch
            | PillState::MusicResults
            | PillState::MusicExpand
            | PillState::ToolPanel
            | PillState::Action
            | PillState::FileAction
            | PillState::VideoAction
            | PillState::ImageAction
            | PillState::ImagePreview
            | PillState::FileProcessing
            | PillState::Processing
            | PillState::ImageProcessing => {
                self.restore_base();
            }
            _ => return,
        }
        window.request_redraw();
    }

    fn pill_rect(&self) -> skia_safe::Rect {
        let left = (self.os_w as f32 - self.spring_w.value) / 2.0;
        let top = PADDING / 2.0;
        skia_safe::Rect::from_xywh(left, top, self.spring_w.value, self.spring_h.value)
    }

    fn tick_tools_panel(&mut self, window: &Arc<Window>) {
        let target_view = if self.pill_state == PillState::ToolPanel {
            1.0
        } else {
            0.0
        };

        let view_diff = target_view - self.tools_view_progress;
        let mut changed = false;
        let panel_lerp = (SPRING_SPLIT.0 + 0.05).clamp(0.10, 0.24);
        if view_diff.abs() > 0.001 {
            self.tools_view_progress += view_diff * panel_lerp;
            changed = true;
        } else {
            self.tools_view_progress = target_view;
        }

        // Keep subtle press-decay channel for stack quick actions.
        for press in &mut self.tool_presses {
            if *press > 0.0 {
                *press = (*press - 0.12).max(0.0);
                changed = true;
            }
        }

        if changed {
            window.request_redraw();
        }
    }

    fn handle_tool_panel_back_tap(&self) -> bool {
        if self.pill_state != PillState::ToolPanel {
            return false;
        }
        let (px, py) = get_global_cursor_pos();
        let rel_x = (px - self.win_x) as f64;
        let rel_y = (py - self.win_y) as f64;
        let rect = self.pill_rect();
        let scale = self.config.global_scale as f64;
        let pad = 16.0 * scale;
        let btn_x = rect.left() as f64 + pad;
        let btn_y = rect.top() as f64 + 16.0 * scale;
        let btn_w = 36.0 * scale;
        let btn_h = 22.0 * scale;
        is_point_in_rect(rel_x, rel_y, btn_x, btn_y, btn_w, btn_h)
    }

    fn handle_tools_panel_tap(&mut self) -> bool {
        if self.pill_state != PillState::ToolPanel {
            return false;
        }
        let Some(action) = self.hit_stack_action() else {
            return false;
        };

        let slot_index = match action {
            StackAction::Music => 0,
            StackAction::Files => 1,
            StackAction::Studio => 2,
            StackAction::Focus => 3,
            StackAction::AudioNotes => 4,
            StackAction::ScreenRecord => 5,
        };
        if let Some(press) = self.tool_presses.get_mut(slot_index) {
            *press = 1.0;
        }
        self.trigger_stack_action(action);
        true
    }

    fn handle_tool_panel_primary_tap(&mut self) -> bool {
        if self.pill_state != PillState::ToolPanel {
            return false;
        }
        if !self.is_cursor_on_stack_primary_card() {
            return false;
        }
        self.restore_last_action_surface()
    }

    fn is_cursor_on_stack_primary_card(&self) -> bool {
        if self.pill_state != PillState::ToolPanel {
            return false;
        }
        let rect = self.pill_rect();
        let scale = self.config.global_scale;
        let (px, py) = get_global_cursor_pos();
        let rel_x = (px - self.win_x) as f32;
        let rel_y = (py - self.win_y) as f32;

        let pad = 16.0 * scale;
        let card_x = rect.left() + pad;
        let card_y = rect.top() + 42.0 * scale;
        let card_w = rect.width() - pad * 2.0;
        let card_h = 82.0 * scale;

        rel_x >= card_x && rel_x <= card_x + card_w && rel_y >= card_y && rel_y <= card_y + card_h
    }

    fn restore_last_action_surface(&mut self) -> bool {
        if self.audio_capture_running {
            self.transition_to(PillState::AudioExpand);
            return true;
        }
        if self.screen_capture_running {
            self.transition_to(PillState::ScreenExpand);
            return true;
        }
        if self.focus_total_ms > 0 {
            self.transition_to(PillState::FocusExpand);
            return true;
        }
        if self.pill_state == PillState::FocusComplete {
            self.transition_to(PillState::FocusComplete);
            return true;
        }
        if self.dropped_file_path.is_some() || !self.dropped_file_paths.is_empty() {
            self.transition_to(PillState::FileReady);
            return true;
        }

        if self.action_is_image
            && (self.action_thumbnail.is_some() || self.action_download_url.is_some())
        {
            self.transition_to(PillState::ImageAction);
            return true;
        }

        if self.action_is_video && self.action_download_url.is_some() {
            self.transition_to(PillState::VideoAction);
            return true;
        }

        if self.action_download_url.is_some() {
            self.transition_to(PillState::FileAction);
            return true;
        }

        if !self.action_text.trim().is_empty() {
            self.transition_to(PillState::Action);
            return true;
        }

        if !self.last_tool_result.trim().is_empty() {
            self.output_text = self.last_tool_result.clone();
            self.transition_to(PillState::Output);
            return true;
        }

        if self.music_current_index.is_some() || !self.music_playlist.is_empty() {
            self.transition_to(PillState::MusicExpand);
            return true;
        }

        false
    }

    fn trigger_stack_action(&mut self, action: StackAction) {
        match action {
            StackAction::Music => {
                self.open_stack_music();
            }
            StackAction::Files => {
                self.open_stack_files();
            }
            StackAction::Studio => {
                self.open_stack_studio();
            }
            StackAction::Focus => {
                self.open_focus_surface();
            }
            StackAction::AudioNotes => {
                self.open_audio_notes_surface();
            }
            StackAction::ScreenRecord => {
                self.open_screen_record_surface();
            }
        }
    }

    fn open_stack_music(&mut self) {
        if self.music_current_index.is_some() || !self.music_playlist.is_empty() {
            self.transition_to(PillState::MusicExpand);
            self.reset_auto_collapse();
            return;
        }

        if !self.music_netease_connection_known {
            self.open_music_auth_surface(true);
            self.refresh_music_connection_status();
            return;
        }

        if !self.music_netease_connected {
            self.open_music_auth_surface(true);
            if self.music_auth_session_id.is_none() {
                music_client::start_auth(self.cmd.tx.clone());
                self.music_auth_status = "starting".to_string();
            }
            self.reset_auto_collapse();
            return;
        }

        if !self.music_results.is_empty() {
            self.transition_to(PillState::MusicResults);
            self.reset_auto_collapse();
            return;
        }

        self.load_music_recommendations();
    }

    fn open_stack_files(&mut self) {
        if self.dropped_file_path.is_some() || !self.dropped_file_paths.is_empty() {
            self.transition_to(PillState::FileReady);
            return;
        }

        if self.action_is_image
            && (self.action_thumbnail.is_some() || self.action_download_url.is_some())
        {
            self.transition_to(PillState::ImageAction);
            return;
        }

        if self.action_is_video && self.action_download_url.is_some() {
            self.transition_to(PillState::VideoAction);
            return;
        }

        if self.action_download_url.is_some() || self.action_requires_download {
            self.transition_to(PillState::FileAction);
            return;
        }

        if let Some(path) = self.open_file_picker(None) {
            self.prepare_file_ready(path);
        }
    }

    fn hit_stack_action(&self) -> Option<StackAction> {
        if self.pill_state != PillState::ToolPanel {
            return None;
        }
        let rect = self.pill_rect();
        let scale = self.config.global_scale;
        let (px, py) = get_global_cursor_pos();
        let rel_x = (px - self.win_x) as f32;
        let rel_y = (py - self.win_y) as f32;
        if rel_x < rect.left()
            || rel_x > rect.right()
            || rel_y < rect.top()
            || rel_y > rect.bottom()
        {
            return None;
        }

        let panel_left = rect.left() + 16.0 * scale;
        let tile_gap = 10.0 * scale;
        let tile_w = ((rect.width() - 32.0 * scale) - tile_gap) * 0.5;
        let tile_h = 60.0 * scale;
        let row1_top = rect.top() + 136.0 * scale;
        let row2_top = row1_top + tile_h + tile_gap;
        let row3_top = row2_top + tile_h + tile_gap;
        let col2_left = panel_left + tile_w + tile_gap;

        if rel_x >= panel_left && rel_x <= panel_left + tile_w {
            if rel_y >= row1_top && rel_y <= row1_top + tile_h {
                return Some(StackAction::Music);
            }
            if rel_y >= row2_top && rel_y <= row2_top + tile_h {
                return Some(StackAction::Studio);
            }
            if rel_y >= row3_top && rel_y <= row3_top + tile_h {
                return Some(StackAction::AudioNotes);
            }
        }
        if rel_x >= col2_left && rel_x <= col2_left + tile_w {
            if rel_y >= row1_top && rel_y <= row1_top + tile_h {
                return Some(StackAction::Files);
            }
            if rel_y >= row2_top && rel_y <= row2_top + tile_h {
                return Some(StackAction::Focus);
            }
            if rel_y >= row3_top && rel_y <= row3_top + tile_h {
                return Some(StackAction::ScreenRecord);
            }
        }
        None
    }

    fn open_stack_studio(&mut self) {
        if self.pill_state == PillState::ImageEdit {
            return;
        }

        if self.current_file_ready_image_path().is_some() {
            if self.open_dropped_image_preview() {
                self.begin_image_edit();
                return;
            }
        }

        if self.action_is_image
            && (self.action_thumbnail.is_some() || self.action_download_url.is_some())
        {
            self.transition_to(PillState::ImagePreview);
            self.begin_image_edit();
            return;
        }

        if self.open_image_preview() {
            self.begin_image_edit();
            return;
        }

        if let Some(path) = self.open_file_picker(Some((
            "Images",
            &["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"],
        ))) {
            self.prepare_file_ready(path);
            if self.open_dropped_image_preview() {
                self.begin_image_edit();
            }
        }
    }

    fn open_file_picker(&self, filter: Option<(&str, &[&str])>) -> Option<String> {
        let mut dialog = rfd::FileDialog::new();
        if let Some((name, exts)) = filter {
            dialog = dialog.add_filter(name, exts);
        }
        dialog.pick_file().map(|p| p.to_string_lossy().to_string())
    }

    fn prepare_file_ready(&mut self, path: String) {
        self.filedrop_state.set_dropped_file(&path);
        self.filedrop_state
            .transition_to(DropPhase::Idle, self.frame_count);
        self.dropped_file_path = Some(path);
        self.dropped_file_paths = self
            .dropped_file_path
            .iter()
            .cloned()
            .collect::<Vec<String>>();
        self.pending_file_ready = false;
        self.file_input_text.clear();
        self.file_input_cursor = 0;
        self.clear_input_file_context();
        self.image_preview_returns_to_file_ready = false;
        self.transition_to(PillState::FileReady);
    }

    fn start_json_executor(&mut self) {
        self.processing_label = "JSON Executor".to_string();
        self.processing_progress = 0.1;
        self.transition_to(PillState::Processing);
        tool_client::run_json_format(self.cmd.tx.clone());
    }

    fn shortcut_modifier_active(&self) -> bool {
        self.modifiers_state.control_key() || self.modifiers_state.super_key()
    }

    fn handle_shortcut(&mut self, key: &Key) -> bool {
        match key {
            Key::Named(NamedKey::Copy) => return self.copy_active_content_to_clipboard(),
            Key::Named(NamedKey::Paste) => return self.paste_clipboard_into_active_input(),
            Key::Named(NamedKey::Cut) => return self.cut_active_input_to_clipboard(),
            _ => {}
        }

        if self.modifiers_state.shift_key() {
            match key {
                Key::Named(NamedKey::Insert) => return self.paste_clipboard_into_active_input(),
                Key::Named(NamedKey::Delete) => return self.cut_active_input_to_clipboard(),
                _ => {}
            }
        }

        if self.modifiers_state.control_key() && matches!(key, Key::Named(NamedKey::Insert)) {
            return self.copy_active_content_to_clipboard();
        }

        if !self.shortcut_modifier_active() {
            return false;
        }

        match shortcut_key_char(key) {
            Some('c') => self.copy_active_content_to_clipboard(),
            Some('v') => self.paste_clipboard_into_active_input(),
            Some('x') => self.cut_active_input_to_clipboard(),
            Some('e') => self.open_image_editor(),
            _ => false,
        }
    }

    fn update_modifiers_from_key(&mut self, key: &Key, state: ElementState) {
        let pressed = state == ElementState::Pressed;
        match key {
            Key::Named(NamedKey::Control) => {
                self.modifiers_state.set(ModifiersState::CONTROL, pressed)
            }
            Key::Named(NamedKey::Shift) => self.modifiers_state.set(ModifiersState::SHIFT, pressed),
            Key::Named(NamedKey::Alt) => self.modifiers_state.set(ModifiersState::ALT, pressed),
            Key::Named(NamedKey::Super) | Key::Named(NamedKey::Meta) => {
                self.modifiers_state.set(ModifiersState::SUPER, pressed)
            }
            _ => {}
        }
    }

    fn paste_clipboard_into_active_input(&mut self) -> bool {
        if !matches!(
            self.pill_state,
            PillState::Input | PillState::FileReady | PillState::ImageEdit | PillState::FocusSetup
        ) {
            return false;
        }

        let text = match clipboard::get_text() {
            Ok(text) => text,
            Err(err) => {
                self.bubble = BubbleState::error(err);
                return true;
            }
        };

        if text.is_empty() {
            self.bubble = BubbleState::error("Clipboard is empty".to_string());
            return true;
        }

        match self.pill_state {
            PillState::Input => {
                self.input_text.insert_str(self.input_cursor, &text);
                self.input_cursor += text.len();
                self.ime_preedit.clear();
            }
            PillState::FileReady => {
                self.file_input_text
                    .insert_str(self.file_input_cursor, &text);
                self.file_input_cursor += text.len();
            }
            PillState::MusicSearch => {
                self.music_search_query
                    .insert_str(self.music_search_cursor, &text);
                self.music_search_cursor += text.len();
            }
            PillState::ImageEdit => {
                self.file_input_text
                    .insert_str(self.file_input_cursor, &text);
                self.file_input_cursor += text.len();
                self.refresh_image_edit_intent();
            }
            PillState::FocusSetup => {
                self.focus_label_text
                    .insert_str(self.focus_label_cursor, &text);
                self.focus_label_cursor += text.len();
            }
            _ => return false,
        }

        self.reset_auto_collapse();
        self.bubble = BubbleState::complete("Pasted from clipboard".to_string(), self.frame_count);
        true
    }

    fn copy_active_content_to_clipboard(&mut self) -> bool {
        let Some(text) = self.active_copy_text() else {
            self.bubble = BubbleState::error("Nothing to copy".to_string());
            return matches!(
                self.pill_state,
                PillState::Input
                    | PillState::FocusSetup
                    | PillState::MusicSearch
                    | PillState::FileReady
                    | PillState::ImageEdit
                    | PillState::Output
                    | PillState::Action
                    | PillState::FileAction
                    | PillState::VideoAction
                    | PillState::ImageAction
                    | PillState::ImagePreview
            );
        };

        match clipboard::set_text(&text) {
            Ok(()) => {
                self.bubble =
                    BubbleState::complete("Copied to clipboard".to_string(), self.frame_count);
            }
            Err(err) => {
                self.bubble = BubbleState::error(err);
            }
        }
        true
    }

    fn cut_active_input_to_clipboard(&mut self) -> bool {
        let text = match self.pill_state {
            PillState::Input if !self.input_text.is_empty() => self.input_text.clone(),
            PillState::MusicSearch if !self.music_search_query.is_empty() => {
                self.music_search_query.clone()
            }
            PillState::FileReady if !self.file_input_text.is_empty() => {
                self.file_input_text.clone()
            }
            PillState::ImageEdit if !self.file_input_text.is_empty() => {
                self.file_input_text.clone()
            }
            PillState::FocusSetup if !self.focus_label_text.is_empty() => {
                self.focus_label_text.clone()
            }
            PillState::Input
            | PillState::FocusSetup
            | PillState::MusicSearch
            | PillState::FileReady
            | PillState::ImageEdit => {
                self.bubble = BubbleState::error("Nothing to cut".to_string());
                return true;
            }
            _ => return false,
        };

        match clipboard::set_text(&text) {
            Ok(()) => {
                match self.pill_state {
                    PillState::Input => {
                        self.input_text.clear();
                        self.input_cursor = 0;
                        self.ime_preedit.clear();
                    }
                    PillState::MusicSearch => {
                        self.music_search_query.clear();
                        self.music_search_cursor = 0;
                    }
                    PillState::FileReady => {
                        self.file_input_text.clear();
                        self.file_input_cursor = 0;
                    }
                    PillState::ImageEdit => {
                        self.file_input_text.clear();
                        self.file_input_cursor = 0;
                        self.refresh_image_edit_intent();
                    }
                    PillState::FocusSetup => {
                        self.focus_label_text.clear();
                        self.focus_label_cursor = 0;
                    }
                    _ => {}
                }
                self.reset_auto_collapse();
                self.bubble =
                    BubbleState::complete("Cut to clipboard".to_string(), self.frame_count);
            }
            Err(err) => {
                self.bubble = BubbleState::error(err);
            }
        }
        true
    }

    fn active_copy_text(&self) -> Option<String> {
        match self.pill_state {
            PillState::Input => non_empty_text(&self.input_text),
            PillState::FocusSetup => non_empty_text(&self.focus_label_text),
            PillState::MusicSearch => non_empty_text(&self.music_search_query),
            PillState::FileReady => non_empty_text(&self.file_input_text),
            PillState::ImageEdit => non_empty_text(&self.file_input_text),
            PillState::Output => non_empty_text(&self.output_text),
            PillState::Action
            | PillState::FileAction
            | PillState::VideoAction
            | PillState::ImageAction
            | PillState::ImagePreview => {
                join_copy_parts(&[self.action_text.as_str(), self.action_detail_text.as_str()])
            }
            _ => None,
        }
    }

    fn handle_key(&mut self, key: &Key, text: Option<&str>) {
        if self.pill_state == PillState::FocusSetup {
            match key {
                Key::Named(NamedKey::Escape) => self.restore_base(),
                Key::Named(NamedKey::Backspace) => {
                    if self.focus_label_cursor > 0 {
                        let bp =
                            prev_char_boundary(&self.focus_label_text, self.focus_label_cursor);
                        self.focus_label_text.remove(bp);
                        self.focus_label_cursor = bp;
                        self.reset_auto_collapse();
                    }
                }
                Key::Named(NamedKey::ArrowLeft) => {
                    self.focus_label_cursor =
                        prev_char_boundary(&self.focus_label_text, self.focus_label_cursor);
                }
                Key::Named(NamedKey::ArrowRight) => {
                    self.focus_label_cursor =
                        next_char_boundary(&self.focus_label_text, self.focus_label_cursor);
                }
                Key::Named(NamedKey::Home) => {
                    self.focus_label_cursor = 0;
                }
                Key::Named(NamedKey::End) => {
                    self.focus_label_cursor = self.focus_label_text.len();
                }
                Key::Named(NamedKey::Enter) => {
                    self.start_focus_session(FocusPhase::Work, self.focus_selected_total_ms);
                }
                _ => {
                    if let Some(s) = text {
                        self.focus_label_text.insert_str(self.focus_label_cursor, s);
                        self.focus_label_cursor += s.len();
                        self.reset_auto_collapse();
                    }
                }
            }
            return;
        }

        if self.pill_state == PillState::FocusExpand {
            match key {
                Key::Named(NamedKey::Escape) => self.restore_base(),
                Key::Named(NamedKey::Enter) | Key::Named(NamedKey::Space) => {
                    if self.focus_running {
                        self.pause_focus_session();
                    } else {
                        self.resume_focus_session();
                    }
                }
                Key::Named(NamedKey::ArrowRight) => self.extend_focus_session(5 * 60 * 1000),
                Key::Named(NamedKey::Delete) => self.skip_focus_session(),
                _ => {}
            }
            return;
        }

        if self.pill_state == PillState::FocusComplete {
            match key {
                Key::Named(NamedKey::Escape) => {
                    self.clear_focus_session(false);
                    self.restore_base();
                }
                Key::Named(NamedKey::Enter) => {
                    if self.focus_completion_kind == FocusCompletionKind::WorkFinished {
                        self.start_focus_break();
                    } else {
                        self.start_focus_next_round();
                    }
                }
                _ => {
                    if let Some(s) = text {
                        if s.eq_ignore_ascii_case("l") {
                            self.log_focus_progress();
                        } else if s.eq_ignore_ascii_case("r") {
                            self.start_focus_next_round();
                        }
                    }
                }
            }
            return;
        }

        if self.pill_state == PillState::MusicAuth {
            match key {
                Key::Named(NamedKey::Escape) => self.restore_base(),
                Key::Named(NamedKey::Enter) | Key::Named(NamedKey::Space) => {
                    self.handle_music_auth_tap();
                }
                _ => {}
            }
            return;
        }

        if self.pill_state == PillState::MusicSearch {
            match key {
                Key::Named(NamedKey::Escape) => {
                    if !self.music_search_query.is_empty() {
                        self.music_search_query.clear();
                        self.music_search_cursor = 0;
                    } else if self.music_current_index.is_some() {
                        self.transition_to(PillState::MusicExpand);
                    } else {
                        self.restore_base();
                    }
                }
                Key::Named(NamedKey::Backspace) => {
                    if self.music_search_cursor > 0 {
                        let bp =
                            prev_char_boundary(&self.music_search_query, self.music_search_cursor);
                        self.music_search_query.remove(bp);
                        self.music_search_cursor = bp;
                        self.reset_auto_collapse();
                    }
                }
                Key::Named(NamedKey::ArrowLeft) => {
                    self.music_search_cursor =
                        prev_char_boundary(&self.music_search_query, self.music_search_cursor);
                }
                Key::Named(NamedKey::ArrowRight) => {
                    self.music_search_cursor =
                        next_char_boundary(&self.music_search_query, self.music_search_cursor);
                }
                Key::Named(NamedKey::Home) => {
                    self.music_search_cursor = 0;
                }
                Key::Named(NamedKey::End) => {
                    self.music_search_cursor = self.music_search_query.len();
                }
                Key::Named(NamedKey::Enter) => {
                    self.submit_music_search();
                }
                _ => {
                    if let Some(s) = text {
                        self.music_search_query
                            .insert_str(self.music_search_cursor, s);
                        self.music_search_cursor += s.len();
                        self.reset_auto_collapse();
                    }
                }
            }
            return;
        }
        if self.pill_state == PillState::MusicExpand {
            match key {
                Key::Named(NamedKey::Escape) => self.restore_base(),
                Key::Named(NamedKey::ArrowLeft) => self.play_music_relative(-1),
                Key::Named(NamedKey::ArrowRight) => self.play_music_relative(1),
                Key::Named(NamedKey::Enter) | Key::Named(NamedKey::Space) => {
                    self.set_music_playback(!self.effective_music_playing());
                }
                _ => {
                    if let Some(s) = text {
                        if s == "/" {
                            self.open_music_search();
                        }
                    }
                }
            }
            return;
        }
        if self.pill_state == PillState::Output {
            match key {
                Key::Named(NamedKey::Escape) => self.restore_base(),
                Key::Named(NamedKey::Enter) => {
                    if self.output_viewport.at_end() {
                        self.transition_to(PillState::Input);
                    } else {
                        self.output_viewport.scroll_to_end();
                    }
                }
                Key::Named(NamedKey::ArrowUp) => {
                    self.scroll_output_by(-output_line_height(self.config.global_scale));
                }
                Key::Named(NamedKey::ArrowDown) => {
                    self.scroll_output_by(output_line_height(self.config.global_scale));
                }
                Key::Named(NamedKey::PageUp) => {
                    self.scroll_output_by(
                        -output_viewport_height(self.config.global_scale, &self.output_text) * 0.82,
                    );
                }
                Key::Named(NamedKey::PageDown) => {
                    self.scroll_output_by(
                        output_viewport_height(self.config.global_scale, &self.output_text) * 0.82,
                    );
                }
                Key::Named(NamedKey::Home) => {
                    self.output_viewport
                        .scroll_by(-self.output_viewport.max_scroll);
                }
                Key::Named(NamedKey::End) => {
                    self.output_viewport.scroll_to_end();
                }
                _ => {}
            }
            return;
        }
        if self.pill_state == PillState::FileReady {
            self.handle_file_key(key, text);
            return;
        }
        if self.pill_state == PillState::ImageEdit {
            self.handle_image_edit_key(key, text);
            return;
        }
        match key {
            Key::Named(NamedKey::Escape) => {
                if !self.input_text.is_empty() {
                    self.input_text.clear();
                    self.input_cursor = 0;
                } else if self.input_file_context_active {
                    self.clear_input_file_context();
                    self.transition_to(PillState::FileReady);
                } else {
                    self.restore_base();
                }
            }
            Key::Named(NamedKey::Backspace) => {
                if self.input_cursor > 0 {
                    let byte_pos = prev_char_boundary(&self.input_text, self.input_cursor);
                    self.input_text.remove(byte_pos);
                    self.input_cursor = byte_pos;
                    self.reset_auto_collapse();
                }
            }
            Key::Named(NamedKey::ArrowLeft) => {
                self.input_cursor = prev_char_boundary(&self.input_text, self.input_cursor);
            }
            Key::Named(NamedKey::ArrowRight) => {
                self.input_cursor = next_char_boundary(&self.input_text, self.input_cursor);
            }
            Key::Named(NamedKey::Home) => {
                self.input_cursor = 0;
            }
            Key::Named(NamedKey::End) => {
                self.input_cursor = self.input_text.len();
            }
            Key::Named(NamedKey::Enter) => {
                if !self.input_text.is_empty() {
                    if self.modifiers_state.shift_key() {
                        self.input_text.insert(self.input_cursor, '\n');
                        self.input_cursor += '\n'.len_utf8();
                        self.reset_auto_collapse();
                        return;
                    }
                    if self.submit_input_file_context() {
                        return;
                    }
                    let msg = std::mem::take(&mut self.input_text);
                    self.input_cursor = 0;
                    self.suppress_ai_updates = false;
                    self.output_viewport.reset();
                    if self.handle_music_text_command(&msg) {
                        return;
                    }
                    if let Some(query) = Self::parse_music_query(&msg) {
                        self.music_search_query = query.clone();
                        self.music_search_cursor = self.music_search_query.len();
                        self.submit_music_search();
                        return;
                    }
                    self.ai_state = AiState::Thinking;
                    self.snippet_text.clear();
                    self.output_text.clear();
                    self.processing_label = "Understanding task".to_string();
                    self.processing_progress = 0.18;
                    self.bubble = BubbleState::default();
                    ai_client::send_chat(msg, self.cmd.tx.clone());
                    self.transition_to(PillState::Processing);
                }
            }
            _ => {
                if let Some(s) = text {
                    self.input_text.insert_str(self.input_cursor, s);
                    self.input_cursor += s.len();
                    self.reset_auto_collapse();
                }
            }
        }
    }

    fn handle_file_key(&mut self, key: &Key, text: Option<&str>) {
        match key {
            Key::Named(NamedKey::Escape) => {
                self.file_input_text.clear();
                self.file_input_cursor = 0;
                self.dropped_file_path = None;
                self.dropped_file_paths.clear();
                self.pending_file_ready = false;
                self.image_preview_returns_to_file_ready = false;
                self.filedrop_state
                    .transition_to(DropPhase::Idle, self.frame_count);
                self.restore_base();
            }
            Key::Named(NamedKey::Backspace) => {
                if self.file_input_cursor > 0 {
                    let bp = prev_char_boundary(&self.file_input_text, self.file_input_cursor);
                    self.file_input_text.remove(bp);
                    self.file_input_cursor = bp;
                    self.reset_auto_collapse();
                }
            }
            Key::Named(NamedKey::ArrowLeft) => {
                self.file_input_cursor =
                    prev_char_boundary(&self.file_input_text, self.file_input_cursor);
            }
            Key::Named(NamedKey::ArrowRight) => {
                self.file_input_cursor =
                    next_char_boundary(&self.file_input_text, self.file_input_cursor);
            }
            Key::Named(NamedKey::Home) => {
                self.file_input_cursor = 0;
            }
            Key::Named(NamedKey::End) => {
                self.file_input_cursor = self.file_input_text.len();
            }
            Key::Named(NamedKey::Enter) => {
                if self.modifiers_state.shift_key() {
                    self.file_input_text.insert(self.file_input_cursor, '\n');
                    self.file_input_cursor += '\n'.len_utf8();
                    self.reset_auto_collapse();
                    return;
                }
                self.submit_file_ready();
            }
            _ => {
                if let Some(s) = text {
                    self.file_input_text.insert_str(self.file_input_cursor, s);
                    self.file_input_cursor += s.len();
                    self.reset_auto_collapse();
                }
            }
        }
    }

    fn submit_file_ready(&mut self) {
        let instruction = std::mem::take(&mut self.file_input_text);
        self.file_input_cursor = 0;
        let selected_paths = if self.dropped_file_paths.is_empty() {
            self.dropped_file_path
                .clone()
                .into_iter()
                .collect::<Vec<String>>()
        } else {
            self.dropped_file_paths.clone()
        };
        let Some(path) = selected_paths.first().cloned() else {
            self.output_text = "No file selected".to_string();
            self.transition_to(PillState::Output);
            return;
        };
        self.processing_label = "Processing file".to_string();
        self.processing_progress = 0.0;
        self.action_download_url = None;
        self.action_requires_download = false;
        self.action_downloading = false;
        self.action_thumbnail = None;
        self.action_image_aspect_ratio = None;
        self.action_saved_path = None;
        self.action_is_image = false;
        self.action_is_video = false;
        self.action_detail_text.clear();
        self.action_editor_url = None;
        self.image_preview_returns_to_file_ready = false;
        self.transition_to(PillState::FileProcessing);
        if selected_paths.len() > 1 {
            crate::core::file_client::process_files(
                selected_paths,
                instruction,
                self.cmd.tx.clone(),
            );
        } else {
            crate::core::file_client::process_file(path, instruction, self.cmd.tx.clone());
        }
    }

    fn clear_input_file_context(&mut self) {
        self.input_file_context_active = false;
    }

    fn submit_input_file_context(&mut self) -> bool {
        if !self.input_file_context_active {
            return false;
        }
        let instruction = std::mem::take(&mut self.input_text);
        self.input_cursor = 0;
        let selected_paths = if self.dropped_file_paths.is_empty() {
            self.dropped_file_path
                .clone()
                .into_iter()
                .collect::<Vec<String>>()
        } else {
            self.dropped_file_paths.clone()
        };
        let Some(path) = selected_paths.first().cloned() else {
            self.clear_input_file_context();
            self.output_text = "No transcript selected".to_string();
            self.transition_to(PillState::Output);
            return true;
        };
        self.clear_input_file_context();
        self.processing_label = "Processing file".to_string();
        self.processing_progress = 0.0;
        self.action_download_url = None;
        self.action_requires_download = false;
        self.action_downloading = false;
        self.action_thumbnail = None;
        self.action_image_aspect_ratio = None;
        self.action_saved_path = None;
        self.action_is_image = false;
        self.action_is_video = false;
        self.action_detail_text.clear();
        self.action_editor_url = None;
        self.image_preview_returns_to_file_ready = false;
        self.transition_to(PillState::FileProcessing);
        if selected_paths.len() > 1 {
            crate::core::file_client::process_files(
                selected_paths,
                instruction,
                self.cmd.tx.clone(),
            );
        } else {
            crate::core::file_client::process_file(path, instruction, self.cmd.tx.clone());
        }
        true
    }

    fn reset_auto_collapse(&mut self) {
        if self.active_since.is_some() {
            self.active_since = Some(Instant::now());
        }
    }

    fn is_music_active(&self) -> bool {
        if !self.config.smtc_enabled {
            return false;
        }
        let mut media = self.smtc.get_info();
        self.fill_local_media_fallback(&mut media);
        if media.title.is_empty() {
            return false;
        }
        media.is_playing
            || self.local_music_playing
            || self.last_playing_time.elapsed() < Duration::from_secs(5)
    }

    fn fill_local_media_fallback(&self, media: &mut crate::core::smtc::MediaInfo) {
        let Some(index) = self.music_current_index else {
            return;
        };
        let Some(song) = self.music_playlist.get(index) else {
            return;
        };
        let same_track = media.title.trim().is_empty()
            || (media.title == song.name
                && (media.artist.trim().is_empty() || media.artist == song.artist));

        if !same_track && !media.title.trim().is_empty() {
            return;
        }

        if media.title.trim().is_empty() {
            media.title = song.name.clone();
        }
        if media.artist.trim().is_empty() {
            media.artist = song.artist.clone();
        }
        if media.album.trim().is_empty() {
            media.album = song.album.clone();
        }
        if same_track {
            media.is_playing = self.local_music_playing;
            media.position_ms = self.current_local_playback_position_ms();
            media.last_update = Instant::now();
        }
        if let Some(bytes) = self.music_cover_bytes.as_ref() {
            if media.thumbnail.is_none() || same_track {
                media.thumbnail = Some(bytes.clone());
            }
        }
        if self.local_lyrics_title == song.name && self.local_lyrics_artist == song.artist {
            if media.lyrics.is_none() || same_track {
                media.lyrics = self.local_media_lyrics.clone();
            }
        }
    }

    fn current_local_playback_position_ms(&self) -> u64 {
        let mut pos = self.local_playback_base_ms;
        if self.local_music_playing {
            if let Some(anchor) = self.local_playback_anchor {
                pos = pos.saturating_add(anchor.elapsed().as_millis() as u64);
            }
        }
        pos
    }

    fn current_music_duration_ms(&self) -> u64 {
        self.music_current_index
            .and_then(|index| self.music_playlist.get(index))
            .map(|song| song.duration.saturating_mul(1000))
            .unwrap_or(0)
    }

    fn current_music_progress_fraction(&self) -> f32 {
        let duration = self.current_music_duration_ms();
        if duration == 0 {
            return 0.0;
        }
        (self.current_local_playback_position_ms() as f32 / duration as f32).clamp(0.0, 1.0)
    }

    fn effective_music_playing(&self) -> bool {
        if !self.last_media_title.is_empty() {
            self.last_media_playing
        } else {
            self.local_music_playing
        }
    }

    fn tick_music_transition(&mut self, window: &Arc<Window>) {
        if self.music_transition_pulse <= 0.001 {
            if self.music_transition_pulse != 0.0 {
                self.music_transition_pulse = 0.0;
            }
            return;
        }
        self.music_transition_pulse = (self.music_transition_pulse * 0.88) - 0.015;
        if self.music_transition_pulse < 0.0 {
            self.music_transition_pulse = 0.0;
        }
        window.request_redraw();
    }

    fn fetch_music_cover(&mut self, song: &MusicSearchResult) {
        if song.cover.trim().is_empty() {
            return;
        }
        if let Some(bytes) = self.music_result_cover_bytes.get(&song.id) {
            if self.music_current_song_id == Some(song.id) {
                self.music_cover_bytes = Some(bytes.clone());
            }
            return;
        }
        if self.music_result_cover_images.contains_key(&song.id)
            || self.music_cover_requests_inflight.contains(&song.id)
        {
            return;
        }
        self.music_cover_requests_inflight.insert(song.id);
        let tx = self.cmd.tx.clone();
        let cover_url = song.cover.clone();
        let song_id = song.id;
        std::thread::spawn(move || {
            let Ok(resp) = ureq::get(&cover_url).call() else {
                return;
            };
            let mut reader = resp.into_reader();
            let mut bytes = Vec::new();
            if std::io::Read::read_to_end(&mut reader, &mut bytes).is_ok() && !bytes.is_empty() {
                let _ = tx.send(Command::MusicCoverReady { song_id, bytes });
            }
        });
    }

    fn check_auto_collapse(&mut self, window: &Arc<Window>) {
        let Some(since) = self.active_since else {
            return;
        };
        match self.pill_state {
            PillState::Output => {
                // Keep long-form responses stable for reading and manual scrolling.
            }
            PillState::Action => {
                if since.elapsed() >= Duration::from_millis(self.config.auto_collapse_ms) {
                    self.restore_base();
                    window.request_redraw();
                }
            }
            PillState::FileAction => {
                // Keep document results persistent until explicit dismissal.
            }
            PillState::VideoAction => {
                // Keep video results persistent until explicit dismissal.
            }
            PillState::ImageAction => {
                // Keep image result persistent until explicit user action.
            }
            PillState::MusicSearch | PillState::MusicResults | PillState::MusicExpand => {
                if since.elapsed() >= Duration::from_millis(self.config.auto_collapse_ms) {
                    self.restore_base();
                    window.request_redraw();
                }
            }
            PillState::FocusSetup
            | PillState::FocusExpand
            | PillState::AudioExpand
            | PillState::ScreenExpand => {
                if since.elapsed() >= Duration::from_millis(self.config.auto_collapse_ms) {
                    self.restore_base();
                    window.request_redraw();
                }
            }
            PillState::FocusComplete => {
                if since.elapsed() >= Duration::from_millis(self.config.auto_collapse_ms) {
                    self.clear_focus_session(false);
                    self.restore_base();
                    window.request_redraw();
                }
            }
            PillState::ToolPanel => {
                if since.elapsed() >= Duration::from_millis(self.config.auto_collapse_ms) {
                    self.restore_base();
                    window.request_redraw();
                }
            }
            _ => {}
        }
    }

    fn update_content_transition(&mut self) {
        if self.content_delay_frames > 0 {
            self.content_delay_frames -= 1;
            return;
        }
        if self.content_opacity < 1.0 {
            self.content_opacity += (1.0 - self.content_opacity) * SPRING_CONTENT.0;
            self.content_opacity = self.content_opacity.min(1.0);
        }
        if self.content_scale < 1.0 {
            self.content_scale += (1.0 - self.content_scale) * (SPRING_CONTENT.0 * 0.8);
            self.content_scale = self.content_scale.min(1.0);
        }
    }

    fn update_idle_hover(&mut self, window: &Arc<Window>) {
        let target = if self.pill_state == PillState::Idle && !self.is_realtime_locked() {
            let (px, py) = get_global_cursor_pos();
            let rel_x = (px - self.win_x) as f64;
            let rel_y = (py - self.win_y) as f64;
            let offset_x = (self.os_w as f64 - self.spring_w.value as f64) / 2.0;
            let top = PADDING as f64 / 2.0;
            let hot = 24.0 * self.config.global_scale as f64;
            let in_hot_zone = is_point_in_rect(
                rel_x,
                rel_y,
                offset_x - hot,
                top - hot,
                self.spring_w.value as f64 + hot * 2.0,
                self.spring_h.value as f64 + hot * 2.0,
            );
            if in_hot_zone {
                1.0
            } else {
                0.0
            }
        } else {
            0.0
        };

        let factor = if target > self.idle_hover_progress {
            0.20
        } else {
            0.25
        };
        let next = self.idle_hover_progress + (target - self.idle_hover_progress) * factor;
        if (next - self.idle_hover_progress).abs() > 0.001 {
            self.idle_hover_progress = next;
            window.request_redraw();
        } else {
            self.idle_hover_progress = target;
        }
    }

    fn do_draw(&mut self) {
        let scale = self.config.global_scale;
        let music_state = if self.is_music_active() {
            let mut media = self.smtc.get_info();
            self.fill_local_media_fallback(&mut media);
            media.spectrum = self.audio.get_spectrum();
            Some(music::MusicSceneState {
                is_playing: media.is_playing,
                spectrum: media.spectrum,
                media,
            })
        } else {
            None
        };
        let input_file_context_name = if self.input_file_context_active {
            self.active_input_file_context_name()
        } else {
            String::new()
        };

        let data = FrameData {
            pill_state: &self.pill_state,
            content_opacity: self.content_opacity,
            content_scale: self.content_scale,
            reduce_motion: !self.config.motion_blur,
            state_elapsed_ms: self
                .active_since
                .map(|since| since.elapsed().as_millis() as u64)
                .unwrap_or(0),
            idle_hover_progress: self.idle_hover_progress,
            ai_state: &self.ai_state,
            frame_count: self.frame_count,
            input_text: &self.input_text,
            input_cursor: self.input_cursor,
            input_preedit: &self.ime_preedit,
            input_file_context_active: self.input_file_context_active,
            input_file_context_name: &input_file_context_name,
            output_text: &self.output_text,
            output_scroll_offset: self.output_viewport.scroll_offset,
            output_at_end: self.output_viewport.at_end(),
            tools_view_progress: self.tools_view_progress,
            tool_presses: &self.tool_presses,
            filedrop_state: &self.filedrop_state,
            processing_progress: self.processing_progress,
            processing_label: &self.processing_label,
            last_tool_name: &self.last_tool_name,
            last_tool_result: &self.last_tool_result,
            file_input_text: &self.file_input_text,
            file_input_cursor: self.file_input_cursor,
            dropped_file_count: self
                .dropped_file_paths
                .len()
                .max(self.dropped_file_path.is_some() as usize),
            file_ready_image_available: self.current_file_ready_image_path().is_some(),
            file_ready_audio_available: self.current_file_ready_audio_path().is_some(),
            file_ready_text_available: self.current_file_ready_text_path().is_some(),
            music_state: music_state.as_ref(),
            music_searching: self.music_searching,
            music_query: &self.music_search_query,
            music_search_cursor: self.music_search_cursor,
            music_results: &self.music_results,
            music_results_context_label: &self.music_results_context_label,
            music_result_cover_images: &self.music_result_cover_images,
            music_results_scroll: self.music_results_scroll,
            music_queue_len: self.music_playlist.len(),
            music_current_index: self.music_current_index,
            music_netease_connected: self.music_netease_connected,
            music_netease_account_name: &self.music_netease_account_name,
            music_auth_status: &self.music_auth_status,
            music_auth_qr_image: self.music_auth_qr_image.as_ref(),
            music_elapsed_ms: self.current_local_playback_position_ms(),
            music_duration_ms: self.current_music_duration_ms(),
            music_transition_pulse: self.music_transition_pulse,
            current_lyric: &self.current_lyric_text,
            old_lyric: &self.old_lyric_text,
            lyric_transition: self.lyric_transition,
            bubble: &self.bubble,
            is_pressing: self.is_pressing,
            action_text: &self.action_text,
            action_file_name: &self.action_file_name,
            action_progress: self.action_progress,
            action_requires_download: self.action_requires_download,
            action_downloading: self.action_downloading,
            action_thumbnail: self.action_thumbnail.as_ref(),
            action_is_image: self.action_is_image,
            action_is_video: self.action_is_video,
            action_detail_text: &self.action_detail_text,
            action_editor_available: self.action_editor_url.is_some(),
            focus_phase: self.focus_phase,
            focus_completion_kind: self.focus_completion_kind,
            focus_total_ms: self.focus_total_ms,
            focus_remaining_ms: self.focus_remaining_ms,
            focus_selected_total_ms: self.focus_selected_total_ms,
            focus_running: self.focus_running,
            focus_label_text: &self.focus_label_text,
            focus_label_cursor: self.focus_label_cursor,
            focus_rounds_completed: self.focus_rounds_completed,
            audio_capture_running: self.audio_capture_running,
            audio_capture_elapsed_ms: self.current_audio_capture_elapsed_ms(),
            screen_capture_running: self.screen_capture_running,
            screen_capture_elapsed_ms: self.current_screen_capture_elapsed_ms(),
            image_edit_prompt: &self.file_input_text,
            image_edit_cursor: self.file_input_cursor,
            image_edit_tool: self.image_edit_tool,
            image_edit_brush_mode: self.image_edit_brush_mode,
            image_edit_outpaint_preset: self.image_edit_outpaint_preset,
            image_edit_has_mask: !self.image_edit_mask_strokes.is_empty()
                || self.image_edit_current_stroke.is_some(),
            image_edit_mask_preview: self.image_edit_mask_preview.as_ref(),
            image_edit_mask_strokes: &self.image_edit_mask_strokes,
        };

        let Some(surface) = self.surface.as_mut() else {
            return;
        };
        draw_island(
            surface,
            self.spring_w.value,
            self.spring_h.value,
            self.spring_r.value,
            self.os_w,
            self.os_h,
            self.border_weights,
            scale,
            &data,
        );
    }

    fn poll_tray(&mut self, window: &Arc<Window>, event_loop: &ActiveEventLoop) {
        let Some(tray) = &self.tray else { return };
        if let Some(action) = tray.poll_action() {
            match action {
                TrayAction::ToggleVisibility => {
                    self.visible = !self.visible;
                    window.set_visible(self.visible);
                    tray.update_item_text(self.visible);
                }
                TrayAction::OpenSettings => {
                    let _ = std::process::Command::new(std::env::current_exe().unwrap())
                        .arg("--settings")
                        .spawn();
                }
                TrayAction::Exit => {
                    event_loop.exit();
                }
            }
        }
    }

    fn poll_commands(&mut self, window: &Arc<Window>, event_loop: &ActiveEventLoop) {
        while let Some(cmd) = self.cmd.try_recv() {
            match cmd {
                Command::Expand => {
                    self.transition_to(PillState::Input);
                }
                Command::Collapse => {
                    self.transition_to(PillState::Idle);
                }
                Command::ClipboardPaste => {
                    if self.paste_clipboard_into_active_input() {
                        window.request_redraw();
                    }
                }
                Command::ClipboardCopy => {
                    if self.copy_active_content_to_clipboard() {
                        window.request_redraw();
                    }
                }
                Command::ClipboardCut => {
                    if self.cut_active_input_to_clipboard() {
                        window.request_redraw();
                    }
                }
                Command::ContextAction => {
                    if self.perform_context_action() {
                        window.request_redraw();
                    }
                }
                Command::OpenImagePreview => {
                    if self.open_image_preview() {
                        window.request_redraw();
                    }
                }
                Command::BeginImageEdit => {
                    if self.pill_state == PillState::ImagePreview {
                        self.begin_image_edit();
                        window.request_redraw();
                    }
                }
                Command::ImageEditSelectTool { tool } => {
                    if self.pill_state == PillState::ImageEdit
                        && self.set_image_edit_tool_from_label(&tool)
                    {
                        window.request_redraw();
                    }
                }
                Command::ImageEditSetPrompt { text } => {
                    if self.pill_state == PillState::ImageEdit {
                        self.set_image_edit_prompt_text(text);
                        window.request_redraw();
                    }
                }
                Command::ImageEditAddMaskRect {
                    left_norm,
                    top_norm,
                    width_norm,
                    height_norm,
                } => {
                    if self.pill_state == PillState::ImageEdit {
                        self.add_image_edit_mask_rect(left_norm, top_norm, width_norm, height_norm);
                        window.request_redraw();
                    }
                }
                Command::ImageEditApply => {
                    if self.pill_state == PillState::ImageEdit {
                        self.apply_image_edit();
                        window.request_redraw();
                    }
                }
                Command::OpenStack => {
                    self.tools_view_progress = 0.0;
                    self.transition_to(PillState::ToolPanel);
                }
                Command::WriteDebugState { path } => {
                    self.write_debug_state(&path);
                }
                Command::Shutdown => {
                    event_loop.exit();
                    return;
                }
                Command::ProcessFile { path, instruction } => {
                    let trimmed_path = path.trim().to_string();
                    if trimmed_path.is_empty() {
                        self.output_text = "Missing file path".to_string();
                        self.transition_to(PillState::Output);
                        continue;
                    }
                    let display_name = Path::new(&trimmed_path)
                        .file_name()
                        .and_then(|s| s.to_str())
                        .filter(|s| !s.is_empty())
                        .unwrap_or("file")
                        .to_string();
                    self.remember_last_tool_result(
                        "file.upload".to_string(),
                        format!("Queued: {display_name}"),
                    );
                    self.prepare_file_ready(trimmed_path.clone());
                    self.processing_label = "Processing file".to_string();
                    self.processing_progress = 0.0;
                    self.action_download_url = None;
                    self.action_requires_download = false;
                    self.action_downloading = false;
                    self.action_thumbnail = None;
                    self.action_image_aspect_ratio = None;
                    self.action_saved_path = None;
                    self.action_is_image = false;
                    self.action_is_video = false;
                    self.action_detail_text.clear();
                    self.action_editor_url = None;
                    self.transition_to(PillState::FileProcessing);
                    crate::core::file_client::process_file(
                        trimmed_path,
                        instruction,
                        self.cmd.tx.clone(),
                    );
                }
                Command::PrepareFileReady { path } => {
                    let trimmed_path = path.trim().to_string();
                    if trimmed_path.is_empty() {
                        self.output_text = "Missing file path".to_string();
                        self.transition_to(PillState::Output);
                        continue;
                    }
                    let display_name = Path::new(&trimmed_path)
                        .file_name()
                        .and_then(|s| s.to_str())
                        .filter(|s| !s.is_empty())
                        .unwrap_or("file")
                        .to_string();
                    self.remember_last_tool_result(
                        "file.upload".to_string(),
                        format!("Queued: {display_name}"),
                    );
                    self.prepare_file_ready(trimmed_path);
                    window.request_redraw();
                }
                Command::ActivateFileReadyQuickAction => {
                    if self.pill_state == PillState::FileReady {
                        if self.current_file_ready_audio_path().is_some() {
                            self.start_file_ready_audio_transcription();
                        } else {
                            self.start_file_ready_text_follow_up();
                        }
                        window.request_redraw();
                    }
                }
                Command::SubmitFileReady => {
                    if self.pill_state == PillState::FileReady {
                        self.submit_file_ready();
                        window.request_redraw();
                    }
                }
                Command::SubmitFileReadyWithInstruction { instruction } => {
                    if self.pill_state == PillState::FileReady {
                        self.file_input_text = instruction;
                        self.file_input_cursor = self.file_input_text.len();
                        self.submit_file_ready();
                        window.request_redraw();
                    }
                }
                Command::SubmitInputWithText { text } => {
                    if self.pill_state == PillState::Input {
                        self.input_text = text;
                        self.input_cursor = self.input_text.len();
                        if self.submit_input_file_context() {
                            window.request_redraw();
                            continue;
                        }
                        let msg = std::mem::take(&mut self.input_text);
                        self.input_cursor = 0;
                        self.suppress_ai_updates = false;
                        self.output_viewport.reset();
                        if self.handle_music_text_command(&msg) {
                            window.request_redraw();
                            continue;
                        }
                        if let Some(query) = Self::parse_music_query(&msg) {
                            self.music_search_query = query.clone();
                            self.music_search_cursor = self.music_search_query.len();
                            self.submit_music_search();
                            window.request_redraw();
                            continue;
                        }
                        self.ai_state = AiState::Thinking;
                        self.snippet_text.clear();
                        self.output_text.clear();
                        self.processing_label = "Understanding task".to_string();
                        self.processing_progress = 0.18;
                        self.bubble = BubbleState::default();
                        ai_client::send_chat(msg, self.cmd.tx.clone());
                        self.transition_to(PillState::Processing);
                        window.request_redraw();
                    }
                }
                Command::ProcessFiles { paths, instruction } => {
                    let trimmed_paths = paths
                        .into_iter()
                        .map(|path| path.trim().to_string())
                        .filter(|path| !path.is_empty())
                        .collect::<Vec<String>>();
                    if trimmed_paths.is_empty() {
                        self.output_text = "Missing file paths".to_string();
                        self.transition_to(PillState::Output);
                        continue;
                    }
                    let lead_name = Path::new(&trimmed_paths[0])
                        .file_name()
                        .and_then(|s| s.to_str())
                        .filter(|s| !s.is_empty())
                        .unwrap_or("file")
                        .to_string();
                    let queued_label = if trimmed_paths.len() == 1 {
                        format!("Queued: {lead_name}")
                    } else {
                        format!("Queued: {lead_name} +{}", trimmed_paths.len() - 1)
                    };
                    self.remember_last_tool_result("file.upload".to_string(), queued_label);
                    self.filedrop_state.set_dropped_file(&trimmed_paths[0]);
                    self.dropped_file_path = Some(trimmed_paths[0].clone());
                    self.dropped_file_paths = trimmed_paths.clone();
                    self.file_input_text = instruction.clone();
                    self.file_input_cursor = self.file_input_text.len();
                    self.processing_label = "Processing files".to_string();
                    self.processing_progress = 0.0;
                    self.action_download_url = None;
                    self.action_requires_download = false;
                    self.action_downloading = false;
                    self.action_thumbnail = None;
                    self.action_image_aspect_ratio = None;
                    self.action_saved_path = None;
                    self.action_is_image = false;
                    self.action_is_video = false;
                    self.action_detail_text.clear();
                    self.action_editor_url = None;
                    self.transition_to(PillState::FileProcessing);
                    crate::core::file_client::process_files(
                        trimmed_paths,
                        instruction,
                        self.cmd.tx.clone(),
                    );
                }
                Command::AiUpdate {
                    ref state,
                    ref snippet,
                } => {
                    if self.suppress_ai_updates {
                        if *state == AiState::Thinking {
                            self.suppress_ai_updates = false;
                        } else {
                            continue;
                        }
                    }
                    self.ai_state = state.clone();
                    self.bubble = BubbleState::default();
                    if let Some(ref t) = snippet {
                        self.snippet_text = t.clone();
                    }
                    match state {
                        AiState::Thinking => {
                            self.processing_label = "Understanding task".to_string();
                            self.processing_progress = self.processing_progress.max(0.24);
                            if self.pill_state != PillState::Processing {
                                self.transition_to(PillState::Processing);
                            }
                        }
                        AiState::Streaming => {
                            if let Some(ref t) = snippet {
                                self.output_text = t.clone();
                                self.update_output_viewport_metrics();
                            }
                            if self.output_text.trim().is_empty() {
                                self.processing_label = "ai.reasoning".to_string();
                                self.processing_progress = self.processing_progress.max(0.72);
                                if self.pill_state != PillState::Processing {
                                    self.transition_to(PillState::Processing);
                                }
                            } else if self.pill_state != PillState::Output {
                                self.transition_to(PillState::Output);
                            }
                        }
                        AiState::Complete => {
                            if let Some(ref t) = snippet {
                                self.output_text = t.clone();
                            }
                            if self.output_text.trim().is_empty() {
                                self.output_text = "Result is ready.".to_string();
                            }
                            self.update_output_viewport_metrics();
                            self.transition_to(PillState::Output);
                        }
                        AiState::Error => {
                            self.output_text = snippet.clone().unwrap_or("Error".to_string());
                            self.update_output_viewport_metrics();
                            self.transition_to(PillState::Output);
                        }
                        _ => {}
                    }
                }
                Command::ShowNotification {
                    title,
                    body,
                    ttl_ms: _,
                } => {
                    let text = format!("{}: {}", title, body);
                    self.bubble = BubbleState::complete(text, self.frame_count);
                }
                Command::ToolProgress {
                    name,
                    progress,
                    status,
                } => {
                    self.processing_label = name;
                    self.processing_progress = progress;
                    let image_flow = is_image_processing_label(&self.processing_label);
                    match status {
                        ToolStatus::Running => {
                            let target = if image_flow {
                                PillState::ImageProcessing
                            } else {
                                PillState::Processing
                            };
                            if self.pill_state != target {
                                self.transition_to(target);
                            }
                        }
                        ToolStatus::Complete => {
                            let done_text = tool_complete_text(&self.processing_label);
                            self.remember_last_tool_result(
                                self.processing_label.clone(),
                                done_text.clone(),
                            );
                            self.action_text = done_text;
                            self.action_progress = 1.0;
                            self.action_requires_download = false;
                            self.action_downloading = false;
                            self.action_thumbnail = None;
                            self.action_image_aspect_ratio = None;
                            self.action_saved_path = None;
                            self.action_is_image = image_flow;
                            self.action_is_video = false;
                            self.action_detail_text.clear();
                            self.action_editor_url = None;
                            self.image_preview_returns_to_file_ready = false;
                            let target = if self.action_is_image {
                                PillState::ImageAction
                            } else {
                                PillState::Action
                            };
                            self.transition_to(target);
                        }
                        ToolStatus::Error => {
                            let failed_text = format!("{} failed", self.processing_label);
                            self.remember_last_tool_result(
                                self.processing_label.clone(),
                                failed_text.clone(),
                            );
                            self.output_text = failed_text;
                            self.transition_to(PillState::Output);
                        }
                    }
                }
                Command::FileProcessed {
                    label,
                    file_name,
                    download_url,
                    aspect_ratio,
                    preview_url,
                    editor_url,
                    detail_text,
                } => {
                    if label
                        .trim()
                        .eq_ignore_ascii_case("audio.transcribe_text complete")
                    {
                        self.remember_last_tool_result(
                            label.clone(),
                            format!("Transcript ready: {file_name}"),
                        );
                        self.prepare_file_ready(download_url);
                        self.bubble = BubbleState::complete(
                            "Transcript ready".to_string(),
                            self.frame_count,
                        );
                        window.request_redraw();
                        continue;
                    }
                    if label.trim().eq_ignore_ascii_case("text.process complete") {
                        let rendered = fs::read_to_string(&download_url)
                            .ok()
                            .map(|text| text.trim().to_string())
                            .filter(|text| !text.is_empty())
                            .unwrap_or_else(|| format!("Text result ready: {file_name}"));
                        self.remember_last_tool_result(label.clone(), rendered.clone());
                        self.output_text = rendered;
                        self.transition_to(PillState::Output);
                        window.request_redraw();
                        continue;
                    }
                    let capture_report_flow = is_capture_summary_report_label(&label);
                    let image_flow = !capture_report_flow
                        && (is_image_file_name(&file_name) || is_image_processing_label(&label));
                    let video_flow = !capture_report_flow
                        && (is_video_file_name(&file_name) || is_video_processing_label(&label));
                    let studio_flow = label.trim() == "image.iopaint_studio";
                    let capture_report_copy = capture_summary_report_copy(&label);
                    self.action_text = if capture_report_flow {
                        capture_report_copy.0.to_string()
                    } else if studio_flow {
                        "Studio ready".to_string()
                    } else if image_flow {
                        "Image ready".to_string()
                    } else if video_flow {
                        "Video ready".to_string()
                    } else {
                        "File ready".to_string()
                    };
                    let result_summary = if capture_report_flow {
                        capture_report_copy.1.to_string()
                    } else if studio_flow {
                        "Studio source loaded. Tap to preview, then open Studio.".to_string()
                    } else if image_flow {
                        "Image ready. Tap to preview.".to_string()
                    } else if video_flow {
                        "Video ready. Tap download to save.".to_string()
                    } else {
                        "File processed. Tap download to save.".to_string()
                    };
                    self.remember_last_tool_result(label.clone(), result_summary);
                    self.action_progress = 0.0;
                    self.action_file_name = file_name;
                    self.action_download_url = Some(download_url.clone());
                    self.action_requires_download = !studio_flow;
                    self.action_downloading = false;
                    self.action_saved_path = None;
                    self.action_is_image = image_flow;
                    self.action_is_video = video_flow;
                    self.action_detail_text = detail_text.unwrap_or_else(|| {
                        if capture_report_flow {
                            capture_report_copy.2.to_string()
                        } else {
                            String::new()
                        }
                    });
                    self.image_preview_returns_to_file_ready = false;
                    self.action_editor_url = if image_flow {
                        editor_url.or_else(|| {
                            preview_url
                                .clone()
                                .or_else(|| Some(download_url.clone()))
                                .map(|value| {
                                    build_iopaint_studio_url(&resolve_local_api_url(&value))
                                })
                        })
                    } else {
                        None
                    };
                    self.action_thumbnail = None;
                    self.action_image_aspect_ratio = if self.action_is_image {
                        parse_aspect_ratio_value(aspect_ratio.as_deref())
                    } else {
                        None
                    };
                    if self.action_is_image || self.action_is_video {
                        let thumb_source = preview_url.or_else(|| {
                            if self.action_is_image {
                                self.action_download_url.clone()
                            } else {
                                None
                            }
                        });
                        if let Some(url) = thumb_source {
                            self.prefetch_action_thumbnail(url);
                        }
                    }
                    self.dropped_file_path = None;
                    self.dropped_file_paths.clear();
                    self.pending_file_ready = false;
                    self.filedrop_state
                        .transition_to(DropPhase::Idle, self.frame_count);
                    let target = if self.action_is_image {
                        PillState::ImageAction
                    } else if self.action_is_video {
                        PillState::VideoAction
                    } else {
                        PillState::FileAction
                    };
                    self.transition_to(target);
                }
                Command::FileProcessFailed { message } => {
                    self.remember_last_tool_result(
                        "file.tool".to_string(),
                        format!("Failed: {message}"),
                    );
                    self.output_text = message;
                    self.action_download_url = None;
                    self.action_requires_download = false;
                    self.action_downloading = false;
                    self.action_thumbnail = None;
                    self.action_image_aspect_ratio = None;
                    self.action_saved_path = None;
                    self.action_is_image = false;
                    self.action_is_video = false;
                    self.action_detail_text.clear();
                    self.action_editor_url = None;
                    self.image_preview_returns_to_file_ready = false;
                    self.dropped_file_paths.clear();
                    self.pending_file_ready = false;
                    self.filedrop_state
                        .transition_to(DropPhase::Idle, self.frame_count);
                    self.transition_to(PillState::Output);
                }
                Command::DownloadFinished {
                    success,
                    message,
                    saved_path,
                } => {
                    self.action_downloading = false;
                    if success {
                        self.action_text = "Saved successfully".to_string();
                        self.action_progress = 1.0;
                        self.action_requires_download = false;
                        self.remember_last_tool_result(
                            self.last_tool_name.clone(),
                            "Saved".to_string(),
                        );
                        self.active_since = Some(Instant::now());
                        self.bubble =
                            BubbleState::complete(format!("Saved: {message}"), self.frame_count);
                        if let Some(path) = saved_path {
                            let saved = PathBuf::from(path);
                            self.action_saved_path = Some(saved.clone());
                            if let Err(err) = reveal_in_file_manager(saved) {
                                self.bubble = BubbleState::error(err);
                            }
                        } else {
                            self.action_saved_path = None;
                        }
                    } else {
                        self.action_text = "Download failed, click to retry".to_string();
                        self.action_progress = 0.0;
                        self.action_requires_download = true;
                        self.remember_last_tool_result(
                            self.last_tool_name.clone(),
                            "Download failed. Retry available.".to_string(),
                        );
                        self.action_saved_path = None;
                        self.bubble = BubbleState::error(message);
                    }
                    let target = if self.action_is_image {
                        PillState::ImageAction
                    } else if self.action_is_video {
                        PillState::VideoAction
                    } else if self.action_download_url.is_some() {
                        PillState::FileAction
                    } else {
                        PillState::Action
                    };
                    self.transition_to(target);
                }
                Command::ActionThumbnailReady { bytes } => {
                    self.action_thumbnail = Image::from_encoded(Data::new_copy(&bytes));
                    if let Some(image) = self.action_thumbnail.as_ref() {
                        self.action_image_aspect_ratio =
                            image_aspect_ratio(image.width(), image.height());
                    }
                    if self.action_thumbnail.is_some()
                        && (self.action_is_image || self.action_is_video)
                    {
                        self.bubble =
                            BubbleState::complete("Preview ready".to_string(), self.frame_count);
                    }
                }
                Command::VoiceUpdate { .. } => {}
                Command::TimerUpdate {
                    label,
                    remaining_ms,
                    total_ms,
                } => {
                    self.apply_external_timer_update(label, remaining_ms, total_ms);
                    window.request_redraw();
                }
                Command::OpenFocus => {
                    self.open_focus_surface();
                    window.request_redraw();
                }
                Command::OpenAudioNotes => {
                    self.open_audio_notes_surface();
                    window.request_redraw();
                }
                Command::AudioNotesStart => {
                    self.start_audio_capture();
                    window.request_redraw();
                }
                Command::AudioNotesStop => {
                    self.stop_audio_capture();
                    window.request_redraw();
                }
                Command::AudioNotesSetSourceFile { path } => {
                    self.set_audio_capture_source_file(path);
                }
                Command::AudioNotesCaptured { path, duration_ms } => {
                    self.audio_capture_elapsed_ms = duration_ms;
                    self.audio_capture_last_path = Some(PathBuf::from(&path));
                    let display_name = Path::new(&path)
                        .file_name()
                        .and_then(|s| s.to_str())
                        .filter(|s| !s.is_empty())
                        .unwrap_or("audio-note.mp3")
                        .to_string();
                    self.remember_last_tool_result(
                        "capture.audio_file".to_string(),
                        format!("Ready: {display_name}"),
                    );
                    self.prepare_file_ready(path);
                    self.bubble =
                        BubbleState::complete("Audio note saved".to_string(), self.frame_count);
                    window.request_redraw();
                }
                Command::AudioNotesCaptureFailed { message } => {
                    self.output_text = message;
                    self.transition_to(PillState::Output);
                    window.request_redraw();
                }
                Command::OpenScreenRecord => {
                    self.open_screen_record_surface();
                    window.request_redraw();
                }
                Command::ScreenRecordStart => {
                    self.start_screen_capture();
                    window.request_redraw();
                }
                Command::ScreenRecordStop => {
                    self.stop_screen_capture();
                    window.request_redraw();
                }
                Command::ScreenRecordCaptured { path, duration_ms } => {
                    self.screen_capture_elapsed_ms = duration_ms;
                    self.screen_capture_last_path = Some(PathBuf::from(&path));
                    self.processing_label = "video.analyze_summary".to_string();
                    self.processing_progress = 0.24;
                    self.remember_last_tool_result(
                        "video.analyze_summary".to_string(),
                        "Screen recording captured.".to_string(),
                    );
                    self.transition_to(PillState::Processing);
                    crate::core::file_client::summarize_screen_capture(path, self.cmd.tx.clone());
                    window.request_redraw();
                }
                Command::ScreenRecordCaptureFailed { message } => {
                    self.output_text = message;
                    self.transition_to(PillState::Output);
                    window.request_redraw();
                }
                Command::FocusSetLabel { text } => {
                    self.focus_label_text = text;
                    self.focus_label_cursor = self.focus_label_text.len();
                    self.reset_auto_collapse();
                    if self.pill_state == PillState::FocusSetup {
                        window.request_redraw();
                    }
                }
                Command::FocusSetDuration { total_ms } => {
                    self.set_focus_duration(total_ms);
                    if self.pill_state == PillState::FocusSetup {
                        window.request_redraw();
                    }
                }
                Command::FocusStart => {
                    self.start_focus_session(FocusPhase::Work, self.focus_selected_total_ms);
                    window.request_redraw();
                }
                Command::FocusPause => {
                    self.pause_focus_session();
                    window.request_redraw();
                }
                Command::FocusResume => {
                    self.resume_focus_session();
                    window.request_redraw();
                }
                Command::FocusSkip => {
                    self.skip_focus_session();
                    window.request_redraw();
                }
                Command::FocusStartBreak => {
                    self.start_focus_break();
                    window.request_redraw();
                }
                Command::FocusLogProgress => {
                    self.log_focus_progress();
                    window.request_redraw();
                }
                Command::FocusAdvance { elapsed_ms } => {
                    self.advance_focus_session(elapsed_ms);
                    window.request_redraw();
                }
                Command::MusicConnectionStatus {
                    connected,
                    status,
                    account_name,
                } => {
                    self.music_netease_connection_known = true;
                    self.music_netease_connected = connected;
                    self.music_netease_account_name = account_name;
                    if connected {
                        self.music_auth_status = "success".to_string();
                        self.music_auth_last_poll_at = Some(Instant::now());
                    } else if status == "expired" {
                        self.music_auth_status = "expired".to_string();
                    } else if self.pill_state == PillState::MusicAuth
                        && self.music_auth_session_id.is_none()
                    {
                        self.music_auth_status = "starting".to_string();
                        music_client::start_auth(self.cmd.tx.clone());
                    }
                }
                Command::MusicAuthStarted {
                    session_id,
                    status,
                    qr_image_data_url,
                } => {
                    self.music_auth_session_id = Some(session_id);
                    self.music_auth_status = if status.trim().is_empty() {
                        "waiting".to_string()
                    } else {
                        status
                    };
                    self.music_auth_last_poll_at = Some(Instant::now());
                    self.set_music_auth_qr_from_data_url(&qr_image_data_url);
                    self.transition_to(PillState::MusicAuth);
                }
                Command::MusicAuthStatus {
                    session_id,
                    status,
                    qr_image_data_url,
                    account_name,
                } => {
                    if self.music_auth_session_id.as_deref() != Some(session_id.as_str()) {
                        continue;
                    }
                    self.music_auth_status = status.clone();
                    self.music_auth_last_poll_at = Some(Instant::now());
                    if let Some(data_url) = qr_image_data_url.as_deref() {
                        self.set_music_auth_qr_from_data_url(data_url);
                    }
                    if let Some(name) = account_name {
                        self.music_netease_account_name = name;
                    }
                    if status == "success" {
                        self.music_netease_connection_known = true;
                        self.music_netease_connected = true;
                    }
                }
                Command::MusicSearchResults {
                    results,
                    context_label,
                    authorized,
                } => {
                    let playable: Vec<MusicSearchResult> =
                        results.into_iter().filter(|s| s.playable).collect();
                    self.music_results = playable.clone();
                    self.music_playlist = playable;
                    self.music_results_context_label = context_label.unwrap_or_default();
                    self.music_results_scroll = 0.0;
                    if authorized {
                        self.music_netease_connection_known = true;
                        self.music_netease_connected = true;
                    }
                    let visible_ids: HashSet<u64> =
                        self.music_results.iter().map(|song| song.id).collect();
                    self.music_result_cover_bytes
                        .retain(|song_id, _| visible_ids.contains(song_id));
                    self.music_result_cover_images
                        .retain(|song_id, _| visible_ids.contains(song_id));
                    self.music_cover_requests_inflight
                        .retain(|song_id| visible_ids.contains(song_id));
                    for song in self.music_results.clone() {
                        self.fetch_music_cover(&song);
                    }
                    self.music_searching = false;
                    // Music tool-call has priority over remaining AI stream output.
                    self.suppress_ai_updates = true;
                    self.ai_state = AiState::Idle;
                    self.transition_to(PillState::MusicResults);
                }
                Command::MusicCoverReady { song_id, bytes } => {
                    self.music_cover_requests_inflight.remove(&song_id);
                    let bytes = Arc::new(bytes);
                    self.music_result_cover_bytes.insert(song_id, bytes.clone());
                    if let Some(image) = Image::from_encoded(Data::new_copy(bytes.as_slice())) {
                        self.music_result_cover_images.insert(song_id, image);
                    }
                    if self.music_current_song_id == Some(song_id) {
                        self.music_cover_bytes = Some(bytes);
                    }
                }
                Command::MusicSearchSetQuery { query } => {
                    self.music_search_query = query;
                    self.music_search_cursor = self.music_search_query.len();
                    self.reset_auto_collapse();
                }
                Command::MusicSearchSubmit => {
                    self.submit_music_search();
                }
                Command::LocalLyricsReady {
                    title,
                    artist,
                    lines,
                } => {
                    if !lines.is_empty()
                        && self.music_current_index.is_some()
                        && self.local_lyrics_title == title
                        && self.local_lyrics_artist == artist
                    {
                        self.local_media_lyrics = Some(Arc::new(lines));
                    }
                }
            }
            self.reset_auto_collapse();
            window.request_redraw();
        }
    }

    fn handle_music_text_command(&mut self, message: &str) -> bool {
        let normalized = message.trim().to_ascii_lowercase();
        if normalized.is_empty() {
            return false;
        }

        if matches!(
            normalized.as_str(),
            "next"
                | "next song"
                | "skip"
                | "\u{4e0b}\u{4e00}\u{9996}"
                | "\u{5207}\u{6b4c}"
                | "\u{6362}\u{4e00}\u{9996}"
        ) {
            self.play_music_relative(1);
            return true;
        }

        if matches!(
            normalized.as_str(),
            "prev"
                | "previous"
                | "previous song"
                | "\u{4e0a}\u{4e00}\u{9996}"
                | "\u{4e0a}\u{4e00}\u{9996}\u{6b4c}"
        ) {
            self.play_music_relative(-1);
            return true;
        }

        if matches!(
            normalized.as_str(),
            "pause" | "\u{6682}\u{505c}" | "\u{5148}\u{6682}\u{505c}"
        ) {
            self.set_music_playback(false);
            return true;
        }

        if matches!(
            normalized.as_str(),
            "resume"
                | "play"
                | "\u{7ee7}\u{7eed}"
                | "\u{7ee7}\u{7eed}\u{64ad}\u{653e}"
                | "\u{64ad}\u{653e}"
        ) {
            self.set_music_playback(true);
            return true;
        }

        false
    }

    fn parse_music_query(text: &str) -> Option<String> {
        let normalized = text.trim().replace('\u{3000}', " ");
        if normalized.is_empty() {
            return None;
        }

        for prefix in [
            "/music ",
            "music ",
            "song ",
            "play ",
            "listen to ",
            "\u{64ad}\u{653e} ",
            "\u{64ad}\u{653e}",
            "\u{641c}\u{6b4c} ",
            "\u{641c}\u{6b4c}",
            "\u{70b9}\u{6b4c} ",
            "\u{70b9}\u{6b4c}",
            "\u{6765}\u{4e00}\u{9996} ",
            "\u{6765}\u{4e00}\u{9996}",
            "\u{6765}\u{70b9} ",
            "\u{6765}\u{70b9}",
            "\u{6362}\u{6210} ",
            "\u{6362}\u{6210}",
        ] {
            if let Some(rest) = normalized.strip_prefix(prefix) {
                if let Some(query) = Self::clean_music_query(rest) {
                    return Some(query);
                }
            }
        }

        for marker in [
            "\u{64ad}\u{653e}",
            "\u{6765}\u{4e00}\u{9996}",
            "\u{6765}\u{70b9}",
            "\u{70b9}\u{6b4c}",
            "\u{641c}\u{6b4c}",
            "\u{6362}\u{6210}",
            "\u{542c}",
            "play ",
            "listen to ",
        ] {
            if let Some(idx) = normalized.find(marker) {
                let start = idx + marker.len();
                if start <= normalized.len() {
                    let rest = &normalized[start..];
                    if let Some(query) = Self::clean_music_query(rest) {
                        return Some(query);
                    }
                }
            }
        }
        None
    }

    fn clean_music_query(raw: &str) -> Option<String> {
        let mut query = raw
            .trim()
            .trim_matches(|c: char| {
                c.is_ascii_punctuation()
                    || "\u{ff0c}\u{3002}\u{ff01}\u{ff1f}\u{ff1b}\u{ff1a}\u{3001}\u{ff08}\u{ff09}\u{300c}\u{300d}\u{300e}\u{300f}\u{201c}\u{201d}\u{2018}\u{2019}"
                        .contains(c)
            })
            .to_string();
        if query.is_empty() {
            return None;
        }

        for leading in [
            "\u{4e00}\u{4e2a}",
            "\u{4e00}\u{9996}",
            "\u{9996}",
            "\u{4e2a}",
            "\u{8bf7}",
            "\u{5e2e}\u{6211}",
            "\u{7ed9}\u{6211}",
            "\u{8ba9}\u{6211}",
        ] {
            if let Some(rest) = query.strip_prefix(leading) {
                query = rest.trim().to_string();
            }
        }

        for trailing in [
            "\u{7684}\u{6b4c}",
            "\u{6b4c}\u{66f2}",
            "\u{6b4c}",
            "\u{97f3}\u{4e50}",
            "\u{542c}",
            "\u{5427}",
            "\u{5440}",
            "\u{5462}",
            "please",
            "pls",
        ] {
            query = query.trim_end_matches(trailing).trim().to_string();
        }

        if query.is_empty() || query.chars().count() <= 1 {
            return None;
        }
        Some(query)
    }

    fn play_music_relative(&mut self, delta: i32) {
        if self.music_playlist.is_empty() {
            self.output_text = "No music queue available".to_string();
            self.transition_to(PillState::Output);
            return;
        }

        let len = self.music_playlist.len() as i32;
        let current = self.music_current_index.unwrap_or(0) as i32;
        let next = (current + delta).rem_euclid(len) as usize;
        self.play_music_at(next);
        self.transition_to(PillState::MusicExpand);
    }

    fn set_music_playback(&mut self, should_play: bool) {
        let Some(player) = &self.music_player else {
            self.output_text = "Music player unavailable".to_string();
            self.transition_to(PillState::Output);
            return;
        };

        if should_play {
            player.play();
            self.local_playback_anchor = Some(Instant::now());
            self.local_music_playing = true;
            self.last_playing_time = Instant::now();
        } else {
            player.pause();
            self.local_playback_base_ms = self.current_local_playback_position_ms();
            self.local_playback_anchor = None;
            self.local_music_playing = false;
        }

        self.music_transition_pulse = 0.72;
        self.transition_to(PillState::MusicExpand);
    }
    fn is_cursor_on_action_download_button(&self) -> bool {
        let (px, py) = get_global_cursor_pos();
        let rel_x = (px - self.win_x) as f64;
        let rel_y = (py - self.win_y) as f64;

        let scale = self.config.global_scale as f64;
        let offset_x = (self.os_w as f64 - self.spring_w.value as f64) / 2.0;
        let rect_top = PADDING as f64 / 2.0;
        let rect_w = self.spring_w.value as f64;
        let rect_h = self.spring_h.value as f64;

        if !is_point_in_rect(rel_x, rel_y, offset_x, rect_top, rect_w, rect_h) {
            return false;
        }
        let (pad, circle_r, circle_cy) = if matches!(
            self.pill_state,
            PillState::ImageAction | PillState::ImagePreview
        ) || self.action_is_image
        {
            if self.pill_state == PillState::ImagePreview {
                let btn_size = 36.0 * scale;
                let margin_right = 24.0 * scale;
                let margin_bottom = 20.0 * scale;
                let cx = offset_x + rect_w - margin_right - btn_size / 2.0;
                let cy = rect_top + rect_h - margin_bottom - btn_size / 2.0;
                let dx = rel_x - cx;
                let dy = rel_y - cy;
                return dx * dx + dy * dy <= (btn_size / 2.0) * (btn_size / 2.0);
            }
            (16.0 * scale, 18.0 * scale, rect_top + rect_h / 2.0)
        } else if self.pill_state == PillState::VideoAction || self.action_is_video {
            (16.0 * scale, 16.0 * scale, rect_top + rect_h / 2.0)
        } else if self.pill_state == PillState::FileAction {
            (16.0 * scale, 12.0 * scale, rect_top + rect_h / 2.0)
        } else {
            (12.0 * scale, 10.0 * scale, rect_top + rect_h / 2.0)
        };
        let circle_cx = offset_x + rect_w - pad - circle_r;
        let dx = rel_x - circle_cx;
        let dy = rel_y - circle_cy;
        dx * dx + dy * dy <= circle_r * circle_r
    }

    fn is_cursor_on_action_thumbnail(&self) -> bool {
        if !self.action_is_image {
            return false;
        }
        let (px, py) = get_global_cursor_pos();
        let rel_x = (px - self.win_x) as f64;
        let rel_y = (py - self.win_y) as f64;

        let scale = self.config.global_scale as f64;
        let offset_x = (self.os_w as f64 - self.spring_w.value as f64) / 2.0;
        let rect_top = PADDING as f64 / 2.0;
        let rect_w = self.spring_w.value as f64;
        let rect_h = self.spring_h.value as f64;

        if !is_point_in_rect(rel_x, rel_y, offset_x, rect_top, rect_w, rect_h) {
            return false;
        }

        let pad = if matches!(self.pill_state, PillState::ImageAction) {
            6.0 * scale
        } else {
            8.0 * scale
        };
        let thumb_size = if matches!(self.pill_state, PillState::ImageAction) {
            52.0 * scale
        } else {
            24.0 * scale
        };
        let thumb_x = offset_x + pad;
        let thumb_y = rect_top + (rect_h - thumb_size) / 2.0;
        let thumb_hit = is_point_in_rect(rel_x, rel_y, thumb_x, thumb_y, thumb_size, thumb_size);
        if !matches!(self.pill_state, PillState::ImageAction) {
            return thumb_hit;
        }

        let info_x = thumb_x + thumb_size + 12.0 * scale;
        let info_w =
            (rect_w - (info_x - offset_x) - (16.0 * scale + 36.0 * scale + 8.0 * scale)).max(1.0);
        let info_y = rect_top + 10.0 * scale;
        let info_h = (rect_h - 20.0 * scale).max(1.0);
        thumb_hit || is_point_in_rect(rel_x, rel_y, info_x, info_y, info_w, info_h)
    }

    fn file_ready_artifact_rect(&self) -> Option<skia_safe::Rect> {
        if self.pill_state != PillState::FileReady || self.current_file_ready_path().is_none() {
            return None;
        }
        let scale = self.config.global_scale;
        let rect = self.pill_rect();
        let icon_size = FILE_READY_ICON_SIZE * scale;
        let icon_x = rect.left() + FILE_READY_PADDING_X * scale;
        let icon_y = rect.top() + FILE_READY_TOP_PADDING * scale + 8.0 * scale;
        Some(skia_safe::Rect::from_xywh(
            icon_x, icon_y, icon_size, icon_size,
        ))
    }

    fn is_cursor_on_file_ready_artifact(&self) -> bool {
        let Some(rect) = self.file_ready_artifact_rect() else {
            return false;
        };
        point_in_rect_from_cursor(self.win_x, self.win_y, rect)
    }

    fn file_ready_quick_action_rect(&self) -> Option<skia_safe::Rect> {
        if self.pill_state != PillState::FileReady
            || (self.current_file_ready_audio_path().is_none()
                && self.current_file_ready_text_path().is_none())
            || !self.file_input_text.trim().is_empty()
        {
            return None;
        }
        let scale = self.config.global_scale;
        let rect = self.pill_rect();
        let width = FILE_READY_QUICK_ACTION_WIDTH * scale;
        let height = FILE_READY_QUICK_ACTION_HEIGHT * scale;
        Some(skia_safe::Rect::from_xywh(
            rect.right() - FILE_READY_PADDING_X * scale - width,
            rect.bottom() - FILE_READY_QUICK_ACTION_BOTTOM_INSET * scale - height,
            width,
            height,
        ))
    }

    fn is_cursor_on_file_ready_quick_action(&self) -> bool {
        let Some(rect) = self.file_ready_quick_action_rect() else {
            return false;
        };
        point_in_rect_from_cursor(self.win_x, self.win_y, rect)
    }

    fn is_cursor_on_preview_download_button(&self) -> bool {
        self.pill_state == PillState::ImagePreview && self.is_cursor_on_action_download_button()
    }

    fn is_cursor_on_preview_edit_button(&self) -> bool {
        if self.pill_state != PillState::ImagePreview || !self.action_is_image {
            return false;
        }
        let (px, py) = get_global_cursor_pos();
        let rel_x = (px - self.win_x) as f64;
        let rel_y = (py - self.win_y) as f64;
        let scale = self.config.global_scale as f64;
        let offset_x = (self.os_w as f64 - self.spring_w.value as f64) / 2.0;
        let rect_top = PADDING as f64 / 2.0;
        let rect_w = self.spring_w.value as f64;
        let rect_h = self.spring_h.value as f64;
        if !is_point_in_rect(rel_x, rel_y, offset_x, rect_top, rect_w, rect_h) {
            return false;
        }

        let btn_w = 64.0 * scale;
        let btn_h = 32.0 * scale;
        let btn_x = offset_x + 24.0 * scale;
        let btn_y = rect_top + rect_h - 20.0 * scale - btn_h;
        is_point_in_rect(rel_x, rel_y, btn_x, btn_y, btn_w, btn_h)
    }

    fn is_cursor_on_preview_shrink_affordance(&self) -> bool {
        if self.pill_state != PillState::ImagePreview {
            return false;
        }
        let (px, py) = get_global_cursor_pos();
        let rel_x = (px - self.win_x) as f64;
        let rel_y = (py - self.win_y) as f64;
        let scale = self.config.global_scale as f64;
        let offset_x = (self.os_w as f64 - self.spring_w.value as f64) / 2.0;
        let rect_top = PADDING as f64 / 2.0;
        let rect_w = self.spring_w.value as f64;
        let rect_h = self.spring_h.value as f64;
        if !is_point_in_rect(rel_x, rel_y, offset_x, rect_top, rect_w, rect_h) {
            return false;
        }
        let aff_w = 40.0 * scale;
        let aff_h = 7.0 * scale;
        let aff_x = offset_x + (rect_w - aff_w) / 2.0;
        let aff_y = rect_top + rect_h - 12.0 * scale - aff_h;
        is_point_in_rect(rel_x, rel_y, aff_x, aff_y, aff_w, aff_h)
    }

    fn handle_right_click(&mut self, win: Arc<Window>) {
        if !self.is_cursor_inside_pill() {
            return;
        }
        if self.perform_context_action() {
            win.request_redraw();
        }
    }

    fn perform_context_action(&mut self) -> bool {
        match self.pill_state {
            PillState::Input
            | PillState::MusicSearch
            | PillState::FileReady
            | PillState::ImageEdit => return self.paste_clipboard_into_active_input(),
            PillState::Output
            | PillState::Action
            | PillState::FileAction
            | PillState::VideoAction => {
                return self.copy_active_content_to_clipboard();
            }
            PillState::ImageAction | PillState::ImagePreview => {}
            _ => return false,
        }

        if self.action_is_image {
            if self.open_image_editor() {
                return true;
            }
            if let Some(path) = self.action_saved_path.clone() {
                match reveal_in_file_manager(path) {
                    Ok(()) => {
                        self.bubble = BubbleState::complete(
                            "Opened image folder".to_string(),
                            self.frame_count,
                        );
                    }
                    Err(err) => {
                        self.bubble = BubbleState::error(err);
                    }
                }
            } else if self.action_requires_download {
                self.bubble = BubbleState::complete(
                    "Click download first to save image".to_string(),
                    self.frame_count,
                );
            } else {
                self.bubble = BubbleState::error("Image path not available".to_string());
            }
            return true;
        }

        false
    }

    fn open_image_editor(&mut self) -> bool {
        if !matches!(
            self.pill_state,
            PillState::ImageAction | PillState::ImagePreview | PillState::ImageEdit
        ) {
            return false;
        }

        let url = if let Some(url) = self.action_editor_url.clone() {
            url
        } else if let Some(source) = self.action_download_url.clone() {
            match crate::core::file_client::resolve_image_source(&source) {
                Ok((resolved_source, Some(editor_url))) => {
                    self.action_download_url = Some(resolved_source);
                    self.action_editor_url = Some(editor_url.clone());
                    editor_url
                }
                Ok((resolved_source, None)) => {
                    self.action_download_url = Some(resolved_source);
                    self.bubble = BubbleState::error(
                        "IOPaint Studio is not available for this image".to_string(),
                    );
                    return true;
                }
                Err(err) => {
                    self.bubble = BubbleState::error(err);
                    return true;
                }
            }
        } else {
            self.bubble =
                BubbleState::error("IOPaint Studio is not available for this image".to_string());
            return true;
        };

        match open_external_target(&url) {
            Ok(()) => {
                self.bubble =
                    BubbleState::complete("Opened IOPaint Studio".to_string(), self.frame_count);
            }
            Err(err) => {
                self.bubble = BubbleState::error(err);
            }
        }
        true
    }

    fn begin_download_action(&mut self) {
        let Some(url) = self.action_download_url.clone() else {
            return;
        };
        let suggested = if self.action_file_name.trim().is_empty() {
            "omniagent-output.bin".to_string()
        } else {
            self.action_file_name.clone()
        };
        let Some(path) = self.resolve_download_target_path(&suggested) else {
            self.action_text = "Invalid download path".to_string();
            self.action_progress = 0.0;
            return;
        };

        self.action_downloading = true;
        self.action_progress = 0.2;
        self.action_text = format!("Saving to {}", path.to_string_lossy());
        crate::core::file_client::download_to_path(url, path, self.cmd.tx.clone());
    }

    fn prefetch_action_thumbnail(&self, url: String) {
        let tx = self.cmd.tx.clone();
        std::thread::spawn(move || {
            let local_path = Path::new(&url);
            if local_path.exists() {
                let bytes = match fs::read(local_path) {
                    Ok(bytes) if !bytes.is_empty() => bytes,
                    _ => return,
                };
                let _ = tx.send(Command::ActionThumbnailReady { bytes });
                return;
            }

            let resolved_url = resolve_local_api_url(&url);
            let agent = ureq::AgentBuilder::new()
                .try_proxy_from_env(false)
                .timeout_connect(Duration::from_secs(10))
                .timeout(Duration::from_secs(30))
                .build();
            let response = match agent.get(&resolved_url).call() {
                Ok(resp) => resp,
                Err(_) => return,
            };

            let mut reader = response.into_reader();
            let mut bytes = Vec::new();
            if std::io::Read::read_to_end(&mut reader, &mut bytes).is_err() {
                return;
            }
            if bytes.is_empty() {
                return;
            }
            let _ = tx.send(Command::ActionThumbnailReady { bytes });
        });
    }

    fn resolve_download_target_path(&self, suggested: &str) -> Option<PathBuf> {
        let base_dir = self.config.download_dir.trim();
        if base_dir.is_empty() {
            return None;
        }
        let dir = PathBuf::from(base_dir);
        if fs::create_dir_all(&dir).is_err() {
            return None;
        }

        let file_name = sanitize_file_name(suggested);
        let (stem, ext) = split_file_stem_ext(&file_name);
        let mut candidate = dir.join(&file_name);
        if !candidate.exists() {
            return Some(candidate);
        }

        for i in 1..=9999 {
            let numbered = if ext.is_empty() {
                format!("{stem} ({i})")
            } else {
                format!("{stem} ({i}).{ext}")
            };
            candidate = dir.join(numbered);
            if !candidate.exists() {
                return Some(candidate);
            }
        }
        None
    }

    fn handle_music_expand_tap(&mut self) -> bool {
        if self.pill_state != PillState::MusicExpand {
            return false;
        }
        let (px, py) = get_global_cursor_pos();
        let rel_x = (px - self.win_x) as f64;
        let rel_y = (py - self.win_y) as f64;

        let scale = self.config.global_scale as f64;
        let offset_x = (self.os_w as f64 - self.spring_w.value as f64) / 2.0;
        let rect_top = PADDING as f64 / 2.0;
        let rect_w = self.spring_w.value as f64;
        let rect_h = self.spring_h.value as f64;

        let py_pad = 20.0 * scale;
        let art_size = 64.0 * scale;
        let prog_y = rect_top + py_pad + art_size + 24.0 * scale;
        let ctrl_y = prog_y + 28.0 * scale;
        let ctrl_cx = offset_x + rect_w / 2.0;
        let gap = 36.0 * scale;
        let hit_r = 18.0 * scale;

        if rel_y < rect_top || rel_y > rect_top + rect_h {
            return false;
        }

        let hit = |x: f64, y: f64, cx: f64, cy: f64, r: f64| -> bool {
            let dx = x - cx;
            let dy = y - cy;
            dx * dx + dy * dy <= r * r
        };

        let search_size = 32.0 * scale;
        let search_x = offset_x + rect_w - 24.0 * scale - search_size;
        let search_y = rect_top + 20.0 * scale;
        if is_point_in_rect(rel_x, rel_y, search_x, search_y, search_size, search_size) {
            self.open_music_search();
            return true;
        }

        if hit(rel_x, rel_y, ctrl_cx - gap, ctrl_y, hit_r) {
            if let Some(len) =
                (!self.music_playlist.is_empty()).then_some(self.music_playlist.len())
            {
                let current = self.music_current_index.unwrap_or(0);
                let next = if current == 0 { len - 1 } else { current - 1 };
                self.play_music_at(next);
            }
            return true;
        }

        if hit(rel_x, rel_y, ctrl_cx + gap, ctrl_y, hit_r) {
            if let Some(len) =
                (!self.music_playlist.is_empty()).then_some(self.music_playlist.len())
            {
                let current = self.music_current_index.unwrap_or(0);
                let next = if current + 1 >= len { 0 } else { current + 1 };
                self.play_music_at(next);
            }
            return true;
        }

        if hit(rel_x, rel_y, ctrl_cx, ctrl_y, hit_r * 1.05) {
            if let Some(player) = &self.music_player {
                let should_pause = self.effective_music_playing();
                if should_pause {
                    player.pause();
                    self.local_playback_base_ms = self.current_local_playback_position_ms();
                    self.local_playback_anchor = None;
                    self.local_music_playing = false;
                } else {
                    player.play();
                    self.local_playback_anchor = Some(Instant::now());
                    self.local_music_playing = true;
                    self.last_playing_time = Instant::now();
                }
                self.music_transition_pulse = 0.72;
            }
            return true;
        }

        false
    }

    fn open_music_search(&mut self) {
        self.music_searching = false;
        self.music_results.clear();
        self.music_results_context_label.clear();
        self.music_results_scroll = 0.0;
        self.music_search_cursor = self.music_search_query.len();
        self.transition_to(PillState::MusicSearch);
        self.reset_auto_collapse();
    }

    fn open_music_auth_surface(&mut self, preserve_qr: bool) {
        if !preserve_qr {
            self.music_auth_session_id = None;
            self.music_auth_qr_image = None;
        }
        if self.music_auth_status.is_empty() {
            self.music_auth_status = "starting".to_string();
        }
        self.transition_to(PillState::MusicAuth);
        self.reset_auto_collapse();
    }

    fn refresh_music_connection_status(&mut self) {
        self.music_auth_status = "checking_connection".to_string();
        music_client::fetch_connection_status(self.cmd.tx.clone());
    }

    fn load_music_recommendations(&mut self) {
        self.music_searching = true;
        self.music_results.clear();
        self.music_results_context_label = "For you".to_string();
        self.music_results_scroll = 0.0;
        self.processing_label = "Loading NetEase".to_string();
        self.processing_progress = 0.16;
        music_client::load_recommendations(self.cmd.tx.clone());
        self.transition_to(PillState::Thinking);
        self.reset_auto_collapse();
    }

    fn submit_music_search(&mut self) -> bool {
        let query = self.music_search_query.trim().to_string();
        if query.is_empty() {
            return false;
        }
        self.music_search_query = query.clone();
        self.music_search_cursor = self.music_search_query.len();
        self.music_searching = true;
        self.music_results.clear();
        self.music_results_context_label.clear();
        self.music_results_scroll = 0.0;
        self.music_transition_pulse = 1.0;
        self.processing_label = "Searching music".to_string();
        self.processing_progress = 0.16;
        music_client::search(query, self.cmd.tx.clone());
        self.transition_to(PillState::Thinking);
        self.reset_auto_collapse();
        true
    }

    fn handle_music_results_tap(&mut self) -> bool {
        if self.pill_state != PillState::MusicResults {
            return false;
        }
        let (px, py) = get_global_cursor_pos();
        let rel_x = (px - self.win_x) as f64;
        let rel_y = (py - self.win_y) as f64;
        let scale = self.config.global_scale as f64;
        let rect = self.pill_rect();
        if !is_point_in_rect(
            rel_x,
            rel_y,
            rect.left() as f64,
            rect.top() as f64,
            rect.width() as f64,
            rect.height() as f64,
        ) {
            return false;
        }

        let pad = 20.0 * scale;
        let close_cx = rect.right() as f64 - pad;
        let close_cy = rect.top() as f64 + 18.0 * scale;
        let close_r = 14.0 * scale;
        let dx = rel_x - close_cx;
        let dy = rel_y - close_cy;
        if dx * dx + dy * dy <= close_r * close_r {
            if self.music_current_index.is_some() {
                self.transition_to(PillState::MusicExpand);
            } else {
                self.restore_base();
            }
            return true;
        }

        let list_x = rect.left() as f64 + pad;
        let list_y = rect.top() as f64 + 36.0 * scale;
        let list_w = rect.width() as f64 - pad * 2.0;
        let row_h = 52.0 * scale;
        let gap = 6.0 * scale;
        for index in 0..self.music_results.len() {
            let y = list_y + index as f64 * (row_h + gap) - self.music_results_scroll as f64;
            if !is_point_in_rect(rel_x, rel_y, list_x, y, list_w, row_h) {
                continue;
            }
            if index < self.music_playlist.len() {
                self.play_music_at(index);
                self.transition_to(PillState::MusicExpand);
                self.reset_auto_collapse();
            }
            return true;
        }

        false
    }

    fn play_music_at(&mut self, index: usize) {
        if self.music_playlist.is_empty() || index >= self.music_playlist.len() {
            return;
        }
        self.music_current_index = Some(index);
        let song = self.music_playlist[index].clone();
        self.music_current_song_id = Some(song.id);
        self.music_cover_bytes = None;
        if let Some(bytes) = self.music_result_cover_bytes.get(&song.id) {
            self.music_cover_bytes = Some(bytes.clone());
        }
        let url = song
            .stream_url
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| music_client::audio_url(song.id));
        if let Some(player) = &self.music_player {
            if player.play_url(&url).is_ok() {
                self.base_pill_state = PillState::MusicWave;
                self.local_music_playing = true;
                self.local_playback_base_ms = 0;
                self.local_playback_anchor = Some(Instant::now());
                self.local_lyrics_title = song.name.clone();
                self.local_lyrics_artist = song.artist.clone();
                self.local_media_lyrics = None;
                self.last_playing_time = Instant::now();
                self.music_transition_pulse = 1.0;
                self.action_text = song.name.clone();
                self.action_detail_text = song.artist.clone();
                self.remember_last_tool_result(
                    "music.search".to_string(),
                    format!("{} · {}", song.name, song.artist),
                );
                self.fetch_music_cover(&song);

                let tx = self.cmd.tx.clone();
                let title = song.name.clone();
                let artist = song.artist.clone();
                let song_id = song.id as i64;
                std::thread::spawn(move || {
                    if let Some(lines) = crate::core::lyrics::fetch_lyrics_by_id(song_id) {
                        let _ = tx.send(Command::LocalLyricsReady {
                            title,
                            artist,
                            lines: lines.as_ref().clone(),
                        });
                    }
                });
            } else {
                self.output_text = format!("Failed to play {}", song.name);
                self.transition_to(PillState::Output);
            }
        } else {
            self.output_text = "Music player unavailable".to_string();
            self.transition_to(PillState::Output);
        }
    }

    fn set_music_auth_qr_from_data_url(&mut self, data_url: &str) {
        let Some(base64) = data_url.split_once(',').map(|(_, value)| value) else {
            return;
        };
        let Ok(bytes) = BASE64_STANDARD.decode(base64) else {
            return;
        };
        self.music_auth_qr_image = Image::from_encoded(Data::new_copy(bytes.as_slice()));
    }

    fn tick_music_auth(&mut self, window: &Arc<Window>) {
        if self.pill_state != PillState::MusicAuth {
            return;
        }
        if self.music_auth_status == "success" {
            let should_continue = self
                .music_auth_last_poll_at
                .map(|instant| instant.elapsed() >= Duration::from_millis(1200))
                .unwrap_or(false);
            if should_continue {
                self.music_auth_status = "done".to_string();
                self.load_music_recommendations();
                window.request_redraw();
            }
            return;
        }
        let waiting = matches!(
            self.music_auth_status.as_str(),
            "waiting" | "confirm" | "starting" | "checking_connection"
        );
        if !waiting {
            return;
        }
        if self.music_auth_status == "starting" || self.music_auth_status == "checking_connection" {
            return;
        }
        let should_poll = self
            .music_auth_last_poll_at
            .map(|instant| instant.elapsed() >= Duration::from_millis(1800))
            .unwrap_or(true);
        if should_poll {
            if let Some(session_id) = self.music_auth_session_id.clone() {
                self.music_auth_last_poll_at = Some(Instant::now());
                music_client::poll_auth(session_id, self.cmd.tx.clone());
                window.request_redraw();
            }
        }
    }
    fn update_cursor_hittest(&mut self, window: &Arc<Window>) {
        let (px, py) = get_global_cursor_pos();
        let rel_x = (px - self.win_x) as f64;
        let rel_y = (py - self.win_y) as f64;
        let pad = 4.0;
        let offset_x = (self.os_w as f64 - self.spring_w.value as f64) / 2.0 - pad;
        let pill_y = PADDING as f64 / 2.0 - pad;
        let w = self.spring_w.value as f64 + pad * 2.0;
        let h = self.spring_h.value as f64 + pad * 2.0;
        let want = is_point_in_rect(rel_x, rel_y, offset_x, pill_y, w, h);
        if want != self.cursor_hittest {
            self.cursor_hittest = want;
            let _ = window.set_cursor_hittest(want);
        }
    }

    fn update_border_weights(&mut self, window: &Arc<Window>) {
        if self.config.adaptive_border && self.frame_count % 30 == 0 {
            let island_cx = self.win_x + (self.os_w as i32 / 2);
            let island_cy = self.win_y + (PADDING as i32 / 2) + (self.spring_h.value as i32 / 2);
            let raw = get_island_border_weights(
                island_cx,
                island_cy,
                self.spring_w.value,
                self.spring_h.value,
            );
            self.target_border_weights = raw.map(|w| if w > 0.85 { w } else { 0.0 });
        } else if !self.config.adaptive_border {
            self.target_border_weights = [0.0; 4];
        }
        for i in 0..4 {
            let diff = self.target_border_weights[i] - self.border_weights[i];
            if diff.abs() > 0.005 {
                self.border_weights[i] += diff * 0.1;
            } else {
                self.border_weights[i] = self.target_border_weights[i];
            }
        }
        let _ = window;
    }

    fn update_media_state(&mut self, window: &Arc<Window>) {
        if !self.config.smtc_enabled {
            return;
        }
        let mut media = self.smtc.get_info();
        self.fill_local_media_fallback(&mut media);
        let music_active = !media.title.is_empty()
            && (media.is_playing
                || self.local_music_playing
                || self.last_playing_time.elapsed() < Duration::from_secs(5));
        if !media.title.is_empty() {
            self.last_media_playing = media.is_playing;
            if self.last_media_playing {
                self.last_playing_time = Instant::now();
            }
        }
        if media.title != self.last_media_title {
            self.last_media_title = media.title.clone();
            window.request_redraw();
        }
        // Lyric updates
        let current_lyric_opt = if self.config.show_lyrics {
            media.current_lyric()
        } else {
            None
        };
        match current_lyric_opt {
            Some(lyric) if lyric != self.current_lyric_text => {
                self.old_lyric_text = self.current_lyric_text.clone();
                self.current_lyric_text = lyric;
                self.lyric_transition = 0.0;
            }
            None if !self.current_lyric_text.is_empty() => {
                self.old_lyric_text = self.current_lyric_text.clone();
                self.current_lyric_text = String::new();
                self.lyric_transition = 0.0;
            }
            _ => {}
        }
        // Drive music PillState transitions (only when in base/music states)
        let in_music_or_idle = matches!(
            self.pill_state,
            PillState::Idle | PillState::MusicWave | PillState::MusicLyric
        );
        if music_active && in_music_or_idle {
            let lyric_ready = self.current_local_playback_position_ms() >= 1100;
            let has_lyric =
                self.config.show_lyrics && lyric_ready && !self.current_lyric_text.is_empty();
            let want = if has_lyric {
                PillState::MusicLyric
            } else {
                PillState::MusicWave
            };
            self.base_pill_state = want.clone();
            if self.pill_state != want {
                self.transition_to(want);
                window.request_redraw();
            }
        } else if !music_active
            && matches!(
                self.pill_state,
                PillState::MusicWave | PillState::MusicLyric | PillState::MusicExpand
            )
        {
            self.local_music_playing = false;
            self.local_playback_anchor = None;
            self.local_playback_base_ms = 0;
            self.local_media_lyrics = None;
            self.base_pill_state = PillState::Idle;
            self.transition_to(PillState::Idle);
            window.request_redraw();
        }
    }

    fn update_lyric_transition(&mut self, window: &Arc<Window>) {
        if self.lyric_transition >= 1.0 {
            return;
        }
        self.lyric_transition = (self.lyric_transition + 0.05).min(1.0);
        window.request_redraw();
    }

    fn remember_last_tool_result(&mut self, tool_name: String, result: String) {
        let normalized = normalize_tool_name(&tool_name);
        if !normalized.is_empty() {
            self.last_tool_name = trim_text(&normalized, 28);
        }
        let cleaned_result = result.trim();
        if !cleaned_result.is_empty() {
            self.last_tool_result = trim_text(cleaned_result, 120);
        }
    }

    fn update_springs(&mut self) {
        let (tw, th, tr) = match self.pill_state {
            PillState::Input => input_dimensions(
                self.config.global_scale,
                &self.input_text,
                &self.ime_preedit,
                self.input_file_context_active,
            ),
            PillState::FileReady => file_input_dimensions(
                self.config.global_scale,
                &self.file_input_text,
                self.dropped_file_paths
                    .len()
                    .max(self.dropped_file_path.is_some() as usize),
                self.current_file_ready_image_path().is_some(),
                self.current_file_ready_audio_path().is_some(),
                self.current_file_ready_text_path().is_some(),
            ),
            PillState::Output => output_dimensions(self.config.global_scale, &self.output_text),
            _ => pill_dimensions_with_image_ratio(
                &self.pill_state,
                self.config.global_scale,
                self.action_image_aspect_ratio,
            ),
        };
        self.spring_w.update(tw, SPRING_MAIN.0, SPRING_MAIN.1);
        self.spring_h.update(th, SPRING_MAIN.0, SPRING_MAIN.1);
        self.spring_r.update(tr, SPRING_RADIUS.0, SPRING_RADIUS.1);
    }
}

fn input_dimensions(
    scale: f32,
    input_text: &str,
    input_preedit: &str,
    has_file_context: bool,
) -> (f32, f32, f32) {
    let display = format!("{}{}", input_text, input_preedit);
    let font_size = INPUT_FONT_SIZE * scale;
    let line_height = font_size * INPUT_LINE_HEIGHT_MULTIPLIER;
    let content_width = (INPUT_WIDTH - INPUT_PADDING_X * 2.0) * scale;
    let line_count = if display.trim().is_empty() {
        1
    } else {
        estimate_wrapped_line_count(&display, font_size, content_width).min(INPUT_MAX_VISIBLE_LINES)
    };

    let context_extra = if has_file_context { 28.0 * scale } else { 0.0 };
    let height = if line_count <= 1 {
        (INPUT_MIN_HEIGHT * scale + context_extra).max(INPUT_MIN_HEIGHT * scale)
    } else {
        (line_height * line_count as f32 + INPUT_VERTICAL_PADDING * 2.0 * scale + context_extra)
            .max(INPUT_MIN_HEIGHT * scale)
    };

    (INPUT_WIDTH * scale, height, INPUT_CORNER_RADIUS * scale)
}

fn file_ready_placeholder(
    dropped_file_count: usize,
    is_single_image: bool,
    is_single_audio: bool,
    is_single_text: bool,
) -> &'static str {
    if dropped_file_count > 1 {
        "Merge the set, extract structured text, or describe the final deliverable..."
    } else if is_single_audio {
        "Describe audio..."
    } else if is_single_text {
        "Describe text..."
    } else if is_single_image {
        "Type directly: remove background, clean watermark, upscale... or tap artwork to preview."
    } else {
        "Describe the transformation, summary, or image edit you want..."
    }
}

fn file_input_dimensions(
    scale: f32,
    file_input_text: &str,
    dropped_file_count: usize,
    is_single_image: bool,
    is_single_audio: bool,
    is_single_text: bool,
) -> (f32, f32, f32) {
    let font_size = FILE_READY_FONT_SIZE * scale;
    let line_height = font_size * FILE_READY_LINE_HEIGHT_MULTIPLIER;
    let shows_quick_action = file_input_text.trim().is_empty() && (is_single_audio || is_single_text);
    let content_width = (FILE_READY_WIDTH
        - FILE_READY_PADDING_X * 2.0
        - FILE_READY_ICON_SIZE
        - FILE_READY_ICON_GAP
        - if shows_quick_action {
            FILE_READY_QUICK_ACTION_WIDTH + FILE_READY_QUICK_ACTION_GAP
        } else {
            0.0
        })
        * scale;
    let display = if file_input_text.trim().is_empty() {
        file_ready_placeholder(
            dropped_file_count,
            is_single_image,
            is_single_audio,
            is_single_text,
        )
    } else {
        file_input_text
    };
    let line_count = estimate_wrapped_line_count(display, font_size, content_width)
        .min(FILE_READY_MAX_VISIBLE_LINES)
        .max(1);
    let height =
        (FILE_READY_TOP_PADDING + FILE_READY_STATUS_HEIGHT + 6.0 + FILE_READY_BOTTOM_PADDING)
            * scale
            + line_height * line_count as f32
            + if shows_quick_action {
                FILE_READY_FOOTER_HEIGHT * scale
            } else {
                0.0
            };

    (
        FILE_READY_WIDTH * scale,
        height.max(FILE_READY_MIN_HEIGHT * scale),
        FILE_READY_CORNER_RADIUS * scale,
    )
}

fn output_line_height(scale: f32) -> f32 {
    OUTPUT_FONT_SIZE * scale * OUTPUT_LINE_HEIGHT_MULTIPLIER
}

fn output_dimensions(scale: f32, output_text: &str) -> (f32, f32, f32) {
    let content_width = (OUTPUT_WIDTH - OUTPUT_PADDING_X * 2.0) * scale;
    let line_count =
        estimate_wrapped_line_count(output_text, OUTPUT_FONT_SIZE * scale, content_width)
            .max(1)
            .min(OUTPUT_MAX_VISIBLE_LINES);
    let target_height = OUTPUT_PADDING_TOP * scale
        + OUTPUT_PADDING_BOTTOM * scale
        + output_line_height(scale) * line_count as f32;
    let height = target_height.clamp(OUTPUT_MIN_HEIGHT * scale, OUTPUT_MAX_HEIGHT * scale);
    (OUTPUT_WIDTH * scale, height, OUTPUT_CORNER_RADIUS * scale)
}

fn output_viewport_height(scale: f32, output_text: &str) -> f32 {
    let (_, pill_h, _) = output_dimensions(scale, output_text);
    (pill_h - OUTPUT_PADDING_TOP * scale - OUTPUT_PADDING_BOTTOM * scale).max(1.0)
}

fn estimate_output_max_scroll(scale: f32, output_text: &str) -> f32 {
    let (pill_w, _, _) = output_dimensions(scale, output_text);
    let content_width = (pill_w - OUTPUT_PADDING_X * scale * 2.0).max(1.0);
    let line_count =
        estimate_wrapped_line_count(output_text, OUTPUT_FONT_SIZE * scale, content_width);
    let content_height = line_count as f32 * output_line_height(scale);
    (content_height - output_viewport_height(scale, output_text)).max(0.0)
}

fn split_file_stem_ext(name: &str) -> (String, String) {
    let mut iter = name.rsplitn(2, '.');
    let tail = iter.next().unwrap_or_default();
    let head = iter.next();
    match head {
        Some(stem) if !stem.is_empty() && !tail.is_empty() => (stem.to_string(), tail.to_string()),
        _ => (name.to_string(), String::new()),
    }
}

fn parse_aspect_ratio_value(value: Option<&str>) -> Option<f32> {
    let raw = value?.trim().replace('\u{ff1a}', ":");
    let normalized = match raw.to_ascii_lowercase().as_str() {
        "square" => "1:1".to_string(),
        "landscape" => "16:9".to_string(),
        "portrait" => "9:16".to_string(),
        _ => raw,
    };
    let (w, h) = normalized.split_once(':')?;
    let width = w.trim().parse::<f32>().ok()?;
    let height = h.trim().parse::<f32>().ok()?;
    image_aspect_ratio(width as i32, height as i32)
}

fn image_aspect_ratio(width: i32, height: i32) -> Option<f32> {
    if width <= 0 || height <= 0 {
        return None;
    }
    Some(width as f32 / height as f32)
}

fn resolve_local_api_url(url: &str) -> String {
    if url.starts_with("http://") || url.starts_with("https://") {
        return url.to_string();
    }
    format!("http://127.0.0.1:3010{}", url)
}

fn fit_rect_with_ratio(container: skia_safe::Rect, ratio: f32) -> skia_safe::Rect {
    let safe_ratio = ratio.clamp(0.2, 5.0);
    let container_ratio = container.width() / container.height().max(1.0);
    if safe_ratio >= container_ratio {
        let width = container.width();
        let height = (width / safe_ratio).max(1.0);
        skia_safe::Rect::from_xywh(
            container.left(),
            container.center_y() - height / 2.0,
            width,
            height,
        )
    } else {
        let height = container.height();
        let width = (height * safe_ratio).max(1.0);
        skia_safe::Rect::from_xywh(
            container.center_x() - width / 2.0,
            container.top(),
            width,
            height,
        )
    }
}

fn point_in_rect_from_cursor(win_x: i32, win_y: i32, rect: skia_safe::Rect) -> bool {
    let (px, py) = get_global_cursor_pos();
    let rel_x = (px - win_x) as f64;
    let rel_y = (py - win_y) as f64;
    is_point_in_rect(
        rel_x,
        rel_y,
        rect.left() as f64,
        rect.top() as f64,
        rect.width() as f64,
        rect.height() as f64,
    )
}

fn edit_tool_id(tool: ImageEditTool) -> &'static str {
    match tool {
        ImageEditTool::RemoveObject => "image.remove_object",
        ImageEditTool::ReplaceObject => "image.replace_object",
        ImageEditTool::AddText => "image.add_text",
        ImageEditTool::Outpaint => "image.outpaint",
        ImageEditTool::RemoveBackground => "image.remove_background",
        ImageEditTool::RemoveWatermark => "image.remove_watermark",
        ImageEditTool::Upscale => "image.upscale",
        ImageEditTool::FaceRestore => "image.face_restore",
    }
}

fn image_edit_tool_uses_mask(tool: ImageEditTool) -> bool {
    matches!(
        tool,
        ImageEditTool::RemoveObject | ImageEditTool::ReplaceObject | ImageEditTool::AddText
    )
}

fn pill_state_id(state: &PillState) -> &'static str {
    match state {
        PillState::Idle => "idle",
        PillState::FocusSetup => "focus_setup",
        PillState::FocusRun => "focus_run",
        PillState::AudioRun => "audio_run",
        PillState::AudioExpand => "audio_expand",
        PillState::ScreenRun => "screen_run",
        PillState::ScreenExpand => "screen_expand",
        PillState::MusicAuth => "music_auth",
        PillState::FocusExpand => "focus_expand",
        PillState::FocusComplete => "focus_complete",
        PillState::MusicSearch => "music_search",
        PillState::MusicResults => "music_results",
        PillState::MusicWave => "music_wave",
        PillState::MusicLyric => "music_lyric",
        PillState::MusicExpand => "music_expand",
        PillState::ToolPanel => "tool_panel",
        PillState::Input => "input",
        PillState::Thinking => "thinking",
        PillState::Output => "output",
        PillState::DragHover => "drag_hover",
        PillState::FileReady => "file_ready",
        PillState::FileProcessing => "file_processing",
        PillState::Processing => "processing",
        PillState::ImageProcessing => "image_processing",
        PillState::Action => "action",
        PillState::FileAction => "file_action",
        PillState::VideoAction => "video_action",
        PillState::ImageAction => "image_action",
        PillState::ImagePreview => "image_preview",
        PillState::ImageEdit => "image_edit",
    }
}

fn focus_phase_id(phase: FocusPhase) -> &'static str {
    match phase {
        FocusPhase::Work => "work",
        FocusPhase::Break => "break",
    }
}

fn focus_completion_id(kind: FocusCompletionKind) -> &'static str {
    match kind {
        FocusCompletionKind::WorkFinished => "work_finished",
        FocusCompletionKind::BreakFinished => "break_finished",
    }
}

fn outpaint_expansion(preset: ImageOutpaintPreset) -> (u32, u32, u32, u32) {
    match preset {
        ImageOutpaintPreset::Wide => (0, 160, 0, 160),
        ImageOutpaintPreset::Tall => (160, 0, 160, 0),
        ImageOutpaintPreset::Frame => (96, 96, 96, 96),
    }
}

fn infer_image_edit_tool(prompt: &str, has_mask: bool) -> ImageEditTool {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return ImageEditTool::RemoveObject;
    }

    let lower = prompt.to_ascii_lowercase();
    if text_contains_any(
        prompt,
        &lower,
        &[
            "remove background",
            "cut out",
            "cutout",
            "transparent background",
            "erase background",
            "remove bg",
            "subject cutout",
            "抠图",
            "抠出主体",
            "扣背景",
            "扣除背景",
            "去背景",
            "移除背景",
            "透明背景",
        ],
    ) {
        return ImageEditTool::RemoveBackground;
    }

    if text_contains_any(
        prompt,
        &lower,
        &[
            "watermark",
            "remove watermark",
            "logo cleanup",
            "clean logo",
            "remove logo",
            "去水印",
            "去除水印",
            "清除水印",
            "清理水印",
            "去logo",
            "去标志",
        ],
    ) {
        return ImageEditTool::RemoveWatermark;
    }

    if text_contains_any(
        prompt,
        &lower,
        &[
            "restore face",
            "restore portrait",
            "portrait cleanup",
            "face cleanup",
            "fix face",
            "repair face",
            "修复人脸",
            "修脸",
            "人像修复",
            "人脸修复",
            "肖像修复",
        ],
    ) {
        return ImageEditTool::FaceRestore;
    }

    if text_contains_any(
        prompt,
        &lower,
        &[
            "upscale",
            "enhance",
            "hd",
            "4k",
            "high resolution",
            "super resolution",
            "高清",
            "放大",
            "提高清晰度",
            "超分",
            "变清晰",
            "增强细节",
        ],
    ) {
        return ImageEditTool::Upscale;
    }

    if text_contains_any(
        prompt,
        &lower,
        &[
            "outpaint",
            "uncrop",
            "expand",
            "extend",
            "widen",
            "broaden",
            "pan out",
            "extend the frame",
            "16:9",
            "9:16",
            "21:9",
            "外绘",
            "扩图",
            "扩边",
            "扩展",
            "延展",
            "补全画面",
            "向左扩展",
            "向右扩展",
            "向上扩展",
            "向下扩展",
            "加宽",
            "加高",
            "横向扩展",
            "竖向扩展",
        ],
    ) {
        return ImageEditTool::Outpaint;
    }

    if text_contains_any(
        prompt,
        &lower,
        &[
            "add text",
            "write",
            "headline",
            "caption",
            "title",
            "slogan",
            "type",
            "文字",
            "文本",
            "标题",
            "加字",
            "写上",
            "文案",
            "海报字",
        ],
    ) {
        return ImageEditTool::AddText;
    }

    if text_contains_any(
        prompt,
        &lower,
        &[
            "replace",
            "swap",
            "change to",
            "turn into",
            "turn it into",
            "make it a",
            "make this a",
            "换成",
            "替换",
            "改成",
            "改为",
            "变成",
        ],
    ) {
        return ImageEditTool::ReplaceObject;
    }

    if has_mask
        || text_contains_any(
            prompt,
            &lower,
            &[
                "remove", "erase", "delete", "clean", "cleanup", "clear", "take out", "去掉",
                "移除", "删除", "抹掉", "清理",
            ],
        )
    {
        return ImageEditTool::RemoveObject;
    }

    ImageEditTool::RemoveObject
}

fn infer_outpaint_preset(prompt: &str) -> ImageOutpaintPreset {
    let lower = prompt.to_ascii_lowercase();
    if text_contains_any(
        prompt,
        &lower,
        &[
            "tall",
            "vertical",
            "portrait",
            "top and bottom",
            "up and down",
            "9:16",
            "3:4",
            "向上",
            "向下",
            "上下",
            "竖",
            "加高",
            "竖版",
        ],
    ) {
        return ImageOutpaintPreset::Tall;
    }

    if text_contains_any(
        prompt,
        &lower,
        &[
            "wide",
            "horizontal",
            "landscape",
            "left and right",
            "wider",
            "16:9",
            "21:9",
            "向左",
            "向右",
            "左右",
            "横",
            "加宽",
            "横版",
        ],
    ) {
        return ImageOutpaintPreset::Wide;
    }

    ImageOutpaintPreset::Frame
}

fn text_contains_any(prompt: &str, lower: &str, candidates: &[&str]) -> bool {
    candidates.iter().any(|candidate| {
        if candidate.is_ascii() {
            lower.contains(candidate)
        } else {
            prompt.contains(candidate)
        }
    })
}

fn draw_mask_preview_stroke(
    surface: &mut SkSurface,
    width: i32,
    height: i32,
    stroke: &ImageMaskStroke,
) {
    if stroke.points.is_empty() {
        return;
    }

    let radius = (stroke.radius_norm * width.max(height) as f32 * 2.0).max(4.0);
    let canvas = surface.canvas();
    let mut paint = Paint::default();
    paint.set_anti_alias(true);
    paint.set_style(skia_safe::paint::Style::Stroke);
    paint.set_stroke_width(radius);
    paint.set_stroke_cap(skia_safe::paint::Cap::Round);
    paint.set_stroke_join(skia_safe::paint::Join::Round);
    if stroke.erase {
        paint.set_blend_mode(BlendMode::Clear);
        paint.set_color(Color::TRANSPARENT);
    } else {
        paint.set_blend_mode(BlendMode::SrcOver);
        paint.set_color(Color::from_argb(190, 255, 88, 140));
    }

    if stroke.points.len() == 1 {
        let point = &stroke.points[0];
        canvas.draw_circle(
            (point.x * width as f32, point.y * height as f32),
            radius * 0.5,
            &paint,
        );
        return;
    }

    let mut path = skia_safe::PathBuilder::default();
    for (index, point) in stroke.points.iter().enumerate() {
        let x = point.x * width as f32;
        let y = point.y * height as f32;
        if index == 0 {
            path.move_to((x, y));
        } else {
            path.line_to((x, y));
        }
    }
    canvas.draw_path(&path.detach(), &paint);
}

fn draw_mask_preview_segment(
    surface: &mut SkSurface,
    width: i32,
    height: i32,
    from: Option<&ImageMaskPoint>,
    to: &ImageMaskPoint,
    erase: bool,
    radius_norm: f32,
) {
    let radius = (radius_norm * width.max(height) as f32 * 2.0).max(4.0);
    let canvas = surface.canvas();
    let mut paint = Paint::default();
    paint.set_anti_alias(true);
    paint.set_style(skia_safe::paint::Style::Stroke);
    paint.set_stroke_width(radius);
    paint.set_stroke_cap(skia_safe::paint::Cap::Round);
    paint.set_stroke_join(skia_safe::paint::Join::Round);
    if erase {
        paint.set_blend_mode(BlendMode::Clear);
        paint.set_color(Color::TRANSPARENT);
    } else {
        paint.set_blend_mode(BlendMode::SrcOver);
        paint.set_color(Color::from_argb(190, 255, 88, 140));
    }

    let target = (to.x * width as f32, to.y * height as f32);
    match from {
        Some(start) => {
            let origin = (start.x * width as f32, start.y * height as f32);
            canvas.draw_line(origin, target, &paint);
        }
        None => {
            canvas.draw_circle(target, radius * 0.5, &paint);
        }
    }
}

fn rasterize_mask_strokes(
    output: &mut [u8],
    width: u32,
    height: u32,
    strokes: &[ImageMaskStroke],
    pending: Option<&ImageMaskStroke>,
) {
    for stroke in strokes {
        rasterize_mask_stroke(output, width, height, stroke);
    }
    if let Some(stroke) = pending {
        rasterize_mask_stroke(output, width, height, stroke);
    }
}

fn rasterize_mask_stroke(output: &mut [u8], width: u32, height: u32, stroke: &ImageMaskStroke) {
    if stroke.points.is_empty() {
        return;
    }
    let radius = (stroke.radius_norm * width.max(height) as f32).max(2.0);
    if stroke.points.len() == 1 {
        let point = &stroke.points[0];
        paint_mask_circle(
            output,
            width,
            height,
            point.x * width as f32,
            point.y * height as f32,
            radius,
            !stroke.erase,
        );
        return;
    }

    for segment in stroke.points.windows(2) {
        let start = &segment[0];
        let end = &segment[1];
        let start_x = start.x * width as f32;
        let start_y = start.y * height as f32;
        let end_x = end.x * width as f32;
        let end_y = end.y * height as f32;
        let dx = end_x - start_x;
        let dy = end_y - start_y;
        let distance = (dx * dx + dy * dy).sqrt();
        let steps = (distance / (radius * 0.5)).ceil().max(1.0) as usize;
        for step in 0..=steps {
            let t = step as f32 / steps.max(1) as f32;
            paint_mask_circle(
                output,
                width,
                height,
                start_x + dx * t,
                start_y + dy * t,
                radius,
                !stroke.erase,
            );
        }
    }
}

fn paint_mask_circle(
    output: &mut [u8],
    width: u32,
    height: u32,
    cx: f32,
    cy: f32,
    radius: f32,
    fill: bool,
) {
    let min_x = (cx - radius).floor().max(0.0) as i32;
    let max_x = (cx + radius).ceil().min(width as f32 - 1.0) as i32;
    let min_y = (cy - radius).floor().max(0.0) as i32;
    let max_y = (cy + radius).ceil().min(height as f32 - 1.0) as i32;
    let radius_sq = radius * radius;
    for y in min_y..=max_y {
        for x in min_x..=max_x {
            let dx = x as f32 - cx;
            let dy = y as f32 - cy;
            if dx * dx + dy * dy > radius_sq {
                continue;
            }
            let index = y as usize * width as usize + x as usize;
            output[index] = if fill { 255 } else { 0 };
        }
    }
}

fn build_iopaint_studio_url(source: &str) -> String {
    let encoded = urlencoding::encode(source);
    format!("http://127.0.0.1:3010/dashboard/tools/image.iopaint_studio?source={encoded}")
}

fn open_external_target(target: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        ProcessCommand::new("explorer")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Failed to open target: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        ProcessCommand::new("open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Failed to open target: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        ProcessCommand::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Failed to open target: {e}"))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform for opening external targets".to_string())
}

fn reveal_in_file_manager(path: PathBuf) -> Result<(), String> {
    if !path.exists() {
        return Err("Saved file missing; cannot open folder".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let arg = format!("/select,{}", path.to_string_lossy());
        ProcessCommand::new("explorer")
            .arg(arg)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        ProcessCommand::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to reveal file: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        let folder = path
            .parent()
            .ok_or_else(|| "Failed to resolve folder".to_string())?;
        ProcessCommand::new("xdg-open")
            .arg(folder)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {e}"))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform for auto-open".to_string())
}

fn sanitize_file_name(input: &str) -> String {
    let trimmed = input.trim();
    let fallback = "omniagent-output.bin";
    let source = if trimmed.is_empty() {
        fallback
    } else {
        trimmed
    };
    let mut out = String::with_capacity(source.len());
    for ch in source.chars() {
        if matches!(ch, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
            out.push('_');
        } else {
            out.push(ch);
        }
    }
    let cleaned = out.trim().trim_matches('.').trim();
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned.to_string()
    }
}

fn is_image_file_name(name: &str) -> bool {
    let ext = name
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "avif" | "tiff" | "svg"
    )
}

fn is_image_processing_label(label: &str) -> bool {
    let l = label.to_ascii_lowercase();
    l.contains("generate.image")
        || l.contains("image.")
        || l.contains("image generate")
        || l.contains("image_generation")
        || l.contains("image generation")
        || l.contains("draw image")
        || l.contains("iopaint")
}

fn is_audio_file_name(name: &str) -> bool {
    let ext = name
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    matches!(
        ext.as_str(),
        "mp3" | "wav" | "m4a" | "aac" | "flac" | "ogg" | "opus"
    )
}

fn is_text_file_name(name: &str) -> bool {
    let ext = name
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    matches!(
        ext.as_str(),
        "txt" | "md" | "markdown" | "json" | "csv" | "yaml" | "yml"
    )
}

fn is_video_file_name(name: &str) -> bool {
    let ext = name
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    matches!(
        ext.as_str(),
        "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" | "wmv"
    )
}

fn is_video_processing_label(label: &str) -> bool {
    let l = label.to_ascii_lowercase();
    l.contains("media.download_video")
        || l.contains("video.download")
        || l.contains("video ready")
        || l.contains("video.")
}

fn is_capture_summary_report_label(label: &str) -> bool {
    let l = label.to_ascii_lowercase();
    l.contains("capture.") && l.contains("summary_report")
}

fn capture_summary_report_copy(label: &str) -> (&'static str, &'static str, &'static str) {
    if label
        .trim()
        .eq_ignore_ascii_case("capture.audio_summary_report")
    {
        (
            "Audio report",
            "Audio report ready. Tap download to save.",
            "Markdown notes report. Download to keep.",
        )
    } else {
        (
            "Screen report",
            "Screen report ready. Tap download to save.",
            "Markdown screen report. Download to keep.",
        )
    }
}

fn tool_complete_text(label: &str) -> String {
    if is_image_processing_label(label) {
        return "Image ready".to_string();
    }
    if is_video_processing_label(label) {
        return "Video ready".to_string();
    }
    let lower = label.to_ascii_lowercase();
    if lower.contains("web.search") || lower.contains("net.") || lower.contains("search") {
        return "Search complete".to_string();
    }
    if lower.contains("pdf.")
        || lower.contains("image.")
        || lower.contains("audio.")
        || lower.contains("video.")
        || lower.contains("file.")
    {
        return "Processing complete".to_string();
    }
    "Task complete".to_string()
}

fn normalize_tool_name(label: &str) -> String {
    let raw = label.trim();
    if raw.is_empty() {
        return String::new();
    }
    let lower = raw.to_ascii_lowercase();
    if lower.contains("generate.image")
        || lower.contains("image.")
        || lower.contains("image generate")
        || lower.contains("image_generation")
        || lower.contains("draw image")
        || raw.contains('\u{56fe}')
    {
        return "AI Image".to_string();
    }
    if lower.contains("web.search") || lower.contains("search") || lower.contains("net.") {
        return "Web Search".to_string();
    }
    if lower.contains("music") {
        return "Music".to_string();
    }
    if lower.contains("file")
        || lower.contains("pdf")
        || lower.contains("word")
        || lower.contains("doc")
    {
        return "File Tool".to_string();
    }
    trim_text(raw, 28)
}

fn trim_text(text: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }
    let mut out = String::new();
    let mut count = 0usize;
    for ch in text.chars() {
        if ch == '\n' || ch == '\r' {
            if !out.ends_with(' ') {
                out.push(' ');
                count += 1;
            }
            continue;
        }
        if count >= max_chars {
            break;
        }
        out.push(ch);
        count += 1;
    }
    let trimmed = out.trim();
    if text.chars().count() > max_chars {
        format!("{trimmed}...")
    } else {
        trimmed.to_string()
    }
}

fn shortcut_key_char(key: &Key) -> Option<char> {
    match key {
        Key::Character(text) => text.chars().next().map(|ch| ch.to_ascii_lowercase()),
        _ => None,
    }
}

fn non_empty_text(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn join_copy_parts(parts: &[&str]) -> Option<String> {
    let joined = parts
        .iter()
        .map(|part| part.trim())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if joined.is_empty() {
        None
    } else {
        Some(joined)
    }
}

fn prev_char_boundary(s: &str, pos: usize) -> usize {
    if pos == 0 {
        return 0;
    }
    let mut i = pos - 1;
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shortcut_key_char_normalizes_case() {
        assert_eq!(shortcut_key_char(&Key::Character("V".into())), Some('v'));
    }

    #[test]
    fn active_copy_text_reads_output_surface() {
        let mut app = App::default();
        app.pill_state = PillState::Output;
        app.output_text = "Copied output".to_string();

        assert_eq!(app.active_copy_text(), Some("Copied output".to_string()));
    }

    #[test]
    fn active_copy_text_combines_action_lines() {
        let mut app = App::default();
        app.pill_state = PillState::VideoAction;
        app.action_text = "Video ready".to_string();
        app.action_detail_text = "bilibili | 00:15".to_string();

        assert_eq!(
            app.active_copy_text(),
            Some("Video ready\nbilibili | 00:15".to_string())
        );
    }

    #[test]
    fn input_dimensions_expand_for_long_text() {
        let (_, short_h, _) = input_dimensions(1.0, "short", "", false);
        let (_, long_h, _) = input_dimensions(
            1.0,
            "This is a deliberately long input block used to verify that the dynamic island input surface grows with wrapped text instead of forcing everything into a single line.",
            "",
            false,
        );

        assert!(long_h > short_h);
        assert!(long_h > 44.0);
    }

    #[test]
    fn input_dimensions_expand_for_attached_file_context() {
        let (_, plain_h, _) = input_dimensions(1.0, "", "", false);
        let (_, attached_h, _) = input_dimensions(1.0, "", "", true);
        assert!(attached_h > plain_h);
    }

    #[test]
    fn file_input_dimensions_expand_for_multiline_instructions() {
        let (_, short_h, _) = file_input_dimensions(1.0, "compress pdf", 1, false, false, false);
        let (_, long_h, _) = file_input_dimensions(
            1.0,
            "Extract the main text first.\nThen write a bilingual summary.\nFinally reshape it into a compact 9:16 script.",
            1,
            false,
            false,
            false,
        );

        assert!(long_h > short_h);
        assert!(long_h > 56.0);
    }

    #[test]
    fn output_viewport_tracks_long_content_scroll() {
        let mut viewport = OutputViewportState::default();
        let max_scroll = estimate_output_max_scroll(
            1.0,
            "Paragraph 1. Paragraph 2. Paragraph 3. Paragraph 4. Paragraph 5. Paragraph 6. Paragraph 7. Paragraph 8. Paragraph 9. Paragraph 10.\nParagraph 11. Paragraph 12. Paragraph 13. Paragraph 14. Paragraph 15. Paragraph 16. Paragraph 17. Paragraph 18.\nParagraph 19. Paragraph 20. Paragraph 21. Paragraph 22. Paragraph 23. Paragraph 24. Paragraph 25.",
        );

        assert!(max_scroll > 0.0);
        viewport.set_max_scroll(max_scroll);
        assert!(viewport.at_end());

        assert!(viewport.scroll_by(-40.0));
        assert!(!viewport.at_end());

        assert!(viewport.scroll_to_end());
        assert!(viewport.at_end());
    }

    #[test]
    fn infer_image_edit_tool_detects_background_requests_without_mask() {
        assert_eq!(
            infer_image_edit_tool("remove background and keep the subject clean", false),
            ImageEditTool::RemoveBackground
        );
        assert_eq!(
            infer_image_edit_tool(
                "\u{53bb}\u{80cc}\u{666f}\u{5e76}\u{4fdd}\u{7559}\u{4e3b}\u{4f53}",
                false
            ),
            ImageEditTool::RemoveBackground
        );
        assert_eq!(
            infer_image_edit_tool("\u{6263}\u{9664}\u{80cc}\u{666f}", false),
            ImageEditTool::RemoveBackground
        );
    }

    #[test]
    fn infer_image_edit_tool_detects_watermark_and_upscale_requests() {
        assert_eq!(
            infer_image_edit_tool("remove the watermark cleanly", false),
            ImageEditTool::RemoveWatermark
        );
        assert_eq!(
            infer_image_edit_tool("\u{53bb}\u{9664}\u{6c34}\u{5370}", false),
            ImageEditTool::RemoveWatermark
        );
        assert_eq!(
            infer_image_edit_tool("upscale this to 4k and keep the composition", false),
            ImageEditTool::Upscale
        );
    }

    #[test]
    fn parse_music_query_supports_switch_and_recommendation_phrases() {
        assert_eq!(
            App::parse_music_query("换成 周杰伦 晴天"),
            Some("周杰伦 晴天".to_string())
        );
        assert_eq!(
            App::parse_music_query("来点 city pop"),
            Some("city pop".to_string())
        );
    }

    #[test]
    fn music_progress_fraction_uses_local_duration() {
        let mut app = App::default();
        app.music_playlist = vec![MusicSearchResult {
            id: 1,
            name: "Track".to_string(),
            artist: "Artist".to_string(),
            album: "Album".to_string(),
            cover: String::new(),
            duration: 200,
            playable: true,
            stream_url: None,
        }];
        app.music_current_index = Some(0);
        app.local_playback_base_ms = 50_000;

        let progress = app.current_music_progress_fraction();
        assert!(progress > 0.24 && progress < 0.26);
    }

    #[test]
    fn image_edit_tool_uses_mask_only_for_masked_tools() {
        assert!(image_edit_tool_uses_mask(ImageEditTool::RemoveObject));
        assert!(image_edit_tool_uses_mask(ImageEditTool::ReplaceObject));
        assert!(image_edit_tool_uses_mask(ImageEditTool::AddText));
        assert!(!image_edit_tool_uses_mask(ImageEditTool::Outpaint));
        assert!(!image_edit_tool_uses_mask(ImageEditTool::RemoveBackground));
        assert!(!image_edit_tool_uses_mask(ImageEditTool::RemoveWatermark));
        assert!(!image_edit_tool_uses_mask(ImageEditTool::Upscale));
        assert!(!image_edit_tool_uses_mask(ImageEditTool::FaceRestore));
    }

    #[test]
    fn output_dimensions_expand_before_hitting_cap() {
        let (_, short_h, _) = output_dimensions(1.0, "Short reply.");
        let (_, long_h, _) = output_dimensions(
            1.0,
            "Paragraph 1. Paragraph 2. Paragraph 3. Paragraph 4. Paragraph 5. Paragraph 6. Paragraph 7. Paragraph 8. Paragraph 9. Paragraph 10.\nParagraph 11. Paragraph 12. Paragraph 13. Paragraph 14. Paragraph 15.",
        );

        assert!(long_h >= short_h);
        assert!(long_h <= OUTPUT_MAX_HEIGHT);
    }

    #[test]
    fn focus_start_session_sets_run_state_and_base() {
        let mut app = App::default();
        app.focus_label_text = "Ship focus flow".to_string();
        app.focus_label_cursor = app.focus_label_text.len();

        app.start_focus_session(FocusPhase::Work, 25 * 60 * 1000);

        assert_eq!(app.pill_state, PillState::FocusRun);
        assert_eq!(app.base_pill_state, PillState::FocusRun);
        assert_eq!(app.focus_phase, FocusPhase::Work);
        assert_eq!(app.focus_total_ms, 25 * 60 * 1000);
        assert_eq!(app.focus_remaining_ms, 25 * 60 * 1000);
        assert!(app.focus_running);
        assert!(app.focus_anchor.is_some());
        assert_eq!(app.focus_last_work_total_ms, 25 * 60 * 1000);
    }

    #[test]
    fn focus_advance_completes_into_focus_complete() {
        let mut app = App::default();

        app.start_focus_session(FocusPhase::Work, 25 * 60 * 1000);
        app.advance_focus_session(25 * 60 * 1000);

        assert_eq!(app.pill_state, PillState::FocusComplete);
        assert_eq!(app.base_pill_state, PillState::Idle);
        assert_eq!(app.focus_completion_kind, FocusCompletionKind::WorkFinished);
        assert_eq!(app.focus_remaining_ms, 0);
        assert!(!app.focus_running);
        assert_eq!(app.focus_rounds_completed, 1);
    }

    #[test]
    fn focus_log_progress_prefills_input() {
        let mut app = App::default();
        app.focus_label_text = "Write launch brief".to_string();
        app.focus_label_cursor = app.focus_label_text.len();
        app.focus_last_work_total_ms = 50 * 60 * 1000;
        app.focus_total_ms = app.focus_last_work_total_ms;
        app.focus_remaining_ms = 0;
        app.focus_completion_kind = FocusCompletionKind::WorkFinished;
        app.pill_state = PillState::FocusComplete;

        app.log_focus_progress();

        assert_eq!(app.pill_state, PillState::Input);
        assert!(app.input_text.contains("Write launch brief"));
        assert!(!app.input_text.is_empty());
        assert_eq!(app.focus_total_ms, 0);
        assert_eq!(app.focus_remaining_ms, 0);
    }

    #[test]
    fn restore_last_action_surface_prefers_focus_session() {
        let mut app = App::default();
        app.action_text = "File ready".to_string();
        app.action_download_url = Some("C:/tmp/old.pdf".to_string());
        app.action_requires_download = true;
        app.prepare_file_ready("C:/tmp/new.pdf".to_string());
        app.start_focus_session(FocusPhase::Work, 25 * 60 * 1000);
        app.transition_to(PillState::ToolPanel);

        assert!(app.restore_last_action_surface());
        assert_eq!(app.pill_state, PillState::FocusExpand);
    }

    #[test]
    fn restore_last_action_surface_prefers_audio_capture_before_focus() {
        let mut app = App::default();
        app.audio_capture_running = true;
        app.focus_total_ms = 25 * 60 * 1000;
        app.transition_to(PillState::ToolPanel);

        assert!(app.restore_last_action_surface());
        assert_eq!(app.pill_state, PillState::AudioExpand);
    }

    #[test]
    fn restore_last_action_surface_prefers_screen_capture_before_focus_complete() {
        let mut app = App::default();
        app.screen_capture_running = true;
        app.focus_completion_kind = FocusCompletionKind::WorkFinished;
        app.pill_state = PillState::FocusComplete;
        app.transition_to(PillState::ToolPanel);

        assert!(app.restore_last_action_surface());
        assert_eq!(app.pill_state, PillState::ScreenExpand);
    }

    #[test]
    fn open_stack_studio_reuses_prepared_image_before_picker() {
        let mut app = App::default();
        app.prepare_file_ready("C:/tmp/stack-proof.png".to_string());
        app.transition_to(PillState::ToolPanel);

        app.open_stack_studio();

        assert_eq!(app.pill_state, PillState::ImageEdit);
        assert!(app.action_is_image);
        assert_eq!(app.action_text, "Original image".to_string());
        assert_eq!(
            app.action_download_url,
            Some("C:/tmp/stack-proof.png".to_string())
        );
    }

    #[test]
    fn restore_last_action_surface_returns_pending_file_ready_before_old_result() {
        let mut app = App::default();
        app.action_text = "File ready".to_string();
        app.action_download_url = Some("C:/tmp/old.pdf".to_string());
        app.action_requires_download = true;
        app.prepare_file_ready("C:/tmp/new.pdf".to_string());
        app.transition_to(PillState::ToolPanel);

        assert!(app.restore_last_action_surface());
        assert_eq!(app.pill_state, PillState::FileReady);
    }

    #[test]
    fn restore_last_action_surface_returns_music_expand_when_music_is_live() {
        let mut app = App::default();
        app.music_playlist = vec![MusicSearchResult {
            id: 42,
            name: "Track".to_string(),
            artist: "Artist".to_string(),
            album: "Album".to_string(),
            cover: String::new(),
            duration: 180,
            playable: true,
            stream_url: None,
        }];
        app.music_current_index = Some(0);
        app.transition_to(PillState::ToolPanel);

        assert!(app.restore_last_action_surface());
        assert_eq!(app.pill_state, PillState::MusicExpand);
    }

    #[test]
    fn open_stack_files_prefers_file_ready_over_live_focus() {
        let mut app = App::default();
        app.prepare_file_ready("C:/tmp/new.pdf".to_string());
        app.start_focus_session(FocusPhase::Work, 25 * 60 * 1000);
        app.transition_to(PillState::ToolPanel);

        app.open_stack_files();

        assert_eq!(app.pill_state, PillState::FileReady);
    }

    #[test]
    fn text_file_quick_action_enters_input_with_context() {
        let mut app = App::default();
        app.prepare_file_ready("C:/tmp/transcript.txt".to_string());

        assert!(app.start_file_ready_text_follow_up());
        assert_eq!(app.pill_state, PillState::Input);
        assert!(app.input_file_context_active);
        assert!(app.input_text.is_empty());
    }

    #[test]
    fn open_stack_files_stays_on_file_result_instead_of_music() {
        let mut app = App::default();
        app.action_text = "Compressed PDF".to_string();
        app.action_download_url = Some("C:/tmp/result.pdf".to_string());
        app.action_requires_download = true;
        app.music_playlist = vec![MusicSearchResult {
            id: 7,
            name: "Track".to_string(),
            artist: "Artist".to_string(),
            album: "Album".to_string(),
            cover: String::new(),
            duration: 180,
            playable: true,
            stream_url: None,
        }];
        app.music_current_index = Some(0);
        app.transition_to(PillState::ToolPanel);

        app.open_stack_files();

        assert_eq!(app.pill_state, PillState::FileAction);
    }

    #[test]
    fn open_stack_music_prefers_active_expand_surface() {
        let mut app = App::default();
        app.music_playlist = vec![MusicSearchResult {
            id: 7,
            name: "Track".to_string(),
            artist: "Artist".to_string(),
            album: "Album".to_string(),
            cover: String::new(),
            duration: 180,
            playable: true,
            stream_url: None,
        }];
        app.music_current_index = Some(0);
        app.transition_to(PillState::ToolPanel);

        app.open_stack_music();

        assert_eq!(app.pill_state, PillState::MusicExpand);
    }

    #[test]
    fn open_stack_music_reuses_recent_results_before_new_search() {
        let mut app = App::default();
        app.music_netease_connection_known = true;
        app.music_netease_connected = true;
        app.music_results = vec![MusicSearchResult {
            id: 11,
            name: "Recent".to_string(),
            artist: "Artist".to_string(),
            album: "Album".to_string(),
            cover: String::new(),
            duration: 200,
            playable: true,
            stream_url: None,
        }];
        app.transition_to(PillState::ToolPanel);

        app.open_stack_music();

        assert_eq!(app.pill_state, PillState::MusicResults);
    }

    #[test]
    fn open_stack_music_requires_auth_when_netease_is_not_connected() {
        let mut app = App::default();
        app.music_netease_connection_known = true;
        app.music_netease_connected = false;
        app.transition_to(PillState::ToolPanel);

        app.open_stack_music();

        assert_eq!(app.pill_state, PillState::MusicAuth);
    }

    #[test]
    fn capture_summary_report_label_is_not_treated_as_video_or_image() {
        assert!(is_capture_summary_report_label(
            "capture.audio_summary_report"
        ));
        assert!(!is_video_processing_label("capture.audio_summary_report"));
        assert!(!is_image_processing_label("capture.audio_summary_report"));
    }

    #[test]
    fn capture_summary_report_copy_is_tool_specific() {
        assert_eq!(
            capture_summary_report_copy("capture.audio_summary_report"),
            (
                "Audio report",
                "Audio report ready. Tap download to save.",
                "Markdown notes report. Download to keep."
            )
        );
        assert_eq!(
            capture_summary_report_copy("capture.screen_summary_report"),
            (
                "Screen report",
                "Screen report ready. Tap download to save.",
                "Markdown screen report. Download to keep."
            )
        );
    }
}

fn next_char_boundary(s: &str, pos: usize) -> usize {
    if pos >= s.len() {
        return s.len();
    }
    let mut i = pos + 1;
    while i < s.len() && !s.is_char_boundary(i) {
        i += 1;
    }
    i
}
