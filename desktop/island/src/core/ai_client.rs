// @input: User message text, mpsc::Sender<Command>
// @output: AiUpdate commands pushed to main thread via channel
// @position: Background thread; connects to Next.js /api/chat

use crate::core::command::Command;
use crate::core::music_client::{self, MusicSearchResult};
use crate::core::types::{AiState, ToolStatus};
use std::io::BufRead;
use std::sync::mpsc;
use std::time::Duration;

const CHAT_URL: &str = "http://127.0.0.1:3010/api/chat";

pub fn send_chat(message: String, tx: mpsc::Sender<Command>) {
    std::thread::spawn(move || {
        let _ = tx.send(Command::AiUpdate {
            state: AiState::Thinking,
            snippet: None,
        });

        let body = serde_json::json!({
            "messages": [{
                "id": "island-msg",
                "role": "user",
                "content": &message,
                "parts": [{ "type": "text", "text": &message }]
            }],
            "source": "island"
        });

        let agent = ureq::AgentBuilder::new()
            .try_proxy_from_env(false)
            .timeout_connect(Duration::from_secs(10))
            .timeout(Duration::from_secs(90))
            .build();

        let resp = match agent
            .post(CHAT_URL)
            .set("Content-Type", "application/json")
            .set("x-omni-source", "island")
            .send_string(&body.to_string())
        {
            Ok(r) => r,
            Err(e) => {
                let msg = friendly_transport_error(e);
                let _ = tx.send(Command::AiUpdate {
                    state: AiState::Error,
                    snippet: Some(msg),
                });
                return;
            }
        };

        // Parse Vercel AI SDK v6 SSE stream.
        let reader = std::io::BufReader::new(resp.into_reader());
        let mut full_text = String::new();
        let mut saw_finish = false;
        let mut music_tool_triggered = false;
        let mut file_output_emitted = false;
        let mut tool_output_seen = false;
        let user_music_query = parse_music_query_from_user_message(&message);

        for line in reader.lines().map_while(Result::ok) {
            let data = match line.strip_prefix("data: ") {
                Some(d) => d,
                None => continue,
            };
            let Ok(obj) = serde_json::from_str::<serde_json::Value>(data) else {
                continue;
            };

            let evt_type = obj.get("type").and_then(|v| v.as_str());
            let tool_start_event = matches!(
                evt_type,
                Some("tool-input-available" | "tool-call" | "tool-call-start" | "tool-input-start")
            );
            let tool_delta_event = matches!(evt_type, Some("tool-input-delta" | "tool-call-delta"));

            if tool_start_event {
                notify_tool_event(&obj, &tx, true);
            }
            if tool_start_event || tool_delta_event {
                maybe_trigger_music_search_from_tool(
                    &obj,
                    &tx,
                    &mut music_tool_triggered,
                    user_music_query.as_deref(),
                );
            }
            if matches!(evt_type, Some("tool-output-available" | "tool-result")) {
                tool_output_seen = true;
                notify_tool_event(&obj, &tx, false);
                maybe_emit_music_results_from_tool(&obj, &tx, &mut music_tool_triggered);
                maybe_emit_file_from_tool(&obj, &tx, &mut file_output_emitted);
            }

            match evt_type {
                Some("text-delta") => {
                    if file_output_emitted || music_tool_triggered {
                        continue;
                    }
                    if let Some(delta) = obj
                        .get("delta")
                        .or_else(|| obj.get("textDelta"))
                        .and_then(|v| v.as_str())
                    {
                        full_text.push_str(delta);
                        let _ = tx.send(Command::AiUpdate {
                            state: AiState::Streaming,
                            snippet: Some(full_text.clone()),
                        });
                    }
                }
                Some("finish") => {
                    saw_finish = true;
                    break;
                }
                Some("error") => {
                    let msg = obj
                        .get("errorText")
                        .or_else(|| obj.get("message"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown error");
                    let lower = msg.to_ascii_lowercase();
                    let thought_signature_missing = lower.contains("thought_signature")
                        || lower.contains("missing a thought signature")
                        || lower.contains("missing thought signature")
                        || lower.contains("missing a thought_signature");
                    if thought_signature_missing
                        && (tool_output_seen || music_tool_triggered || file_output_emitted)
                    {
                        if file_output_emitted
                            || music_tool_triggered
                            || full_text.trim().is_empty()
                        {
                            let _ = tx.send(Command::AiUpdate {
                                state: AiState::Idle,
                                snippet: None,
                            });
                        } else {
                            let _ = tx.send(Command::AiUpdate {
                                state: AiState::Complete,
                                snippet: Some(full_text.clone()),
                            });
                        }
                        return;
                    }
                    if (lower.contains("function call missing")
                        || lower.contains("missing function")
                        || lower.contains("tool call missing")
                        || lower.contains("missing tool call")
                        || lower.contains("missing_tool_call")
                        || lower.contains("tool_call_missing"))
                        && !music_tool_triggered
                    {
                        if let Some(query) = user_music_query.clone() {
                            let _ = tx.send(Command::ShowNotification {
                                title: "Music fallback".to_string(),
                                body: format!("Searching: {query}"),
                                ttl_ms: 1200,
                            });
                            music_client::search(query, tx.clone());
                            let _ = tx.send(Command::AiUpdate {
                                state: AiState::Idle,
                                snippet: None,
                            });
                            return;
                        }
                    }
                    let _ = tx.send(Command::AiUpdate {
                        state: AiState::Error,
                        snippet: Some(msg.to_string()),
                    });
                    return;
                }
                Some("start" | "text-start" | "text-end" | "reasoning") => {}
                _ => {}
            }
        }

        if file_output_emitted {
            let _ = tx.send(Command::AiUpdate {
                state: AiState::Idle,
                snippet: None,
            });
            return;
        }

        if !music_tool_triggered {
            if let Some(query) = user_music_query.clone() {
                if !query.trim().is_empty() {
                    let _ = tx.send(Command::ShowNotification {
                        title: "Music fallback".to_string(),
                        body: format!("Searching: {query}"),
                        ttl_ms: 1000,
                    });
                    music_client::search(query, tx.clone());
                    let _ = tx.send(Command::AiUpdate {
                        state: AiState::Idle,
                        snippet: None,
                    });
                    return;
                }
            }
        }

        if full_text.trim().is_empty() {
            if music_tool_triggered || file_output_emitted {
                let _ = tx.send(Command::AiUpdate {
                    state: AiState::Idle,
                    snippet: None,
                });
                return;
            }
            let message = if saw_finish {
                "Chat backend returned empty response".to_string()
            } else {
                "Chat backend timed out or has no response".to_string()
            };
            let _ = tx.send(Command::AiUpdate {
                state: AiState::Error,
                snippet: Some(message),
            });
            return;
        }

        if music_tool_triggered || file_output_emitted {
            let _ = tx.send(Command::AiUpdate {
                state: AiState::Idle,
                snippet: None,
            });
            return;
        }

        let _ = tx.send(Command::AiUpdate {
            state: AiState::Complete,
            snippet: Some(full_text),
        });
    });
}

fn maybe_trigger_music_search_from_tool(
    evt: &serde_json::Value,
    tx: &mpsc::Sender<Command>,
    already_triggered: &mut bool,
    fallback_query: Option<&str>,
) {
    if *already_triggered {
        return;
    }

    let tool_name = extract_tool_name(evt)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if tool_name.is_empty() {
        return;
    }

    if !is_music_tool_name(&tool_name) {
        return;
    }

    let mut query = extract_music_query(evt);
    if query.trim().is_empty() {
        if let Some(fallback) = fallback_query {
            query = fallback.to_string();
        }
    }
    if query.trim().is_empty() {
        return;
    }

    *already_triggered = true;
    let _ = tx.send(Command::ShowNotification {
        title: "Music tool".to_string(),
        body: format!("Searching: {query}"),
        ttl_ms: 1300,
    });

    music_client::search(query, tx.clone());
}

fn maybe_emit_music_results_from_tool(
    evt: &serde_json::Value,
    tx: &mpsc::Sender<Command>,
    already_triggered: &mut bool,
) {
    if *already_triggered {
        return;
    }

    let tool_name = extract_tool_name(evt)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if tool_name.is_empty() || !is_music_tool_name(&tool_name) {
        return;
    }

    let mut parsed: Option<Vec<MusicSearchResult>> = None;
    for key in [
        "output",
        "result",
        "data",
        "toolOutput",
        "tool_output",
        "response",
    ] {
        if let Some(v) = evt.get(key) {
            parsed = extract_music_results(v);
            if parsed.as_ref().is_some_and(|list| !list.is_empty()) {
                break;
            }
        }
    }

    if parsed.is_none() {
        parsed = extract_music_results(evt);
    }
    let Some(results) = parsed else {
        return;
    };
    if results.is_empty() {
        return;
    }

    *already_triggered = true;
    let _ = tx.send(Command::MusicSearchResults {
        results,
        context_label: None,
        authorized: false,
    });
}

fn notify_tool_event(evt: &serde_json::Value, tx: &mpsc::Sender<Command>, starting: bool) {
    let Some(tool_name) = extract_tool_name(evt) else {
        return;
    };
    if starting {
        let _ = tx.send(Command::ToolProgress {
            name: tool_name.clone(),
            progress: 0.35,
            status: ToolStatus::Running,
        });
    } else {
        let _ = tx.send(Command::ToolProgress {
            name: tool_name.clone(),
            progress: 1.0,
            status: ToolStatus::Complete,
        });
    }
    let _ = tx.send(Command::ShowNotification {
        title: if starting {
            "AI tool call".to_string()
        } else {
            "Tool completed".to_string()
        },
        body: tool_name,
        ttl_ms: if starting { 900 } else { 1100 },
    });
}

fn maybe_emit_file_from_tool(
    evt: &serde_json::Value,
    tx: &mpsc::Sender<Command>,
    already_emitted: &mut bool,
) {
    if *already_emitted {
        return;
    }

    let Some(url) = extract_output_file_url(evt) else {
        return;
    };
    if !looks_like_file_url(&url) {
        return;
    }

    let tool_name = extract_tool_name(evt).unwrap_or_else(|| "tool.output".to_string());
    let file_name = infer_file_name(evt, &url, &tool_name);
    let label = infer_file_label(&tool_name, &url);
    let aspect_ratio = extract_aspect_ratio(evt);
    let preview_url = extract_preview_url(evt);
    let editor_url = if is_image_url(&url) {
        Some(build_iopaint_studio_url(
            preview_url.as_deref().unwrap_or(url.as_str()),
        ))
    } else {
        None
    };
    let detail_text = extract_detail_text(evt);

    let _ = tx.send(Command::FileProcessed {
        label,
        file_name,
        download_url: url.clone(),
        aspect_ratio,
        preview_url,
        editor_url,
        detail_text,
    });
    let _ = tx.send(Command::ShowNotification {
        title: if is_image_url(&url) {
            "Image ready".to_string()
        } else if is_video_tool_name(&tool_name) || is_video_url(&url) {
            "Video ready".to_string()
        } else {
            "File ready".to_string()
        },
        body: "Saved action available in Dynamic Island".to_string(),
        ttl_ms: 1300,
    });
    *already_emitted = true;
}

fn extract_tool_name(evt: &serde_json::Value) -> Option<String> {
    evt.get("toolName")
        .or_else(|| evt.get("tool_name"))
        .or_else(|| evt.get("name"))
        .and_then(|v| v.as_str())
        .map(|name| name.replace('_', "."))
}

fn extract_output_file_url(evt: &serde_json::Value) -> Option<String> {
    for key in ["output", "result", "data", "toolOutput", "response"] {
        if let Some(value) = evt.get(key) {
            if let Some(url) = extract_url_from_value(value) {
                return Some(url);
            }
        }
    }
    extract_url_from_value(evt)
}

fn extract_url_from_value(value: &serde_json::Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        let cleaned: String = text
            .chars()
            .filter(|ch| !matches!(ch, '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{FEFF}'))
            .collect();
        let trimmed = cleaned.trim();
        if trimmed.is_empty() {
            return None;
        }
        if trimmed.starts_with("http://")
            || trimmed.starts_with("https://")
            || trimmed.starts_with("/api/")
        {
            return Some(trimmed.to_string());
        }
        if (trimmed.starts_with('{') && trimmed.ends_with('}'))
            || (trimmed.starts_with('[') && trimmed.ends_with(']'))
        {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
                return extract_url_from_value(&parsed);
            }
        }
        return None;
    }

    if let Some(obj) = value.as_object() {
        for key in [
            "output_file_url",
            "output_url",
            "download_url",
            "file_url",
            "url",
            "image_url",
            "preview_url",
        ] {
            if let Some(raw) = obj.get(key) {
                if let Some(url) = extract_url_from_value(raw) {
                    return Some(url);
                }
            }
        }
        for key in ["output", "result", "data", "payload", "content"] {
            if let Some(raw) = obj.get(key) {
                if let Some(url) = extract_url_from_value(raw) {
                    return Some(url);
                }
            }
        }
        return None;
    }

    if let Some(arr) = value.as_array() {
        for item in arr {
            if let Some(url) = extract_url_from_value(item) {
                return Some(url);
            }
        }
    }
    None
}

