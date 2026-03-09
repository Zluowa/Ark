// @input: HTTP POST requests on 127.0.0.1:9800, internal mpsc from ai_client
// @output: Command enum variants parsed from JSON or pushed programmatically
// @position: External control channel — replaces Named Pipe IPC

use crate::core::lyrics::LyricLine;
use crate::core::music_client::MusicSearchResult;
use crate::core::types::{AiState, ToolStatus, VoiceState};
use serde::Deserialize;
use std::sync::mpsc;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
#[allow(dead_code)]
pub enum Command {
    AiUpdate {
        state: AiState,
        snippet: Option<String>,
    },
    ShowNotification {
        title: String,
        body: String,
        ttl_ms: u64,
    },
    ToolProgress {
        name: String,
        progress: f32,
        status: ToolStatus,
    },
    FileProcessed {
        label: String,
        file_name: String,
        download_url: String,
        #[serde(default)]
        aspect_ratio: Option<String>,
        #[serde(default)]
        preview_url: Option<String>,
        #[serde(default)]
        editor_url: Option<String>,
        #[serde(default)]
        detail_text: Option<String>,
    },
    FileProcessFailed {
        message: String,
    },
    DownloadFinished {
        success: bool,
        message: String,
        #[serde(default)]
        saved_path: Option<String>,
    },
    ActionThumbnailReady {
        bytes: Vec<u8>,
    },
    VoiceUpdate {
        state: VoiceState,
        duration_ms: u64,
        waveform: Option<Vec<f32>>,
    },
    TimerUpdate {
        label: String,
        remaining_ms: u64,
        total_ms: u64,
    },
    OpenFocus,
    FocusSetLabel {
        text: String,
    },
    FocusSetDuration {
        total_ms: u64,
    },
    FocusStart,
    FocusPause,
    FocusResume,
    FocusSkip,
    FocusStartBreak,
    FocusLogProgress,
    FocusAdvance {
        elapsed_ms: u64,
    },
    OpenAudioNotes,
    AudioNotesStart,
    AudioNotesStop,
    AudioNotesSetSourceFile {
        path: String,
    },
    AudioNotesCaptured {
        path: String,
        duration_ms: u64,
    },
    AudioNotesCaptureFailed {
        message: String,
    },
    OpenScreenRecord,
    ScreenRecordStart,
    ScreenRecordStop,
    ScreenRecordCaptured {
        path: String,
        duration_ms: u64,
    },
    ScreenRecordCaptureFailed {
        message: String,
    },
    MusicConnectionStatus {
        connected: bool,
        #[serde(default)]
        status: String,
        #[serde(default)]
        account_name: String,
    },
    MusicAuthStarted {
        session_id: String,
        status: String,
        qr_image_data_url: String,
    },
    MusicAuthStatus {
        session_id: String,
        status: String,
        #[serde(default)]
        qr_image_data_url: Option<String>,
        #[serde(default)]
        account_name: Option<String>,
    },
    MusicSearchResults {
        #[serde(default)]
        results: Vec<MusicSearchResult>,
        #[serde(default)]
        context_label: Option<String>,
        #[serde(default)]
        authorized: bool,
    },
    MusicCoverReady {
        song_id: u64,
        bytes: Vec<u8>,
    },
    MusicSearchSetQuery {
        query: String,
    },
    MusicSearchSubmit,
    LocalLyricsReady {
        title: String,
        artist: String,
        #[serde(default)]
        lines: Vec<LyricLine>,
    },
    ProcessFile {
        path: String,
        #[serde(default)]
        instruction: String,
    },
    PrepareFileReady {
        path: String,
    },
    ActivateFileReadyQuickAction,
    SubmitFileReady,
    SubmitFileReadyWithInstruction {
        instruction: String,
    },
    SubmitInputWithText {
        text: String,
    },
    ProcessFiles {
        paths: Vec<String>,
        #[serde(default)]
        instruction: String,
    },
    ClipboardPaste,
    ClipboardCopy,
    ClipboardCut,
    ContextAction,
    OpenImagePreview,
    BeginImageEdit,
    ImageEditSelectTool {
        tool: String,
    },
    ImageEditSetPrompt {
        text: String,
    },
    ImageEditAddMaskRect {
        left_norm: f32,
        top_norm: f32,
        width_norm: f32,
        height_norm: f32,
    },
    ImageEditApply,
    OpenStack,
    WriteDebugState {
        path: String,
    },
    Expand,
    Collapse,
    Shutdown,
}

pub struct CommandChannel {
    rx: mpsc::Receiver<Command>,
    pub tx: mpsc::Sender<Command>,
}

impl CommandChannel {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel();
        let http_tx = tx.clone();

        std::thread::spawn(move || {
            let server = match tiny_http::Server::http("127.0.0.1:9800") {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[command] bind failed: {e}");
                    return;
                }
            };

            for mut req in server.incoming_requests() {
                let response = handle_request(&mut req, &http_tx);
                if let Err(e) = req.respond(response) {
                    eprintln!("[command] respond error: {e}");
                }
            }
        });

        Self { rx, tx }
    }

    pub fn try_recv(&self) -> Option<Command> {
        self.rx.try_recv().ok()
    }
}

fn handle_request(
    req: &mut tiny_http::Request,
    tx: &mpsc::Sender<Command>,
) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    if req.method() != &tiny_http::Method::Post {
        return text_response(405, "Method Not Allowed");
    }

    let mut body = String::new();
    if req.as_reader().read_to_string(&mut body).is_err() {
        return text_response(400, "Bad Request: unreadable body");
    }

    match serde_json::from_str::<Command>(&body) {
        Ok(cmd) => {
            let _ = tx.send(cmd);
            text_response(200, "OK")
        }
        Err(e) => {
            eprintln!("[command] parse error: {e}");
            text_response(400, "Bad Request: invalid JSON")
        }
    }
}

fn text_response(code: u16, body: &str) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    tiny_http::Response::from_string(body).with_status_code(code)
}
