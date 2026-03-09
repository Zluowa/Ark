// @input: NetEase search/auth requests and mpsc::Sender<Command>
// @output: Music-related commands sent back to the main thread
// @position: Background HTTP client - connects native island to local app service

use crate::core::command::Command;
use std::sync::mpsc;
use std::time::{Duration, Instant};

const SEARCH_URL: &str = "http://127.0.0.1:3010/api/music/search";
const RECOMMEND_URL: &str = "http://127.0.0.1:3010/api/music/recommend?limit=6";
const AUDIO_URL: &str = "http://127.0.0.1:3010/api/music/url";
const CONNECTION_URL: &str = "http://127.0.0.1:3010/api/v1/connections/netease";
const AUTH_START_URL: &str = "http://127.0.0.1:3010/api/v1/connections/netease/auth";
const AUTH_STATUS_URL: &str = "http://127.0.0.1:3010/api/v1/connections/netease/auth";

pub fn search(query: String, tx: mpsc::Sender<Command>) {
    std::thread::spawn(move || {
        let started_at = Instant::now();
        let url = format!("{SEARCH_URL}?q={}&limit=6", urlencoded(&query));
        match ureq::get(&url).call() {
            Ok(resp) => {
                if let Ok(body) = resp.into_json::<SearchResponse>() {
                    sleep_for_min_visible(started_at);
                    let _ = tx.send(Command::MusicSearchResults {
                        results: body.songs,
                        context_label: body.context_label,
                        authorized: body.authorized,
                    });
                } else {
                    let _ = tx.send(Command::ShowNotification {
                        title: "Music search".to_string(),
                        body: "Invalid response from backend".to_string(),
                        ttl_ms: 2200,
                    });
                }
            }
            Err(e) => {
                let _ = tx.send(Command::ShowNotification {
                    title: "Music search".to_string(),
                    body: friendly_transport_error(e),
                    ttl_ms: 2600,
                });
            }
        }
    });
}

pub fn load_recommendations(tx: mpsc::Sender<Command>) {
    std::thread::spawn(move || match ureq::get(RECOMMEND_URL).call() {
        Ok(resp) => {
            if let Ok(body) = resp.into_json::<SearchResponse>() {
                let _ = tx.send(Command::MusicSearchResults {
                    results: body.songs,
                    context_label: body.context_label.or(Some("For you".to_string())),
                    authorized: body.authorized,
                });
            } else {
                let _ = tx.send(Command::ShowNotification {
                    title: "NetEase".to_string(),
                    body: "Invalid recommendation response".to_string(),
                    ttl_ms: 2200,
                });
            }
        }
        Err(e) => {
            let _ = tx.send(Command::ShowNotification {
                title: "NetEase".to_string(),
                body: friendly_transport_error(e),
                ttl_ms: 2600,
            });
        }
    });
}

pub fn fetch_connection_status(tx: mpsc::Sender<Command>) {
    std::thread::spawn(move || match ureq::get(CONNECTION_URL).call() {
        Ok(resp) => {
            if let Ok(body) = resp.into_json::<MusicConnectionResponse>() {
                let _ = tx.send(Command::MusicConnectionStatus {
                    connected: body.connected,
                    status: body.status,
                    account_name: body
                        .account
                        .map(|account| account.nickname)
                        .unwrap_or_default(),
                });
            } else {
                let _ = tx.send(Command::ShowNotification {
                    title: "NetEase".to_string(),
                    body: "Invalid connection status response".to_string(),
                    ttl_ms: 2200,
                });
            }
        }
        Err(e) => {
            let _ = tx.send(Command::ShowNotification {
                title: "NetEase".to_string(),
                body: friendly_transport_error(e),
                ttl_ms: 2600,
            });
        }
    });
}