fn looks_like_file_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("/api/v1/files/")
}

fn is_image_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.contains(".png")
        || lower.contains(".jpg")
        || lower.contains(".jpeg")
        || lower.contains(".webp")
        || lower.contains(".gif")
        || lower.contains(".avif")
        || lower.contains("image")
}

fn is_video_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.contains(".mp4")
        || lower.contains(".mov")
        || lower.contains(".avi")
        || lower.contains(".mkv")
        || lower.contains(".webm")
}

fn is_image_tool_name(tool_name: &str) -> bool {
    let lower = tool_name.to_ascii_lowercase();
    let normalized = lower.replace('_', ".");
    normalized.contains("generate.image")
        || normalized.contains("image.generate")
        || normalized.contains(".image")
        || normalized.starts_with("image.")
}

fn is_video_tool_name(tool_name: &str) -> bool {
    let lower = tool_name.to_ascii_lowercase();
    let normalized = lower.replace('_', ".");
    normalized.contains("media.download.video")
        || normalized.contains("media.video.info")
        || normalized.contains("video.")
}

fn infer_file_label(tool_name: &str, url: &str) -> String {
    let lower_tool = tool_name.to_ascii_lowercase();
    let normalized_tool = lower_tool.replace('_', ".");
    if normalized_tool.contains("generate.image") || normalized_tool.contains("image.generate") {
        return "Image generated".to_string();
    }
    if normalized_tool.contains("media.download.video") {
        return "Video ready".to_string();
    }
    if normalized_tool.contains("media.download.audio") {
        return "Audio downloaded".to_string();
    }
    if is_image_url(url) {
        return "Image ready".to_string();
    }
    if is_video_url(url) {
        return "Video ready".to_string();
    }
    "Result ready".to_string()
}

