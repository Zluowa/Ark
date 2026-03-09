// @input: None (pure configuration)
// @output: PillState enum, pill_dimensions(), AppConfig, constants
// @position: Core configuration — defines OmniAgent island state sizing/timing

use serde::{Deserialize, Serialize};

pub const APP_VERSION: &str = "1.0.0";
pub const APP_AUTHOR: &str = "Eatgrapes";
pub const APP_HOMEPAGE: &str = "https://github.com/Eatgrapes/WinIsland";
pub const WINDOW_TITLE: &str = "OmniAgent";
pub const TOP_OFFSET: i32 = 10;
pub const PADDING: f32 = 80.0;

// Motion timing system (ms): feedback / component / sheet / settle
pub const MOTION_FEEDBACK_MS: u64 = 120;
pub const MOTION_COMPONENT_MS: u64 = 180;
pub const MOTION_SHEET_MS: u64 = 280;
pub const MOTION_SETTLE_MS: u64 = 420;
const IMAGE_PREVIEW_SQUARE_SIDE: f32 = 340.0;
const IMAGE_PREVIEW_LONG_SIDE: f32 = 400.0;
const IMAGE_PREVIEW_MIN_SIDE: f32 = 170.0;
const IMAGE_PREVIEW_CORNER_RADIUS: f32 = 42.0;
const IMAGE_PREVIEW_MIN_RATIO: f32 = 9.0 / 21.0;
const IMAGE_PREVIEW_MAX_RATIO: f32 = 21.0 / 9.0;
const FOCUS_SETUP_WIDTH: f32 = 360.0;
const FOCUS_SETUP_HEIGHT: f32 = 212.0;
const FOCUS_SETUP_CORNER_RADIUS: f32 = 40.0;
const FOCUS_RUN_WIDTH: f32 = 300.0;
const FOCUS_RUN_HEIGHT: f32 = 42.0;
const FOCUS_RUN_CORNER_RADIUS: f32 = 21.0;
const AUDIO_RUN_WIDTH: f32 = 130.0;
const AUDIO_RUN_HEIGHT: f32 = 36.0;
const AUDIO_RUN_CORNER_RADIUS: f32 = 18.0;
const AUDIO_EXPAND_WIDTH: f32 = 366.0;
const AUDIO_EXPAND_HEIGHT: f32 = 150.0;
const AUDIO_EXPAND_CORNER_RADIUS: f32 = 38.0;
const SCREEN_RUN_WIDTH: f32 = 100.0;
const SCREEN_RUN_HEIGHT: f32 = 36.0;
const SCREEN_RUN_CORNER_RADIUS: f32 = 18.0;
const SCREEN_EXPAND_WIDTH: f32 = 366.0;
const SCREEN_EXPAND_HEIGHT: f32 = 120.0;
const SCREEN_EXPAND_CORNER_RADIUS: f32 = 38.0;
const MUSIC_AUTH_WIDTH: f32 = 360.0;
const MUSIC_AUTH_HEIGHT: f32 = 224.0;
const MUSIC_AUTH_CORNER_RADIUS: f32 = 40.0;
const FOCUS_EXPAND_WIDTH: f32 = 360.0;
const FOCUS_EXPAND_HEIGHT: f32 = 180.0;
const FOCUS_EXPAND_CORNER_RADIUS: f32 = 40.0;
const FOCUS_COMPLETE_WIDTH: f32 = 340.0;
const FOCUS_COMPLETE_HEIGHT: f32 = 132.0;
const FOCUS_COMPLETE_CORNER_RADIUS: f32 = 36.0;
const IMAGE_EDIT_MIN_CANVAS_WIDTH: f32 = 232.0;
const IMAGE_EDIT_MAX_CANVAS_WIDTH: f32 = 364.0;
pub const IMAGE_EDIT_HEIGHT: f32 = 392.0;
pub const IMAGE_EDIT_CORNER_RADIUS: f32 = 42.0;
pub const IMAGE_EDIT_CANVAS_TOP: f32 = 18.0;
pub const IMAGE_EDIT_CANVAS_SIDE_PADDING: f32 = 18.0;
pub const IMAGE_EDIT_CANVAS_BOTTOM_GAP: f32 = 120.0;
pub const IMAGE_EDIT_PROMPT_TOP: f32 = 300.0;
pub const IMAGE_EDIT_PROMPT_HEIGHT: f32 = 54.0;
pub const IMAGE_EDIT_ACTION_TOP: f32 = 360.0;
pub const IMAGE_EDIT_ACTION_HEIGHT: f32 = 28.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageEditTool {
    RemoveObject,
    ReplaceObject,
    AddText,
    Outpaint,
    RemoveBackground,
    RemoveWatermark,
    Upscale,
    FaceRestore,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageEditBrushMode {
    Paint,
    Erase,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageOutpaintPreset {
    Wide,
    Tall,
    Frame,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusPhase {
    Work,
    Break,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusCompletionKind {
    WorkFinished,
    BreakFinished,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ImageMaskPoint {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ImageMaskStroke {
    pub erase: bool,
    pub radius_norm: f32,
    pub points: Vec<ImageMaskPoint>,
}

#[derive(Debug, Clone, PartialEq)]
#[allow(dead_code)]
pub enum PillState {
    // 01 Idle Island
    Idle,
    // Native Focus / Pomodoro setup
    FocusSetup,
    // Native Focus compact running surface
    FocusRun,
    // Native Audio Notes compact recording surface
    AudioRun,
    // Native Audio Notes expanded controls
    AudioExpand,
    // Native Screen Record compact recording surface
    ScreenRun,
    // Native Screen Record expanded controls
    ScreenExpand,
    // NetEase QR auth sheet
    MusicAuth,
    // Native Focus expanded controls
    FocusExpand,
    // Native Focus completion decision
    FocusComplete,
    // Extra activity surfaces (music)
    MusicSearch,
    MusicResults,
    MusicWave,
    MusicLyric,
    MusicExpand,
    // 06 Stack View
    ToolPanel,
    // 02 Compose Sheet
    Input,
    // Transitional AI pulse (kept for compatibility; rendered as Run-lite)
    Thinking,
    // Text delivery result
    Output,
    // Drag attract state
    DragHover,
    // 03 Intake State
    FileReady,
    // File processing run sheet (compact breathing core)
    FileProcessing,
    // 04 Run Sheet
    Processing,
    // Image generation run sheet
    ImageProcessing,
    // 05 Delivery Sheet
    Action,
    // File processing delivery sheet
    FileAction,
    // Video download delivery sheet
    VideoAction,
    // Image generation delivery sheet (thumbnail row)
    ImageAction,
    // Image zoom preview sheet
    ImagePreview,
    // Native lightweight image edit sheet
    ImageEdit,
}

fn image_edit_dimensions(scale: f32, image_ratio: Option<f32>) -> (f32, f32, f32) {
    let ratio = image_ratio
        .unwrap_or(1.0)
        .clamp(IMAGE_PREVIEW_MIN_RATIO, IMAGE_PREVIEW_MAX_RATIO);
    let canvas_height = IMAGE_EDIT_HEIGHT - IMAGE_EDIT_CANVAS_TOP - IMAGE_EDIT_CANVAS_BOTTOM_GAP;
    let canvas_width =
        (canvas_height * ratio).clamp(IMAGE_EDIT_MIN_CANVAS_WIDTH, IMAGE_EDIT_MAX_CANVAS_WIDTH);
    let width = canvas_width + IMAGE_EDIT_CANVAS_SIDE_PADDING * 2.0;
    (
        width * scale,
        IMAGE_EDIT_HEIGHT * scale,
        IMAGE_EDIT_CORNER_RADIUS * scale,
    )
}

/// (width, height, corner_radius) for each pill state — mockup spec
pub fn pill_dimensions(state: &PillState, scale: f32) -> (f32, f32, f32) {
    let (w, h, r) = match state {
        // Idle Island (compact)
        PillState::Idle => (120.0, 36.0, 18.0),
        PillState::FocusSetup => (
            FOCUS_SETUP_WIDTH,
            FOCUS_SETUP_HEIGHT,
            FOCUS_SETUP_CORNER_RADIUS,
        ),
        PillState::FocusRun => (FOCUS_RUN_WIDTH, FOCUS_RUN_HEIGHT, FOCUS_RUN_CORNER_RADIUS),
        PillState::AudioRun => (AUDIO_RUN_WIDTH, AUDIO_RUN_HEIGHT, AUDIO_RUN_CORNER_RADIUS),
        PillState::AudioExpand => (
            AUDIO_EXPAND_WIDTH,
            AUDIO_EXPAND_HEIGHT,
            AUDIO_EXPAND_CORNER_RADIUS,
        ),
        PillState::ScreenRun => (
            SCREEN_RUN_WIDTH,
            SCREEN_RUN_HEIGHT,
            SCREEN_RUN_CORNER_RADIUS,
        ),
        PillState::ScreenExpand => (
            SCREEN_EXPAND_WIDTH,
            SCREEN_EXPAND_HEIGHT,
            SCREEN_EXPAND_CORNER_RADIUS,
        ),
        PillState::MusicAuth => (
            MUSIC_AUTH_WIDTH,
            MUSIC_AUTH_HEIGHT,
            MUSIC_AUTH_CORNER_RADIUS,
        ),
        PillState::FocusExpand => (
            FOCUS_EXPAND_WIDTH,
            FOCUS_EXPAND_HEIGHT,
            FOCUS_EXPAND_CORNER_RADIUS,
        ),
        PillState::FocusComplete => (
            FOCUS_COMPLETE_WIDTH,
            FOCUS_COMPLETE_HEIGHT,
            FOCUS_COMPLETE_CORNER_RADIUS,
        ),
        PillState::MusicSearch => (340.0, 44.0, 22.0),
        PillState::MusicResults => (360.0, 260.0, 36.0),
        PillState::MusicWave => (240.0, 36.0, 18.0),
        PillState::MusicLyric => (300.0, 36.0, 18.0),
        PillState::MusicExpand => (360.0, 180.0, 40.0),
        // Stack
        PillState::ToolPanel => (312.0, 386.0, 30.0),
        // Compose
        PillState::Input => (340.0, 44.0, 22.0),
        // Run-lite (AI handoff)
        PillState::Thinking => (160.0, 36.0, 18.0),
        // Delivery (borderless long text sheet)
        PillState::Output => (360.0, 200.0, 40.0),
        // Drag capture hover
        PillState::DragHover => (200.0, 64.0, 32.0),
        // Intake
        PillState::FileReady => (332.0, 54.0, 27.0),
        PillState::FileProcessing => (100.0, 44.0, 22.0),
        // Run
        PillState::Processing => (220.0, 36.0, 18.0),
        PillState::ImageProcessing => (180.0, 36.0, 18.0),
        // Delivery
        PillState::Action => (240.0, 40.0, 20.0),
        PillState::FileAction => (292.0, 60.0, 30.0),
        PillState::VideoAction => (286.0, 60.0, 30.0),
        PillState::ImageAction => (234.0, 60.0, 30.0),
        PillState::ImagePreview => (
            IMAGE_PREVIEW_SQUARE_SIDE,
            IMAGE_PREVIEW_SQUARE_SIDE,
            IMAGE_PREVIEW_CORNER_RADIUS,
        ),
        PillState::ImageEdit => return image_edit_dimensions(scale, None),
    };
    (w * scale, h * scale, r * scale)
}

pub fn pill_dimensions_with_image_ratio(
    state: &PillState,
    scale: f32,
    image_ratio: Option<f32>,
) -> (f32, f32, f32) {
    if state == &PillState::ImageEdit {
        return image_edit_dimensions(scale, image_ratio);
    }

    if state != &PillState::ImagePreview {
        return pill_dimensions(state, scale);
    }

    let ratio = image_ratio
        .unwrap_or(1.0)
        .clamp(IMAGE_PREVIEW_MIN_RATIO, IMAGE_PREVIEW_MAX_RATIO);

    if (ratio - 1.0).abs() <= 0.08 {
        return pill_dimensions(state, scale);
    }

    let (w, h) = if ratio >= 1.0 {
        (
            IMAGE_PREVIEW_LONG_SIDE,
            (IMAGE_PREVIEW_LONG_SIDE / ratio)
                .clamp(IMAGE_PREVIEW_MIN_SIDE, IMAGE_PREVIEW_LONG_SIDE),
        )
    } else {
        (
            (IMAGE_PREVIEW_LONG_SIDE * ratio)
                .clamp(IMAGE_PREVIEW_MIN_SIDE, IMAGE_PREVIEW_LONG_SIDE),
            IMAGE_PREVIEW_LONG_SIDE,
        )
    };

    (w * scale, h * scale, IMAGE_PREVIEW_CORNER_RADIUS * scale)
}

/// Max dimensions across all states (for OS window sizing)
pub fn pill_max_dimensions(scale: f32) -> (f32, f32) {
    (420.0 * scale, 490.0 * scale)
}

pub fn transition_duration_ms(from: &PillState, to: &PillState) -> u64 {
    if from == to {
        return MOTION_FEEDBACK_MS;
    }
    match to {
        // Attract + feedback
        PillState::DragHover | PillState::Thinking => MOTION_FEEDBACK_MS,
        // Small component swap
        PillState::MusicSearch
        | PillState::MusicResults
        | PillState::MusicWave
        | PillState::MusicLyric
        | PillState::AudioRun
        | PillState::ScreenRun
        | PillState::FocusRun
        | PillState::Idle => MOTION_COMPONENT_MS,
        // Sheet expand / collapse
        PillState::FocusSetup
        | PillState::AudioExpand
        | PillState::ScreenExpand
        | PillState::MusicAuth
        | PillState::FocusExpand
        | PillState::Input
        | PillState::ToolPanel
        | PillState::FileReady
        | PillState::FileProcessing
        | PillState::Processing
        | PillState::ImageProcessing
        | PillState::Output
        | PillState::MusicExpand
        | PillState::ImagePreview
        | PillState::ImageEdit => MOTION_SHEET_MS,
        // Result settle
        PillState::FocusComplete
        | PillState::Action
        | PillState::FileAction
        | PillState::VideoAction
        | PillState::ImageAction => MOTION_SETTLE_MS,
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct AppConfig {
    pub global_scale: f32,
    pub adaptive_border: bool,
    pub motion_blur: bool,
    pub smtc_enabled: bool,
    pub smtc_apps: Vec<String>,
    #[serde(default = "default_show_lyrics")]
    pub show_lyrics: bool,
    #[serde(default = "default_custom_font")]
    pub custom_font_path: Option<String>,
    #[serde(default = "default_auto_collapse_ms")]
    pub auto_collapse_ms: u64,
    #[serde(default = "default_download_dir")]
    pub download_dir: String,
}

fn default_show_lyrics() -> bool {
    true
}
fn default_custom_font() -> Option<String> {
    None
}
fn default_auto_collapse_ms() -> u64 {
    8000
}
fn default_download_dir() -> String {
    dirs::download_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .to_string_lossy()
        .to_string()
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            global_scale: 1.0,
            adaptive_border: false,
            motion_blur: true,
            smtc_enabled: true,
            smtc_apps: Vec::new(),
            show_lyrics: true,
            custom_font_path: None,
            auto_collapse_ms: 8000,
            download_dir: default_download_dir(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{pill_dimensions_with_image_ratio, PillState};

    #[test]
    fn image_edit_sheet_width_tracks_image_ratio() {
        let (tall_w, tall_h, _) =
            pill_dimensions_with_image_ratio(&PillState::ImageEdit, 1.0, Some(0.7));
        let (square_w, square_h, _) =
            pill_dimensions_with_image_ratio(&PillState::ImageEdit, 1.0, Some(1.0));
        let (wide_w, wide_h, _) =
            pill_dimensions_with_image_ratio(&PillState::ImageEdit, 1.0, Some(1.6));

        assert_eq!(tall_h, square_h);
        assert_eq!(square_h, wide_h);
        assert!(tall_w < square_w);
        assert!(square_w < wide_w);
    }
}