pub fn start_auth(tx: mpsc::Sender<Command>) {
    std::thread::spawn(move || match ureq::post(AUTH_START_URL).call() {
        Ok(resp) => {
            if let Ok(body) = resp.into_json::<MusicAuthResponse>() {
                let _ = tx.send(Command::MusicAuthStarted {
                    session_id: body.session_id,
                    status: body.status,
                    qr_image_data_url: body.qr_image_base64,
                });
            } else {
                let _ = tx.send(Command::ShowNotification {
                    title: "NetEase".to_string(),
                    body: "Invalid auth response".to_string(),
                    ttl_ms: 2200,
                });
            }
        }
        Err(e) => {
            let _ = tx.send(Command::ShowNotification {
                title: "NetEase".to_string(),
                body: friendly_transport_error(e),
                ttl_ms: 2600,
            });
        }
    });
}

pub fn poll_auth(session_id: String, tx: mpsc::Sender<Command>) {
    std::thread::spawn(move || {
        let url = format!("{AUTH_STATUS_URL}/{session_id}");
        match ureq::get(&url).call() {
            Ok(resp) => {
                if let Ok(body) = resp.into_json::<MusicAuthResponse>() {
                    let _ = tx.send(Command::MusicAuthStatus {
                        session_id: body.session_id,
                        status: body.status,
                        qr_image_data_url: Some(body.qr_image_base64),
                        account_name: body.account.map(|account| account.nickname),
                    });
                } else {
                    let _ = tx.send(Command::ShowNotification {
                        title: "NetEase".to_string(),
                        body: "Invalid auth status response".to_string(),
                        ttl_ms: 2200,
                    });
                }
            }
            Err(e) => {
                let _ = tx.send(Command::ShowNotification {
                    title: "NetEase".to_string(),
                    body: friendly_transport_error(e),
                    ttl_ms: 2600,
                });
            }
        }
    });
}

pub fn audio_url(id: u64) -> String {
    format!("{AUDIO_URL}?id={id}")
}

fn sleep_for_min_visible(started_at: Instant) {
    let min_visible = Duration::from_millis(420);
    let elapsed = started_at.elapsed();
    if elapsed < min_visible {
        std::thread::sleep(min_visible - elapsed);
    }
}

fn urlencoded(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => String::from(b as char),
            _ => format!("%{:02X}", b),
        })
        .collect()
}

fn friendly_transport_error(err: ureq::Error) -> String {
    match err {
        ureq::Error::Status(code, resp) => {
            let body = resp.into_string().unwrap_or_default();
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&body) {
                if let Some(message) = value.get("error").and_then(|v| v.as_str()) {
                    return format!("HTTP {code}: {message}");
                }
                if let Some(message) = value
                    .get("error")
                    .and_then(|v| v.get("message"))
                    .and_then(|v| v.as_str())
                {
                    return format!("HTTP {code}: {message}");
                }
            }
            format!("HTTP {code}: request failed")
        }
        ureq::Error::Transport(t) => {
            let msg = t.to_string();
            let lower = msg.to_ascii_lowercase();
            if lower.contains("connection refused")
                || lower.contains("timed out")
                || lower.contains("dns")
                || lower.contains("failed to connect")
            {
                "Backend unavailable: start app service on 3010".to_string()
            } else {
                format!("Network error: {msg}")
            }
        }
    }
}

#[derive(serde::Deserialize)]
struct SearchResponse {
    #[serde(default)]
    songs: Vec<MusicSearchResult>,
    #[serde(default)]
    context_label: Option<String>,
    #[serde(default)]
    authorized: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MusicAuthResponse {
    session_id: String,
    status: String,
    #[serde(default)]
    qr_image_base64: String,
    #[serde(default)]
    qr_url: String,
    #[serde(default)]
    account: Option<MusicAccountSummary>,
}

#[derive(serde::Deserialize)]
struct MusicConnectionResponse {
    connected: bool,
    status: String,
    #[serde(default)]
    account: Option<MusicAccountSummary>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MusicAccountSummary {
    nickname: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MusicSearchResult {
    pub id: u64,
    pub name: String,
    pub artist: String,
    #[serde(default)]
    pub album: String,
    pub cover: String,
    pub duration: u64,
    pub playable: bool,
    #[serde(default)]
    pub stream_url: Option<String>,
}