fn extract_aspect_ratio(value: &serde_json::Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        let normalized = text.trim().replace('\u{ff1a}', ":");
        for ratio in [
            "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21",
        ] {
            if normalized.eq_ignore_ascii_case(ratio) {
                return Some(ratio.to_string());
            }
        }
        match normalized.to_ascii_lowercase().as_str() {
            "square" => return Some("1:1".to_string()),
            "landscape" => return Some("16:9".to_string()),
            "portrait" => return Some("9:16".to_string()),
            _ => return None,
        }
    }

    if let Some(obj) = value.as_object() {
        for key in ["aspect_ratio", "aspectRatio"] {
            if let Some(raw) = obj.get(key) {
                if let Some(found) = extract_aspect_ratio(raw) {
                    return Some(found);
                }
            }
        }
        for nested_key in [
            "output",
            "result",
            "data",
            "toolOutput",
            "tool_output",
            "response",
        ] {
            if let Some(raw) = obj.get(nested_key) {
                if let Some(found) = extract_aspect_ratio(raw) {
                    return Some(found);
                }
            }
        }
    }

    if let Some(arr) = value.as_array() {
        for item in arr {
            if let Some(found) = extract_aspect_ratio(item) {
                return Some(found);
            }
        }
    }

    None
}

fn infer_file_name(evt: &serde_json::Value, url: &str, tool_name: &str) -> String {
    for key in ["file_name", "filename", "name"] {
        if let Some(value) = evt.get(key).and_then(|v| v.as_str()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return sanitize_file_name(trimmed);
            }
        }
    }

    if let Some(title) = extract_title(evt) {
        let ext = file_extension_for_result(url, tool_name);
        return sanitize_file_name(&format!("{title}.{ext}"));
    }

    if let Some(idx) = url.rfind('/') {
        let candidate = &url[idx + 1..];
        let no_query = candidate.split('?').next().unwrap_or_default().trim();
        if !no_query.is_empty() && no_query.contains('.') {
            return sanitize_file_name(no_query);
        }
    }

    let ext = file_extension_for_result(url, tool_name);
    let normalized_tool = tool_name.replace('.', "_");
    sanitize_file_name(&format!("{normalized_tool}_output.{ext}"))
}

fn file_extension_for_result(url: &str, tool_name: &str) -> &'static str {
    if is_image_url(url) || is_image_tool_name(tool_name) {
        "png"
    } else if is_video_url(url) || is_video_tool_name(tool_name) {
        "mp4"
    } else if tool_name.to_ascii_lowercase().contains("audio") {
        "mp3"
    } else {
        "bin"
    }
}

fn extract_title(evt: &serde_json::Value) -> Option<String> {
    extract_string_field(evt, &["title", "name"])
}

fn extract_preview_url(evt: &serde_json::Value) -> Option<String> {
    extract_string_field(evt, &["thumbnail", "thumbnail_url", "cover", "cover_url"])
}

fn build_iopaint_studio_url(source: &str) -> String {
    let encoded = urlencoding::encode(source);
    format!("http://127.0.0.1:3010/dashboard/tools/image.iopaint_studio?source={encoded}")
}

fn extract_detail_text(evt: &serde_json::Value) -> Option<String> {
    let title = extract_title(evt);
    let duration = extract_string_field(evt, &["duration_str", "duration"]);
    let platform = extract_string_field(evt, &["platform", "uploader", "channel"]);

    let mut parts = Vec::new();
    if let Some(value) = title {
        parts.push(value);
    }
    if let Some(value) = platform {
        parts.push(value);
    }
    if let Some(value) = duration {
        parts.push(value);
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" · "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_download_video_prefers_mp4_extension_for_api_urls() {
        let name = infer_file_name(
            &serde_json::json!({ "output": { "title": "clip" } }),
            "/api/v1/files/abc123",
            "media.download_video",
        );

        assert!(name.ends_with(".mp4"));
    }

    #[test]
    fn media_download_video_uses_video_ready_label() {
        assert_eq!(
            infer_file_label("media.download.video", "/api/v1/files/abc123"),
            "Video ready"
        );
    }

    #[test]
    fn normalized_video_tool_name_is_detected() {
        assert!(is_video_tool_name("media.download.video"));
    }
}

fn extract_string_field(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    if let Some(text) = value.as_str() {
        let cleaned: String = text
            .chars()
            .filter(|ch| !matches!(ch, '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{FEFF}'))
            .collect();
        let trimmed = cleaned.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
        return None;
    }

    if let Some(obj) = value.as_object() {
        for key in keys {
            if let Some(raw) = obj.get(*key) {
                if let Some(text) = extract_string_field(raw, keys) {
                    return Some(text);
                }
            }
        }
        for nested_key in [
            "output",
            "result",
            "data",
            "toolOutput",
            "tool_output",
            "response",
        ] {
            if let Some(raw) = obj.get(nested_key) {
                if let Some(text) = extract_string_field(raw, keys) {
                    return Some(text);
                }
            }
        }
    }

    None
}

fn sanitize_file_name(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        if matches!(ch, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
            out.push('_');
        } else {
            out.push(ch);
        }
    }
    let trimmed = out.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "omniagent-output.bin".to_string()
    } else {
        trimmed.to_string()
    }
}

fn extract_music_query(evt: &serde_json::Value) -> String {
    for key in [
        "input",
        "args",
        "arguments",
        "parameters",
        "inputDelta",
        "toolInputDelta",
        "delta",
    ] {
        if let Some(v) = evt.get(key) {
            let q = extract_music_query_value(v);
            if !q.is_empty() {
                return q;
            }
        }
    }
    String::new()
}

fn is_music_tool_name(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.contains("music")
        || n.contains("song")
        || n.contains("play")
        || n.contains("audio")
        || n.contains("netease")
        || n.contains("player")
}

fn extract_music_query_value(value: &serde_json::Value) -> String {
    if let Some(s) = value.as_str() {
        let trimmed = s.trim();
        if trimmed.is_empty() {
            return String::new();
        }
        if (trimmed.starts_with('{') && trimmed.ends_with('}'))
            || (trimmed.starts_with('[') && trimmed.ends_with(']'))
        {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
                let nested = extract_music_query_value(&v);
                if !nested.is_empty() {
                    return nested;
                }
            }
        }
        return trimmed.to_string();
    }

    if let Some(obj) = value.as_object() {
        for key in [
            "query", "q", "keyword", "song", "name", "text", "title", "artist", "prompt",
        ] {
            if let Some(raw) = obj.get(key) {
                let q = extract_music_query_value(raw);
                if !q.is_empty() {
                    return q;
                }
            }
        }
        for nested_key in [
            "input",
            "args",
            "arguments",
            "parameters",
            "inputDelta",
            "toolInputDelta",
            "delta",
        ] {
            if let Some(nested) = obj.get(nested_key) {
                let q = extract_music_query_value(nested);
                if !q.is_empty() {
                    return q;
                }
            }
        }
        return String::new();
    }

    if let Some(arr) = value.as_array() {
        for item in arr {
            let q = extract_music_query_value(item);
            if !q.is_empty() {
                return q;
            }
        }
    }

    if let Some(num) = value.as_u64() {
        return num.to_string();
    }

    if let Some(num) = value.as_i64() {
        return num.to_string();
    }

    if let Some(num) = value.as_f64() {
        return num.to_string();
    }

    if let Some(boolean) = value.as_bool() {
        return boolean.to_string();
    }

    String::new()
}

fn extract_music_results(value: &serde_json::Value) -> Option<Vec<MusicSearchResult>> {
    if let Some(s) = value.as_str() {
        let trimmed = s.trim();
        if trimmed.is_empty() {
            return None;
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
            return extract_music_results(&v);
        }
        return None;
    }

    if let Some(obj) = value.as_object() {
        for key in [
            "songs", "list", "results", "data", "items", "json", "output",
        ] {
            if let Some(v) = obj.get(key) {
                if let Some(results) = extract_music_results(v) {
                    return Some(results);
                }
            }
        }
        if let Some(song) = parse_music_song(obj) {
            return Some(vec![song]);
        }
        return None;
    }

    if let Some(arr) = value.as_array() {
        let mut out = Vec::new();
        for item in arr {
            if let Some(obj) = item.as_object() {
                if let Some(song) = parse_music_song(obj) {
                    out.push(song);
                }
            }
        }
        if !out.is_empty() {
            return Some(out);
        }
    }

    None
}

fn parse_music_song(obj: &serde_json::Map<String, serde_json::Value>) -> Option<MusicSearchResult> {
    let id = read_u64(obj, &["id", "songId", "song_id"])?;
    let name = read_str(obj, &["name", "title", "song"]).unwrap_or_default();
    let artist = read_str(obj, &["artist", "singer", "author", "artists"]).unwrap_or_default();
    let cover = read_str(obj, &["cover", "picUrl", "pic", "image", "albumPic"]).unwrap_or_default();
    let duration = read_u64(obj, &["duration", "dt", "length"]).unwrap_or(0);
    let playable = read_bool(obj, &["playable", "canPlay", "available"]).unwrap_or(true);
    let stream_url = read_str(obj, &["stream_url", "streamUrl", "url", "audioUrl"]);
    Some(MusicSearchResult {
        id,
        name,
        artist,
        album: String::new(),
        cover,
        duration,
        playable,
        stream_url,
    })
}

fn read_str(obj: &serde_json::Map<String, serde_json::Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(v) = obj.get(*key) {
            if let Some(s) = v.as_str() {
                let trimmed = s.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
            if let Some(arr) = v.as_array() {
                let mut items = Vec::new();
                for item in arr {
                    if let Some(s) = item.as_str() {
                        let t = s.trim();
                        if !t.is_empty() {
                            items.push(t.to_string());
                        }
                    } else if let Some(o) = item.as_object() {
                        if let Some(name) = read_str(o, &["name"]) {
                            items.push(name);
                        }
                    }
                }
                if !items.is_empty() {
                    return Some(items.join(", "));
                }
            }
            if let Some(o) = v.as_object() {
                if let Some(name) = read_str(o, &["name"]) {
                    return Some(name);
                }
            }
        }
    }
    None
}

fn read_u64(obj: &serde_json::Map<String, serde_json::Value>, keys: &[&str]) -> Option<u64> {
    for key in keys {
        if let Some(v) = obj.get(*key) {
            if let Some(n) = v.as_u64() {
                return Some(n);
            }
            if let Some(n) = v.as_i64() {
                if n >= 0 {
                    return Some(n as u64);
                }
            }
            if let Some(s) = v.as_str() {
                if let Ok(n) = s.trim().parse::<u64>() {
                    return Some(n);
                }
            }
        }
    }
    None
}

fn read_bool(obj: &serde_json::Map<String, serde_json::Value>, keys: &[&str]) -> Option<bool> {
    for key in keys {
        if let Some(v) = obj.get(*key) {
            if let Some(b) = v.as_bool() {
                return Some(b);
            }
            if let Some(n) = v.as_i64() {
                return Some(n != 0);
            }
            if let Some(s) = v.as_str() {
                let l = s.trim().to_ascii_lowercase();
                if l == "true" || l == "1" || l == "yes" {
                    return Some(true);
                }
                if l == "false" || l == "0" || l == "no" {
                    return Some(false);
                }
            }
        }
    }
    None
}

fn parse_music_query_from_user_message(raw: &str) -> Option<String> {
    let normalized = raw.trim().replace('\u{3000}', " ");
    if normalized.is_empty() {
        return None;
    }

    for prefix in [
        "/music ",
        "music ",
        "song ",
        "play ",
        "播放 ",
        "播放",
        "搜歌 ",
        "搜歌",
        "点歌 ",
        "点歌",
        "来一首 ",
        "来一首",
    ] {
        if let Some(rest) = normalized.strip_prefix(prefix) {
            if let Some(query) = clean_music_query(rest) {
                return Some(query);
            }
        }
    }

    for marker in ["播放", "来一首", "点歌", "搜歌", "听", "play "] {
        if let Some(idx) = normalized.find(marker) {
            let start = idx + marker.len();
            if start <= normalized.len() {
                let rest = &normalized[start..];
                if let Some(query) = clean_music_query(rest) {
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
            c.is_ascii_punctuation() || "，。！？；：、（）【】「」《》“”‘’".contains(c)
        })
        .to_string();
    if query.is_empty() {
        return None;
    }

    for leading in ["一个", "一首", "首", "个", "请", "帮我", "给我", "让我"] {
        if let Some(rest) = query.strip_prefix(leading) {
            query = rest.trim().to_string();
        }
    }

    for trailing in [
        "的歌", "歌曲", "歌", "音乐", "听", "吧", "呀", "呢", "please", "pls",
    ] {
        query = query.trim_end_matches(trailing).trim().to_string();
    }

    if query.is_empty() || query.chars().count() <= 1 {
        return None;
    }
    Some(query)
}

fn friendly_transport_error(err: ureq::Error) -> String {
    match err {
        ureq::Error::Transport(t) => {
            let msg = t.to_string();
            let lower = msg.to_ascii_lowercase();
            if lower.contains("connection refused")
                || lower.contains("timed out")
                || lower.contains("dns")
                || lower.contains("failed to connect")
            {
                "Backend unavailable: start app service on http://127.0.0.1:3010".to_string()
            } else {
                format!("Network error: {msg}")
            }
        }
        ureq::Error::Status(code, resp) => {
            let body = resp.into_string().unwrap_or_default();
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&body) {
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
    }
}
