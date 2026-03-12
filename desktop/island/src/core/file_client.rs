// @input: local file path + optional instruction
// @output: Command events for processing progress, result artifact, and download status
// @position: Background worker layer for real file workflow

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::core::command::Command;
use crate::core::types::ToolStatus;

const EXECUTE_TIMEOUT_SECS: u64 = 120;
const EXECUTE_TIMEOUT_IMAGE_SECS: u64 = 300;
const MAX_INLINE_REFERENCE_BYTES: usize = 512 * 1024;

#[derive(Debug, Deserialize, Clone)]
struct UploadedFile {
    #[allow(dead_code)]
    name: String,
    url: String,
    executor_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UploadResponse {
    files: Vec<UploadedFile>,
}

#[derive(Debug, Deserialize)]
struct ExecuteResponse {
    status: String,
    result: Option<Value>,
    error: Option<ExecuteError>,
}

#[derive(Debug, Deserialize)]
struct ExecuteError {
    message: Option<String>,
}

#[derive(Debug, Clone)]
struct ExecutionPlan {
    tool: String,
    params: Value,
    output_ext: Option<String>,
}

pub fn process_file(path: String, instruction: String, tx: mpsc::Sender<Command>) {
    process_files(vec![path], instruction, tx);
}

pub fn process_files(paths: Vec<String>, instruction: String, tx: mpsc::Sender<Command>) {
    std::thread::spawn(move || {
        let normalized_paths: Vec<String> = paths
            .into_iter()
            .map(|path| path.trim().to_string())
            .filter(|path| !path.is_empty())
            .collect();
        if normalized_paths.is_empty() {
            let _ = tx.send(Command::FileProcessFailed {
                message: "No file selected".to_string(),
            });
            return;
        }

        let display_name = file_name(&normalized_paths[0]);
        let ext = file_ext(&normalized_paths[0]);
        let cleaned_instruction = instruction.trim().to_string();
        let inline_source_url = if normalized_paths.len() == 1 {
            inline_data_url_from_path(&normalized_paths[0], &ext)
        } else {
            None
        };

        let _ = tx.send(Command::ToolProgress {
            name: "file.upload".to_string(),
            progress: 0.12,
            status: ToolStatus::Running,
        });

        let mut uploaded = Vec::<UploadedFile>::new();
        let mut file_urls = Vec::<String>::new();
        let mut inline_plan = None::<ExecutionPlan>;
        match upload_files(&normalized_paths) {
            Ok(files) => {
                file_urls = files
                    .iter()
                    .map(|file| {
                        file.executor_url
                            .clone()
                            .unwrap_or_else(|| absolute_url(&file.url))
                    })
                    .collect();
                uploaded = files;
            }
            Err(err) => {
                if let Some(inline_url) = inline_source_url.clone() {
                    match choose_plan(
                        &normalized_paths,
                        &ext,
                        &cleaned_instruction,
                        &[inline_url.clone()],
                    ) {
                        Ok(Some(plan)) => {
                            file_urls.push(inline_url);
                            inline_plan = Some(plan);
                        }
                        Ok(None) => {
                            let _ = tx.send(Command::FileProcessFailed {
                                message: format!("Upload failed: {err}"),
                            });
                            return;
                        }
                        Err(plan_err) => {
                            let _ = tx.send(Command::FileProcessFailed { message: plan_err });
                            return;
                        }
                    }
                } else {
                    let _ = tx.send(Command::FileProcessFailed {
                        message: format!("Upload failed: {err}"),
                    });
                    return;
                }
            }
        }

        let source_fallback_url = uploaded
            .first()
            .and_then(|file| {
                file.executor_url
                    .clone()
                    .or_else(|| Some(absolute_url(&file.url)))
            })
            .or_else(|| inline_source_url.clone())
            .unwrap_or_default();

        if normalized_paths.len() == 1
            && is_image_ext(&ext)
            && is_iopaint_editor_instruction(&cleaned_instruction)
        {
            let source_url = file_urls.first().cloned().unwrap_or_default();
            let preview_url = source_url.clone();
            let (preset, placement, autorun, detail_text) =
                detect_iopaint_studio_options(&cleaned_instruction);
            let editor_url =
                build_iopaint_studio_url_with_options(&preview_url, preset, placement, autorun);
            let _ = tx.send(Command::FileProcessed {
                label: "image.iopaint_studio".to_string(),
                file_name: display_name,
                download_url: source_url,
                aspect_ratio: None,
                preview_url: Some(preview_url),
                editor_url: Some(editor_url),
                detail_text: Some(detail_text.to_string()),
            });
            return;
        }
        let plan = if let Some(plan) = inline_plan {
            Some(plan)
        } else {
            match choose_plan(&normalized_paths, &ext, &cleaned_instruction, &file_urls) {
                Ok(plan) => plan,
                Err(err) => {
                    let _ = tx.send(Command::FileProcessFailed { message: err });
                    return;
                }
            }
        };

        if let Some(plan) = plan {
            let _ = tx.send(Command::ToolProgress {
                name: plan.tool.clone(),
                progress: 0.58,
                status: ToolStatus::Running,
            });

            let result = match execute_plan(&plan) {
                Ok(v) => v,
                Err(err) => {
                    let _ = tx.send(Command::FileProcessFailed {
                        message: format!("Processing failed: {err}"),
                    });
                    return;
                }
            };

            let final_name = output_file_name(&display_name, plan.output_ext.as_deref());
            let aspect_ratio = extract_result_aspect_ratio(&result);
            let url = extract_download_url(&result)
                .map(|u| absolute_url(&u))
                .or_else(|| {
                    materialize_result_artifact(&result, &final_name, plan.output_ext.as_deref())
                })
                .unwrap_or_else(|| source_fallback_url.clone());
            let preview_url = if is_image_ext(plan.output_ext.as_deref().unwrap_or_default()) {
                Some(url.clone())
            } else {
                extract_preview_url(&result).map(|u| absolute_url(&u))
            };
            let editor_url = extract_editor_url(&result).or_else(|| {
                if is_image_ext(plan.output_ext.as_deref().unwrap_or_default()) {
                    preview_url
                        .as_ref()
                        .or(Some(&url))
                        .map(|value| build_iopaint_studio_url(value))
                } else {
                    None
                }
            });
            let detail_text = extract_detail_text(&result);

            let _ = tx.send(Command::FileProcessed {
                label: format!("{} complete", plan.tool),
                file_name: final_name,
                download_url: url,
                aspect_ratio,
                preview_url,
                editor_url,
                detail_text,
            });
            return;
        }

        let _ = tx.send(Command::FileProcessed {
            label: "file.upload complete".to_string(),
            file_name: display_name,
            download_url: source_fallback_url,
            aspect_ratio: None,
            preview_url: None,
            editor_url: None,
            detail_text: None,
        });
    });
}

pub fn process_image_edit(
    source: String,
    mode: String,
    prompt: String,
    mask_data_url: Option<String>,
    outpaint: (u32, u32, u32, u32),
    tx: mpsc::Sender<Command>,
) {
    std::thread::spawn(move || {
        let cleaned_source = source.trim().to_string();
        if cleaned_source.is_empty() {
            let _ = tx.send(Command::FileProcessFailed {
                message: "Image source is missing".to_string(),
            });
            return;
        }

        let (source_url, inferred_editor_url) = match resolve_image_source(&cleaned_source) {
            Ok(resolved) => resolved,
            Err(err) => {
                let _ = tx.send(Command::FileProcessFailed {
                    message: format!("Image source failed: {err}"),
                });
                return;
            }
        };

        let mode = mode.trim().to_string();
        let cleaned_prompt = prompt.trim().to_string();
        let _ = tx.send(Command::ToolProgress {
            name: mode.clone(),
            progress: 0.18,
            status: ToolStatus::Running,
        });

        let tool = match mode.as_str() {
            "image.remove_object" => "image.remove_object",
            "image.replace_object" => "image.replace_object",
            "image.add_text" => "image.add_text",
            "image.outpaint" => "image.outpaint",
            "image.remove_background" => "image.remove_background",
            "image.remove_watermark" => "image.remove_watermark",
            "image.upscale" => "image.upscale",
            "image.face_restore" => "image.face_restore",
            _ => {
                let _ = tx.send(Command::FileProcessFailed {
                    message: format!("Unsupported image edit mode: {mode}"),
                });
                return;
            }
        };

        let params = match tool {
            "image.remove_object" => json!({
                "file_url": source_url,
                "mask_url": mask_data_url.unwrap_or_default(),
                "prompt": cleaned_prompt,
            }),
            "image.replace_object" => json!({
                "file_url": source_url,
                "mask_url": mask_data_url.unwrap_or_default(),
                "prompt": cleaned_prompt,
            }),
            "image.add_text" => {
                let (text_value, style_value, prompt_value) =
                    split_text_tool_prompt(&cleaned_prompt);
                json!({
                    "file_url": source_url,
                    "mask_url": mask_data_url.unwrap_or_default(),
                    "text": text_value,
                    "style": style_value,
                    "prompt": prompt_value,
                })
            }
            "image.outpaint" => {
                let (top, right, bottom, left) = outpaint;
                json!({
                    "file_url": source_url,
                    "top": top,
                    "right": right,
                    "bottom": bottom,
                    "left": left,
                    "prompt": cleaned_prompt,
                })
            }
            "image.remove_background" => json!({
                "file_url": source_url,
                "mode": "auto",
                "prompt": cleaned_prompt,
            }),
            "image.remove_watermark" => json!({
                "file_url": source_url,
                "placement": detect_watermark_placement(&cleaned_prompt),
                "mode": "auto",
                "prompt": cleaned_prompt,
            }),
            "image.upscale" => json!({
                "file_url": source_url,
                "scale": parse_image_scale(&cleaned_prompt),
                "mode": "auto",
                "prompt": cleaned_prompt,
            }),
            "image.face_restore" => json!({
                "file_url": source_url,
                "engine": detect_face_restore_engine(&cleaned_prompt),
            }),
            _ => Value::Null,
        };

        let plan = ExecutionPlan {
            tool: tool.to_string(),
            params,
            output_ext: Some("png".to_string()),
        };

        let result = match execute_plan(&plan) {
            Ok(v) => v,
            Err(err) => {
                let _ = tx.send(Command::FileProcessFailed {
                    message: format!("Image edit failed: {err}"),
                });
                return;
            }
        };

        let download_url = extract_download_url(&result)
            .map(|u| absolute_url(&u))
            .or_else(|| materialize_result_artifact(&result, "image-edit.png", Some("png")))
            .unwrap_or_else(|| source_url.clone());
        let preview_url = extract_preview_url(&result)
            .map(|u| absolute_url(&u))
            .or_else(|| Some(download_url.clone()));
        let editor_url = extract_editor_url(&result)
            .or_else(|| {
                preview_url
                    .as_ref()
                    .or(Some(&download_url))
                    .map(|value| build_iopaint_studio_url(value))
            })
            .or(inferred_editor_url);
        let detail_text = extract_detail_text(&result);

        let _ = tx.send(Command::FileProcessed {
            label: format!("{tool} complete"),
            file_name: "image-edit.png".to_string(),
            download_url,
            aspect_ratio: extract_result_aspect_ratio(&result),
            preview_url,
            editor_url,
            detail_text,
        });
    });
}

pub fn resolve_image_source(source: &str) -> Result<(String, Option<String>), String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Err("image source is empty".to_string());
    }

    if trimmed.starts_with("data:") {
        return Ok((trimmed.to_string(), None));
    }

    if trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("/api/")
    {
        let url = absolute_url(trimmed);
        return Ok((url.clone(), Some(build_iopaint_studio_url(&url))));
    }

    if !Path::new(trimmed).exists() {
        return Ok((trimmed.to_string(), None));
    }

    let uploaded = upload_files(&[trimmed.to_string()])?;
    let source_url = uploaded
        .first()
        .map(|file| {
            file.executor_url
                .clone()
                .unwrap_or_else(|| absolute_url(&file.url))
        })
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "upload response missing image url".to_string())?;
    let preview_url = absolute_url(&source_url);
    Ok((
        preview_url.clone(),
        Some(build_iopaint_studio_url(&preview_url)),
    ))
}

pub fn download_to_path(url: String, target: PathBuf, tx: mpsc::Sender<Command>) {
    std::thread::spawn(move || {
        let result = download_file(&url, &target);
        match result {
            Ok(()) => {
                let _ = tx.send(Command::DownloadFinished {
                    success: true,
                    message: target.to_string_lossy().to_string(),
                    saved_path: Some(target.to_string_lossy().to_string()),
                });
            }
            Err(err) => {
                let _ = tx.send(Command::DownloadFinished {
                    success: false,
                    message: err,
                    saved_path: None,
                });
            }
        }
    });
}

pub fn summarize_audio_capture(path: String, tx: mpsc::Sender<Command>) {
    summarize_capture(path, "audio.transcribe_summary", "Audio Notes", tx);
}

pub fn summarize_screen_capture(path: String, tx: mpsc::Sender<Command>) {
    summarize_capture(path, "video.analyze_summary", "Screen Record", tx);
}

fn summarize_capture(path: String, tool: &str, label: &str, tx: mpsc::Sender<Command>) {
    let tool_id = tool.to_string();
    let report_label = capture_summary_report_label(tool).to_string();
    let result_label = label.to_string();
    std::thread::spawn(move || {
        let trimmed_path = path.trim().to_string();
        if trimmed_path.is_empty() {
            let _ = tx.send(Command::FileProcessFailed {
                message: "Capture file is missing".to_string(),
            });
            return;
        }

        let _ = tx.send(Command::ToolProgress {
            name: tool_id.clone(),
            progress: 0.18,
            status: ToolStatus::Running,
        });

        let uploaded = match upload_files(&[trimmed_path.clone()]) {
            Ok(files) => files,
            Err(err) => {
                let _ = tx.send(Command::FileProcessFailed {
                    message: format!("Capture upload failed: {err}"),
                });
                return;
            }
        };
        let Some(uploaded_file) = uploaded.first() else {
            let _ = tx.send(Command::FileProcessFailed {
                message: "Capture upload response was empty".to_string(),
            });
            return;
        };
        let file_url = uploaded_file
            .executor_url
            .clone()
            .unwrap_or_else(|| absolute_url(&uploaded_file.url));
        let plan = ExecutionPlan {
            tool: tool_id.clone(),
            params: json!({ "file_url": file_url }),
            output_ext: None,
        };

        let result = match execute_plan(&plan) {
            Ok(value) => value,
            Err(err) => {
                let _ = tx.send(Command::FileProcessFailed {
                    message: format!("Capture analysis failed: {err}"),
                });
                return;
            }
        };
        let summary = extract_capture_summary_text(&result)
            .unwrap_or_else(|| format!("{result_label} finished, but the AI summary was empty."));
        let _ = tx.send(Command::AiUpdate {
            state: crate::core::types::AiState::Complete,
            snippet: Some(summary.clone()),
        });
        if let Some((report_path, report_name, report_detail)) =
            materialize_capture_summary_report(&trimmed_path, &result_label, &result)
        {
            let _ = tx.send(Command::FileProcessed {
                label: report_label,
                file_name: report_name,
                download_url: report_path,
                aspect_ratio: None,
                preview_url: None,
                editor_url: None,
                detail_text: Some(report_detail),
            });
        }
    });
}

fn capture_summary_report_label(tool: &str) -> &'static str {
    if tool == "audio.transcribe_summary" {
        "capture.audio_summary_report"
    } else {
        "capture.screen_summary_report"
    }
}

fn extract_capture_report_markdown(result: &Value) -> Option<String> {
    result
        .get("report_markdown")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn capture_summary_report_file_name(capture_path: &str) -> String {
    let stem = Path::new(capture_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("capture");
    format!("{}-summary.md", sanitize_output_name(stem))
}

fn capture_summary_report_detail(capture_label: &str) -> &'static str {
    if capture_label.eq_ignore_ascii_case("Audio Notes") {
        "Markdown notes report. Download to keep."
    } else {
        "Markdown screen report. Download to keep."
    }
}

fn build_capture_summary_report_markdown(
    capture_label: &str,
    capture_path: &str,
    result: &Value,
) -> String {
    let summary = extract_capture_summary_text(result)
        .unwrap_or_else(|| format!("{capture_label} summary was empty."));
    let transcript = result
        .get("transcript")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let analysis = result
        .get("analysis")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let provider = result
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let model = result
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let source_file = Path::new(capture_path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(capture_path);
    let mut lines = vec![
        format!("# {capture_label} Report"),
        String::new(),
        format!("- Source file: {source_file}"),
    ];
    if !provider.is_empty() {
        lines.push(format!("- Provider: {provider}"));
    }
    if !model.is_empty() {
        lines.push(format!("- Model: {model}"));
    }
    lines.push(String::new());
    lines.push("## Overview".to_string());
    lines.push(String::new());
    lines.push(summary);

    if !transcript.is_empty() {
        lines.push(String::new());
        lines.push("## Transcript".to_string());
        lines.push(String::new());
        lines.push(transcript.to_string());
    }
    if !analysis.is_empty() {
        lines.push(String::new());
        lines.push("## Analysis".to_string());
        lines.push(String::new());
        lines.push(analysis.to_string());
    }
    format!("{}\n", lines.join("\n"))
}

fn materialize_capture_summary_report(
    capture_path: &str,
    capture_label: &str,
    result: &Value,
) -> Option<(String, String, String)> {
    let markdown = extract_capture_report_markdown(result).unwrap_or_else(|| {
        build_capture_summary_report_markdown(capture_label, capture_path, result)
    });
    if markdown.trim().is_empty() {
        return None;
    }
    let file_name = capture_summary_report_file_name(capture_path);
    let temp_name = format!(
        "{}-artifact-{}.md",
        Path::new(&file_name)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("capture-summary"),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    );
    let path = std::env::temp_dir().join(temp_name);
    fs::write(&path, markdown).ok()?;
    Some((
        path.to_string_lossy().to_string(),
        file_name,
        capture_summary_report_detail(capture_label).to_string(),
    ))
}

fn upload_files(paths: &[String]) -> Result<Vec<UploadedFile>, String> {
    if paths.is_empty() {
        return Err("no files to upload".to_string());
    }
    let boundary = format!(
        "----omniagent-island-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_micros()
    );

    let mut body = Vec::<u8>::with_capacity(4096);
    push_text(
        &mut body,
        &format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"scope\"\r\n\r\nisland\r\n"
        ),
    );
    for path in paths {
        let bytes = fs::read(path).map_err(|e| format!("read file: {e}"))?;
        if bytes.is_empty() {
            return Err(format!("empty file: {}", file_name(path)));
        }
        let filename = file_name(path);
        push_text(
            &mut body,
            &format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"{}\"\r\nContent-Type: application/octet-stream\r\n\r\n",
                sanitize_filename_for_multipart(&filename)
            ),
        );
        body.extend_from_slice(&bytes);
        push_text(&mut body, "\r\n");
    }
    push_text(&mut body, &format!("--{boundary}--\r\n"));

    let agent = ureq::AgentBuilder::new()
        .try_proxy_from_env(false)
        .timeout_connect(Duration::from_secs(10))
        .timeout(Duration::from_secs(90))
        .build();

    let backend = crate::core::backend::load_backend_config();
    let files_endpoint = backend.endpoint("/api/v1/files");
    let response = backend
        .apply_auth_for_url(
            agent.post(&files_endpoint)
        .set(
            "Content-Type",
            &format!("multipart/form-data; boundary={boundary}"),
            ),
            &files_endpoint,
        )
        .send_bytes(&body)
        .map_err(format_ureq_error)?;

    let parsed = response
        .into_json::<UploadResponse>()
        .map_err(|e| format!("invalid upload response: {e}"))?;

    if parsed.files.is_empty() {
        return Err("upload response missing file".to_string());
    }

    Ok(parsed.files)
}

fn extract_capture_summary_text(result: &Value) -> Option<String> {
    let summary = result
        .get("summary")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim();
    if !summary.is_empty() {
        return Some(summary.to_string());
    }

    let analysis = result
        .get("analysis")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim();
    if !analysis.is_empty() {
        return Some(analysis.to_string());
    }

    let transcript = result
        .get("transcript")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim();
    if !transcript.is_empty() {
        return Some(transcript.to_string());
    }

    None
}

fn execute_plan(plan: &ExecutionPlan) -> Result<Value, String> {
    let timeout_secs = if plan.tool == "generate.image" {
        EXECUTE_TIMEOUT_IMAGE_SECS
    } else {
        EXECUTE_TIMEOUT_SECS
    };
    let max_attempts = if plan.tool == "generate.image" { 3 } else { 2 };
    let mut last_error = String::new();

    for attempt in 1..=max_attempts {
        match execute_plan_once(plan, timeout_secs) {
            Ok(value) => return Ok(value),
            Err(err) => {
                let retryable = should_retry_execute_error(&err);
                last_error = err;
                if attempt < max_attempts && retryable {
                    std::thread::sleep(Duration::from_millis(800 * attempt as u64));
                    continue;
                }
                return Err(last_error);
            }
        }
    }

    Err(last_error)
}

fn execute_plan_once(plan: &ExecutionPlan, timeout_secs: u64) -> Result<Value, String> {
    let payload = json!({
        "tool": plan.tool,
        "params": plan.params,
    });

    let agent = ureq::AgentBuilder::new()
        .try_proxy_from_env(false)
        .timeout_connect(Duration::from_secs(10))
        .timeout(Duration::from_secs(timeout_secs))
        .build();

    let backend = crate::core::backend::load_backend_config();
    let execute_endpoint = backend.endpoint("/api/v1/execute");
    let response = backend
        .apply_auth_for_url(
            agent.post(&execute_endpoint)
        .set("Content-Type", "application/json")
            ,
            &execute_endpoint,
        )
        .send_string(&payload.to_string())
        .map_err(format_ureq_error)?;

    let parsed = response
        .into_json::<ExecuteResponse>()
        .map_err(|e| format!("invalid execute response: {e}"))?;

    if parsed.status != "success" {
        let msg = parsed
            .error
            .and_then(|e| e.message)
            .unwrap_or_else(|| "unknown execute error".to_string());
        return Err(msg);
    }

    parsed
        .result
        .ok_or_else(|| "execute result missing".to_string())
}

fn should_retry_execute_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("backend unavailable on 3010")
        || lower.contains("network")
        || lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("failed to connect")
        || lower.contains("connection refused")
        || lower.contains("dns")
        || lower.contains("10060")
        || lower.starts_with("502:")
        || lower.starts_with("503:")
        || lower.starts_with("504:")
}

fn choose_plan(
    paths: &[String],
    ext: &str,
    instruction: &str,
    file_urls: &[String],
) -> Result<Option<ExecutionPlan>, String> {
    if paths.is_empty() || file_urls.is_empty() {
        return Ok(None);
    }

    if paths.len() > 1 {
        return choose_multi_file_plan(paths, instruction, file_urls);
    }

    choose_single_file_plan(&paths[0], ext, instruction, &file_urls[0])
}

fn choose_multi_file_plan(
    paths: &[String],
    instruction: &str,
    file_urls: &[String],
) -> Result<Option<ExecutionPlan>, String> {
    if paths.len() != file_urls.len() {
        return Err("Uploaded file count does not match dropped files.".to_string());
    }
    if is_generic_file_compress_instruction(instruction) {
        let filenames = paths
            .iter()
            .map(|path| file_name(path))
            .collect::<Vec<String>>();
        return Ok(Some(ExecutionPlan {
            tool: "file.compress".to_string(),
            params: json!({ "file_urls": file_urls, "filenames": filenames }),
            output_ext: Some("zip".to_string()),
        }));
    }

    if paths.iter().all(|path| is_image_ext(&file_ext(path))) {
        if is_batch_watermark_instruction(instruction) {
            return Ok(Some(ExecutionPlan {
                tool: "image.remove_watermark_batch".to_string(),
                params: json!({ "file_urls": file_urls }),
                output_ext: Some("zip".to_string()),
            }));
        }
        return Err(
            "For multiple images, use a batch watermark instruction like 'batch remove watermark'."
                .to_string(),
        );
    }
    if !paths.iter().all(|path| file_ext(path) == "pdf") {
        return Err("Multi-file mode currently supports PDF merge only.".to_string());
    }

    let text = instruction.to_ascii_lowercase();
    let merge_like = instruction.trim().is_empty()
        || contains_any(&text, &["merge", "combine", "join"])
        || contains_any(
            instruction,
            &["\u{5408}\u{5e76}", "\u{62fc}\u{63a5}", "\u{7ec4}\u{5408}"],
        );

    if !merge_like {
        return Err("For multiple PDFs, use a merge instruction or leave it empty.".to_string());
    }

    Ok(Some(ExecutionPlan {
        tool: "pdf.merge".to_string(),
        params: json!({ "file_urls": file_urls.join(",") }),
        output_ext: Some("pdf".to_string()),
    }))
}

fn choose_single_file_plan(
    path: &str,
    ext: &str,
    instruction: &str,
    file_url: &str,
) -> Result<Option<ExecutionPlan>, String> {
    let text = instruction.to_ascii_lowercase();

    if is_image_ext(ext) {
        if is_watermark_instruction(instruction) {
            return Ok(Some(ExecutionPlan {
                tool: "image.remove_watermark".to_string(),
                params: json!({
                    "file_url": file_url,
                    "placement": detect_watermark_placement(instruction),
                }),
                output_ext: Some("png".to_string()),
            }));
        }
        if is_remove_background_instruction(instruction) {
            return Ok(Some(ExecutionPlan {
                tool: "image.remove_background".to_string(),
                params: json!({ "file_url": file_url }),
                output_ext: Some("png".to_string()),
            }));
        }
        if is_face_restore_instruction(instruction) {
            return Ok(Some(ExecutionPlan {
                tool: "image.face_restore".to_string(),
                params: json!({
                    "file_url": file_url,
                    "engine": detect_face_restore_engine(instruction),
                }),
                output_ext: Some("png".to_string()),
            }));
        }
        if is_upscale_instruction(instruction) {
            return Ok(Some(ExecutionPlan {
                tool: "image.upscale".to_string(),
                params: json!({
                    "file_url": file_url,
                    "scale": parse_image_scale(instruction),
                }),
                output_ext: Some("png".to_string()),
            }));
        }
        if is_outpaint_instruction(instruction) {
            let (top, right, bottom, left) = parse_outpaint_expansion(instruction);
            return Ok(Some(ExecutionPlan {
                tool: "image.outpaint".to_string(),
                params: json!({
                    "file_url": file_url,
                    "top": top,
                    "right": right,
                    "bottom": bottom,
                    "left": left,
                }),
                output_ext: Some("png".to_string()),
            }));
        }
        if let Some(format) = detect_target_format(&text, &["png", "jpg", "jpeg", "webp", "avif"]) {
            return Ok(Some(ExecutionPlan {
                tool: "image.convert".to_string(),
                params: json!({ "file_url": file_url, "format": normalize_image_format(&format) }),
                output_ext: Some(normalize_image_format(&format).to_string()),
            }));
        }
        if is_image_compress_instruction(instruction) {
            let quality = parse_quality(&text, 80);
            return Ok(Some(ExecutionPlan {
                tool: "image.compress".to_string(),
                params: json!({ "file_url": file_url, "quality": quality }),
                output_ext: Some("webp".to_string()),
            }));
        }
        let image_prompt = extract_image_generation_prompt(instruction)
            .or_else(|| default_image_generation_prompt(instruction));

        if let Some(prompt) = image_prompt {
            let reference = image_reference_for_plan(path, ext, file_url);
            let aspect_ratio = extract_aspect_ratio_from_prompt(&prompt)
                .or_else(|| extract_aspect_ratio_from_prompt(instruction));
            let mut params = json!({
                "prompt": prompt,
                "reference_image_url": reference,
                "mode": "image_to_image"
            });
            if let Some(ratio) = aspect_ratio {
                params["aspect_ratio"] = Value::String(ratio);
            }
            return Ok(Some(ExecutionPlan {
                tool: "generate.image".to_string(),
                params,
                output_ext: Some("png".to_string()),
            }));
        }
        let quality = parse_quality(&text, 80);
        return Ok(Some(ExecutionPlan {
            tool: "image.compress".to_string(),
            params: json!({ "file_url": file_url, "quality": quality }),
            output_ext: Some("webp".to_string()),
        }));
    }

    if ext == "pdf" {
        if contains_any(&text, &["page count", "how many pages", "count pages"])
            || contains_any(
                instruction,
                &[
                    "\u{9875}\u{6570}",
                    "\u{591a}\u{5c11}\u{9875}",
                    "\u{7edf}\u{8ba1}\u{9875}\u{6570}",
                ],
            )
        {
            return Ok(Some(ExecutionPlan {
                tool: "pdf.page_count".to_string(),
                params: json!({ "file_url": file_url }),
                output_ext: Some("json".to_string()),
            }));
        }
        if contains_any(&text, &["split", "extract pages", "page range"])
            || contains_any(
                instruction,
                &[
                    "\u{62c6}\u{5206}",
                    "\u{63d0}\u{53d6}\u{9875}",
                    "\u{9875}\u{7801}\u{8303}\u{56f4}",
                ],
            )
        {
            let ranges = parse_pdf_ranges(instruction)
                .ok_or_else(|| "PDF split needs a page range like 1-3.".to_string())?;
            return Ok(Some(ExecutionPlan {
                tool: "pdf.split".to_string(),
                params: json!({ "file_url": file_url, "ranges": ranges }),
                output_ext: Some("pdf".to_string()),
            }));
        }
        if contains_any(&text, &["image", "png", "jpg", "jpeg", "picture", "photo"]) {
            return Ok(Some(ExecutionPlan {
                tool: "pdf.to_image".to_string(),
                params: json!({ "file_url": file_url, "page": 1, "dpi": 150 }),
                output_ext: Some("png".to_string()),
            }));
        }
        let quality = parse_quality(&text, 75);
        return Ok(Some(ExecutionPlan {
            tool: "pdf.compress".to_string(),
            params: json!({ "file_url": file_url, "quality": quality }),
            output_ext: Some("pdf".to_string()),
        }));
    }

    if matches!(ext, "docx" | "doc") {
        if is_generic_file_compress_instruction(instruction) {
            return Ok(Some(ExecutionPlan {
                tool: "file.compress".to_string(),
                params: json!({ "file_url": file_url, "filenames": [file_name(path)] }),
                output_ext: Some("zip".to_string()),
            }));
        }
        if ext == "doc" {
            return Err("Word extraction currently supports DOCX files.".to_string());
        }
        return Ok(Some(ExecutionPlan {
            tool: "word.extract_text".to_string(),
            params: json!({ "file_url": file_url }),
            output_ext: Some("txt".to_string()),
        }));
    }

    if matches!(
        ext,
        "txt" | "json" | "yaml" | "yml" | "csv" | "md" | "markdown"
    ) {
        if is_generic_file_compress_instruction(instruction) {
            return Ok(Some(ExecutionPlan {
                tool: "file.compress".to_string(),
                params: json!({ "file_url": file_url, "filenames": [file_name(path)] }),
                output_ext: Some("zip".to_string()),
            }));
        }
        return choose_text_document_plan(path, ext, instruction);
    }

    if is_video_ext(ext) {
        if contains_any(&text, &["gif"]) {
            return Ok(Some(ExecutionPlan {
                tool: "video.to_gif".to_string(),
                params: json!({ "file_url": file_url, "fps": 10, "width": 480 }),
                output_ext: Some("gif".to_string()),
            }));
        }
        if contains_any(&text, &["trim", "clip", "cut"])
            || contains_any(
                instruction,
                &["\u{526a}\u{8f91}", "\u{88c1}\u{526a}", "\u{622a}\u{53d6}"],
            )
        {
            let (start, end) = parse_video_time_range(instruction)
                .ok_or_else(|| "Video trim needs start and end timestamps.".to_string())?;
            return Ok(Some(ExecutionPlan {
                tool: "video.trim".to_string(),
                params: json!({ "file_url": file_url, "start": start, "end": end }),
                output_ext: Some(ext.to_string()),
            }));
        }
        if contains_any(&text, &["compress", "smaller", "crf"])
            || contains_any(instruction, &["\u{538b}\u{7f29}", "\u{538b}\u{5c0f}"])
        {
            return Ok(Some(ExecutionPlan {
                tool: "video.compress".to_string(),
                params: json!({ "file_url": file_url, "crf": parse_video_crf(&text) }),
                output_ext: Some("mp4".to_string()),
            }));
        }
        if contains_any(&text, &["audio", "mp3", "wav", "aac", "extract"]) {
            let format = detect_target_format(&text, &["mp3", "wav", "aac"])
                .unwrap_or_else(|| "mp3".to_string());
            return Ok(Some(ExecutionPlan {
                tool: "video.extract_audio".to_string(),
                params: json!({ "file_url": file_url, "format": format }),
                output_ext: Some(format),
            }));
        }
        let format = detect_target_format(&text, &["mp4", "webm", "avi"])
            .unwrap_or_else(|| "mp4".to_string());
        return Ok(Some(ExecutionPlan {
            tool: "video.convert".to_string(),
            params: json!({ "file_url": file_url, "format": format }),
            output_ext: Some(format),
        }));
    }

    if is_audio_ext(ext) {
        if contains_any(
            &text,
            &[
                "transcribe",
                "transcript",
                "speech to text",
                "text file",
                "to text",
            ],
        ) || contains_any(
            instruction,
            &[
                "\u{8f6c}\u{6587}\u{672c}",
                "\u{8f6c}\u{6210}\u{6587}\u{672c}",
                "\u{6587}\u{672c}\u{6587}\u{4ef6}",
                "\u{8f6c}\u{5199}",
                "\u{8f6c}\u{5f55}",
            ],
        ) {
            return Ok(Some(ExecutionPlan {
                tool: "audio.transcribe_text".to_string(),
                params: json!({ "file_url": file_url }),
                output_ext: Some("txt".to_string()),
            }));
        }
        let target = detect_target_format(&text, &["mp3", "wav", "flac", "aac"]);
        if let Some(format) = target {
            return Ok(Some(ExecutionPlan {
                tool: "audio.convert".to_string(),
                params: json!({ "file_url": file_url, "format": format }),
                output_ext: Some(format),
            }));
        }
        if contains_any(&text, &["normalize", "volume", "loud", "lufs"]) {
            return Ok(Some(ExecutionPlan {
                tool: "audio.normalize".to_string(),
                params: json!({ "file_url": file_url, "target_lufs": -14 }),
                output_ext: Some("mp3".to_string()),
            }));
        }
        return Ok(Some(ExecutionPlan {
            tool: "audio.convert".to_string(),
            params: json!({ "file_url": file_url, "format": "mp3" }),
            output_ext: Some("mp3".to_string()),
        }));
    }

    if is_generic_file_compress_instruction(instruction) {
        return Ok(Some(ExecutionPlan {
            tool: "file.compress".to_string(),
            params: json!({ "file_url": file_url, "filenames": [file_name(path)] }),
            output_ext: Some("zip".to_string()),
        }));
    }

    Ok(None)
}

fn choose_text_document_plan(
    path: &str,
    ext: &str,
    instruction: &str,
) -> Result<Option<ExecutionPlan>, String> {
    let text = instruction.to_ascii_lowercase();
    let input = read_text_input(path)?;

    let plan = match ext {
        "txt" => {
            if text.trim().is_empty() {
                None
            } else {
                Some((
                    "text.process",
                    json!({ "input": input, "instruction": instruction }),
                    "txt",
                ))
            }
        }
        "json" => {
            if contains_any(&text, &["yaml", "yml"]) {
                Some(("convert.json_yaml", json!({ "input": input }), "yaml"))
            } else if contains_any(&text, &["csv"]) {
                Some(("convert.json_csv", json!({ "input": input }), "csv"))
            } else {
                let mode = if contains_any(&text, &["minify", "compress"]) {
                    "minify"
                } else {
                    "pretty"
                };
                Some((
                    "convert.json_format",
                    json!({ "input": input, "mode": mode }),
                    "json",
                ))
            }
        }
        "yaml" | "yml" => Some(("convert.yaml_json", json!({ "input": input }), "json")),
        "csv" => Some(("convert.csv_json", json!({ "input": input }), "json")),
        "md" | "markdown" => Some(("convert.md_html", json!({ "input": input }), "html")),
        _ => None,
    };

    Ok(plan.map(|(tool, params, output_ext)| ExecutionPlan {
        tool: tool.to_string(),
        params,
        output_ext: Some(output_ext.to_string()),
    }))
}

fn extract_download_url(result: &Value) -> Option<String> {
    if let Some(obj) = result.as_object() {
        for key in [
            "output_file_url",
            "output_url",
            "download_url",
            "file_url",
            "url",
        ] {
            if let Some(url) = obj.get(key).and_then(Value::as_str) {
                return Some(url.to_string());
            }
        }
    }
    find_url_recursive(result)
}

fn find_url_recursive(value: &Value) -> Option<String> {
    if let Some(s) = value.as_str() {
        if s.starts_with("http://") || s.starts_with("https://") || s.starts_with("/api/") {
            return Some(s.to_string());
        }
    }
    if let Some(arr) = value.as_array() {
        for item in arr {
            if let Some(v) = find_url_recursive(item) {
                return Some(v);
            }
        }
    }
    if let Some(obj) = value.as_object() {
        for v in obj.values() {
            if let Some(found) = find_url_recursive(v) {
                return Some(found);
            }
        }
    }
    None
}

fn extract_result_aspect_ratio(result: &Value) -> Option<String> {
    find_aspect_ratio_recursive(result)
}

fn materialize_result_artifact(
    result: &Value,
    final_name: &str,
    output_ext: Option<&str>,
) -> Option<String> {
    let artifact_text = extract_result_text(result).or_else(|| {
        result
            .get("output")
            .or_else(|| result.get("result"))
            .or_else(|| Some(result))
            .and_then(|value| serde_json::to_string_pretty(value).ok())
    })?;

    let ext = output_ext
        .filter(|ext| !ext.trim().is_empty())
        .unwrap_or("txt");
    let stem = Path::new(final_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("omniagent-result");
    let temp_name = format!(
        "{}-artifact-{}.{}",
        sanitize_output_name(stem),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        ext
    );
    let path = std::env::temp_dir().join(temp_name);
    fs::write(&path, artifact_text).ok()?;
    Some(path.to_string_lossy().to_string())
}

fn extract_result_text(result: &Value) -> Option<String> {
    if let Some(text) = result.as_str() {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    if let Some(obj) = result.as_object() {
        for key in ["text", "message", "content"] {
            if let Some(text) = obj.get(key).and_then(Value::as_str) {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
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
            if let Some(value) = obj.get(nested_key) {
                if let Some(text) = extract_result_text(value) {
                    return Some(text);
                }
            }
        }
    }

    None
}

fn extract_preview_url(result: &Value) -> Option<String> {
    extract_string_field(
        result,
        &[
            "preview_url",
            "thumbnail",
            "thumbnail_url",
            "cover",
            "cover_url",
        ],
    )
}

fn extract_editor_url(result: &Value) -> Option<String> {
    extract_string_field(result, &["editor_url", "studio_url"])
}

fn extract_detail_text(result: &Value) -> Option<String> {
    if let Some(detail) = extract_string_field(result, &["detail_text"]) {
        return Some(detail);
    }

    let strategy = extract_string_field(result, &["strategy"]);
    let count = result
        .get("processed_count")
        .and_then(Value::as_u64)
        .map(|value| format!("{value} done"));
    let failed = result
        .get("failed_count")
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .map(|value| format!("{value} failed"));

    let mut parts = Vec::new();
    if let Some(value) = strategy {
        parts.push(value);
    }
    if let Some(value) = count {
        parts.push(value);
    }
    if let Some(value) = failed {
        parts.push(value);
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" | "))
    }
}

fn extract_string_field(value: &Value, keys: &[&str]) -> Option<String> {
    if let Some(text) = value.as_str() {
        let trimmed = text.trim();
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
    }

    None
}

fn download_file(url: &str, target: &Path) -> Result<(), String> {
    if is_local_artifact_path(url) {
        fs::copy(url, target).map_err(|e| format!("copy file: {e}"))?;
        return Ok(());
    }

    let full_url = absolute_url(url);
    let agent = ureq::AgentBuilder::new()
        .try_proxy_from_env(false)
        .timeout_connect(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .build();
    let backend = crate::core::backend::load_backend_config();
    let response = backend
        .apply_auth_for_url(agent.get(&full_url), &full_url)
        .call()
        .map_err(format_ureq_error)?;
    let mut reader = response.into_reader();
    let mut bytes = Vec::new();
    reader
        .read_to_end(&mut bytes)
        .map_err(|e| format!("read response: {e}"))?;
    fs::write(target, bytes).map_err(|e| format!("write file: {e}"))?;
    Ok(())
}

fn is_local_artifact_path(url: &str) -> bool {
    if url.starts_with("http://") || url.starts_with("https://") || url.starts_with("/api/") {
        return false;
    }
    Path::new(url).exists()
}

fn parse_quality(text: &str, default: u32) -> u32 {
    for token in text.split(|c: char| !c.is_ascii_digit()) {
        if token.is_empty() {
            continue;
        }
        if let Ok(value) = token.parse::<u32>() {
            if (1..=100).contains(&value) {
                return value;
            }
        }
    }
    default
}

fn parse_image_scale(instruction: &str) -> u32 {
    let lower = instruction.to_ascii_lowercase();
    if lower.contains("4k") || contains_any(instruction, &["4K", "\u{8d85}\u{6e05}"]) {
        return 4;
    }
    if contains_any(
        instruction,
        &[
            "\u{9ad8}\u{6e05}",
            "\u{6e05}\u{6670}",
            "\u{63d0}\u{5347}\u{753b}\u{8d28}",
            "\u{653e}\u{5927}",
            "\u{8d85}\u{5206}\u{8fa8}",
        ],
    ) || contains_any(&lower, &["upscale", "enhance", "super resolution", "hd"])
    {
        return 2;
    }
    for token in lower.split(|c: char| !c.is_ascii_digit()) {
        if let Ok(value) = token.parse::<u32>() {
            if (2..=4).contains(&value) {
                return value;
            }
        }
    }
    2
}

fn is_watermark_instruction(instruction: &str) -> bool {
    let lower = instruction.to_ascii_lowercase();
    contains_any(&lower, &["watermark", "remove watermark"])
        || contains_any(
            instruction,
            &[
                "\u{53bb}\u{6c34}\u{5370}",
                "\u{53bb}\u{9664}\u{6c34}\u{5370}",
                "\u{5220}\u{6c34}\u{5370}",
                "\u{6c34}\u{5370}",
            ],
        )
}

fn is_remove_background_instruction(instruction: &str) -> bool {
    let lower = instruction.to_ascii_lowercase();
    contains_any(
        &lower,
        &[
            "remove background",
            "cut out",
            "cutout",
            "transparent background",
            "remove bg",
        ],
    ) || contains_any(
        instruction,
        &[
            "\u{53bb}\u{80cc}\u{666f}",
            "\u{62a0}\u{56fe}",
            "\u{6263}\u{56fe}",
            "\u{6263}\u{80cc}\u{666f}",
            "\u{6263}\u{9664}\u{80cc}\u{666f}",
            "\u{900f}\u{660e}\u{80cc}\u{666f}",
            "\u{79fb}\u{9664}\u{80cc}\u{666f}",
        ],
    )
}

fn is_face_restore_instruction(instruction: &str) -> bool {
    let lower = instruction.to_ascii_lowercase();
    contains_any(
        &lower,
        &[
            "face restore",
            "restore face",
            "portrait restore",
            "fix face",
            "gfpgan",
            "restoreformer",
        ],
    ) || contains_any(
        instruction,
        &[
            "\u{4fee}\u{590d}\u{4eba}\u{50cf}",
            "\u{4fee}\u{8138}",
            "\u{4eba}\u{8138}\u{4fee}\u{590d}",
            "\u{8096}\u{50cf}\u{4fee}\u{590d}",
        ],
    )
}

fn detect_face_restore_engine(instruction: &str) -> &'static str {
    let lower = instruction.to_ascii_lowercase();
    if lower.contains("restoreformer") {
        "RestoreFormer"
    } else {
        "GFPGAN"
    }
}

fn is_batch_watermark_instruction(instruction: &str) -> bool {
    let lower = instruction.to_ascii_lowercase();
    (is_watermark_instruction(instruction)
        && contains_any(
            instruction,
            &["\u{6279}\u{91cf}", "\u{591a}\u{5f20}", "\u{4e00}\u{6279}"],
        ))
        || contains_any(&lower, &["batch", "bulk"])
}

fn is_outpaint_instruction(instruction: &str) -> bool {
    let lower = instruction.to_ascii_lowercase();
    contains_any(
        &lower,
        &[
            "outpaint",
            "expand canvas",
            "extend image",
            "uncrop",
            "expand image",
        ],
    ) || contains_any(
        instruction,
        &[
            "\u{6269}\u{56fe}",
            "\u{6269}\u{5c55}\u{753b}\u{5e03}",
            "\u{6269}\u{5c55}\u{56fe}\u{7247}",
            "\u{8865}\u{5168}\u{8fb9}\u{7f18}",
            "\u{5ef6}\u{5c55}\u{753b}\u{9762}",
        ],
    )
}

fn parse_outpaint_expansion(instruction: &str) -> (u32, u32, u32, u32) {
    let lower = instruction.to_ascii_lowercase();
    let mut top = 0_u32;
    let mut right = 160_u32;
    let mut bottom = 0_u32;
    let mut left = 160_u32;

    for token in lower.split(|ch: char| ch.is_whitespace() || ch == ',' || ch == ';') {
        let (key, value) = if let Some(rest) = token.strip_prefix("top") {
            ("top", rest)
        } else if let Some(rest) = token.strip_prefix("right") {
            ("right", rest)
        } else if let Some(rest) = token.strip_prefix("bottom") {
            ("bottom", rest)
        } else if let Some(rest) = token.strip_prefix("left") {
            ("left", rest)
        } else {
            continue;
        };

        let digits = value.trim_matches(|ch: char| !ch.is_ascii_digit());
        let Ok(parsed) = digits.parse::<u32>() else {
            continue;
        };
        let parsed = parsed.min(2048);
        match key {
            "top" => top = parsed,
            "right" => right = parsed,
            "bottom" => bottom = parsed,
            "left" => left = parsed,
            _ => {}
        }
    }

    if contains_any(
        instruction,
        &["\u{5de6}\u{53f3}", "\u{4e24}\u{4fa7}", "\u{6a2a}\u{5411}"],
    ) {
        right = right.max(160);
        left = left.max(160);
    }

    (top, right, bottom, left)
}

fn detect_watermark_placement(instruction: &str) -> &'static str {
    let lower = instruction.to_ascii_lowercase();
    if lower.contains("top-left") || contains_any(instruction, &["\u{5de6}\u{4e0a}"]) {
        "top-left"
    } else if lower.contains("top-right") || contains_any(instruction, &["\u{53f3}\u{4e0a}"]) {
        "top-right"
    } else if lower.contains("bottom-left") || contains_any(instruction, &["\u{5de6}\u{4e0b}"]) {
        "bottom-left"
    } else if lower.contains("bottom-right") || contains_any(instruction, &["\u{53f3}\u{4e0b}"]) {
        "bottom-right"
    } else {
        "auto"
    }
}

fn is_upscale_instruction(instruction: &str) -> bool {
    let lower = instruction.to_ascii_lowercase();
    contains_any(
        &lower,
        &["upscale", "enhance", "super resolution", "4k", "hd"],
    ) || contains_any(
        instruction,
        &[
            "\u{9ad8}\u{6e05}",
            "\u{8d85}\u{6e05}",
            "\u{6e05}\u{6670}",
            "\u{63d0}\u{5347}\u{753b}\u{8d28}",
            "\u{653e}\u{5927}",
            "\u{8d85}\u{5206}\u{8fa8}",
        ],
    )
}

fn is_image_compress_instruction(instruction: &str) -> bool {
    let lower = instruction.to_ascii_lowercase();
    contains_any(&lower, &["compress", "optimize", "smaller", "quality"])
        || contains_any(
            instruction,
            &[
                "\u{538b}\u{7f29}",
                "\u{538b}\u{5c0f}",
                "\u{538b}\u{4e00}\u{4e0b}",
                "\u{51cf}\u{5c0f}",
            ],
        )
}

fn is_iopaint_editor_instruction(instruction: &str) -> bool {
    let lower = instruction.to_ascii_lowercase();
    contains_any(
        &lower,
        &[
            "iopaint",
            "open studio",
            "advanced edit",
            "mask edit",
            "open editor",
            "retouch manually",
            "watermark studio",
            "manual watermark",
            "remove bg studio",
            "background studio",
            "upscale studio",
            "outpaint studio",
        ],
    ) || contains_any(
        instruction,
        &[
            "\u{6253}\u{5f00}\u{7f16}\u{8f91}\u{5668}",
            "\u{8fdb}\u{5165}\u{7f16}\u{8f91}\u{5668}",
            "\u{9ad8}\u{7ea7}\u{4fee}\u{56fe}",
            "\u{624b}\u{52a8}\u{6d82}\u{62b9}",
            "\u{906e}\u{7f69}\u{7f16}\u{8f91}",
            "\u{53bb}\u{6c34}\u{5370}\u{7cbe}\u{4fee}",
            "\u{53bb}\u{6c34}\u{5370}\u{7f16}\u{8f91}",
            "\u{6290}\u{56fe}\u{7cbe}\u{4fee}",
            "\u{9ad8}\u{6e05}\u{7cbe}\u{4fee}",
            "\u{8865}\u{8fb9}\u{7cbe}\u{4fee}",
        ],
    )
}

fn detect_iopaint_studio_options(
    instruction: &str,
) -> (&'static str, Option<&'static str>, bool, &'static str) {
    if is_watermark_instruction(instruction) {
        return (
            "watermark",
            Some(detect_watermark_placement(instruction)),
            true,
            "Watermark preset ready. Studio will prepare the cleanup mask first.",
        );
    }
    if is_remove_background_instruction(instruction) {
        return (
            "remove-background",
            None,
            false,
            "Remove background preset ready. Switch models or refine the cutout in Studio.",
        );
    }
    if is_face_restore_instruction(instruction) {
        return (
            "face-restore",
            None,
            false,
            "Portrait restore preset ready. Tune GFPGAN or RestoreFormer in Studio.",
        );
    }
    if is_upscale_instruction(instruction) {
        return (
            "upscale",
            None,
            false,
            "Upscale preset ready. Choose the RealESRGAN model and scale in Studio.",
        );
    }
    if is_outpaint_instruction(instruction) {
        return (
            "outpaint",
            None,
            false,
            "Outpaint preset ready. Expand the canvas and refine the fill in Studio.",
        );
    }
    (
        "manual",
        None,
        false,
        "Open the full editor to mask, segment, remove objects, or outpaint.",
    )
}

fn is_generic_file_compress_instruction(instruction: &str) -> bool {
    let lower = instruction.to_ascii_lowercase();
    (contains_any(&lower, &["zip", "archive", "bundle"])
        || contains_any(
            instruction,
            &[
                "\u{6253}\u{5305}",
                "\u{5f52}\u{6863}",
                "\u{538b}\u{7f29}\u{6587}\u{4ef6}",
                "\u{6253}\u{5305}\u{6587}\u{4ef6}",
                "\u{6253}\u{4e00}\u{4e2a}\u{5305}",
            ],
        ))
        || (contains_any(&lower, &["compress"])
            && contains_any(&lower, &["file", "files", "folder", "archive"]))
}

fn detect_target_format(text: &str, formats: &[&str]) -> Option<String> {
    formats
        .iter()
        .find(|fmt| text.contains(**fmt))
        .map(|fmt| (*fmt).to_string())
}

fn read_text_input(path: &str) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("read text file: {e}"))?;
    if bytes.is_empty() {
        return Err("input file is empty".to_string());
    }
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

fn parse_pdf_ranges(instruction: &str) -> Option<String> {
    let normalized = instruction
        .replace('\u{ff0d}', "-")
        .replace('\u{2013}', "-")
        .replace('\u{2014}', "-")
        .replace('\u{81f3}', "-")
        .replace('\u{5230}', "-");

    for token in normalized.split(|ch: char| ch.is_whitespace() || ch == ',' || ch == ';') {
        let candidate = token
            .trim()
            .trim_matches(|ch: char| !ch.is_ascii_digit() && ch != '-');
        if candidate.is_empty() {
            continue;
        }
        if let Some((start, end)) = candidate.split_once('-') {
            if start.trim().parse::<u32>().ok().is_some()
                && end.trim().parse::<u32>().ok().is_some()
            {
                return Some(format!("{}-{}", start.trim(), end.trim()));
            }
        }
    }
    None
}

fn parse_video_time_range(instruction: &str) -> Option<(String, String)> {
    let mut markers = Vec::new();
    for raw in instruction.split_whitespace() {
        let token = raw.trim_matches(|ch: char| !ch.is_ascii_digit() && ch != ':');
        if token.is_empty() {
            continue;
        }
        let colon_count = token.matches(':').count();
        let valid = token.chars().all(|ch| ch.is_ascii_digit() || ch == ':')
            && ((colon_count == 0 && token.parse::<u32>().ok().is_some())
                || colon_count == 2
                || colon_count == 1);
        if valid {
            markers.push(token.to_string());
        }
        if markers.len() >= 2 {
            break;
        }
    }

    if markers.len() >= 2 {
        Some((markers[0].clone(), markers[1].clone()))
    } else {
        None
    }
}

fn parse_video_crf(text: &str) -> u32 {
    for token in text.split(|ch: char| !ch.is_ascii_digit()) {
        if token.is_empty() {
            continue;
        }
        if let Ok(value) = token.parse::<u32>() {
            if value <= 51 {
                return value;
            }
        }
    }
    28
}

fn split_text_tool_prompt(text: &str) -> (String, String, String) {
    let lines = text
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect::<Vec<&str>>();

    let exact_text = lines.first().copied().unwrap_or("MOSS").to_string();
    let style = lines
        .get(1)
        .copied()
        .unwrap_or("bold white sans-serif poster lettering")
        .to_string();
    let extra = if lines.len() > 2 {
        lines[2..].join(" ")
    } else {
        String::new()
    };

    (exact_text, style, extra)
}

fn extract_image_generation_prompt(instruction: &str) -> Option<String> {
    let trimmed = instruction.trim();
    if trimmed.is_empty() {
        return None;
    }

    let lower = trimmed.to_ascii_lowercase();
    let english_blockers = [
        "compress", "convert", "crop", "resize", "rotate", "metadata", "format",
    ];
    let chinese_blockers = [
        "\u{538b}\u{7f29}",
        "\u{8f6c}\u{6362}",
        "\u{88c1}\u{526a}",
        "\u{7f29}\u{653e}",
        "\u{65cb}\u{8f6c}",
        "\u{683c}\u{5f0f}",
        "\u{538b}\u{5c0f}",
    ];
    if contains_any(&lower, &english_blockers) || contains_any(trimmed, &chinese_blockers) {
        return None;
    }

    let english_triggers = [
        "img2img",
        "image to image",
        "generate image",
        "draw",
        "redraw",
        "stylize",
        "style",
        "variation",
    ];
    let chinese_triggers = [
        "\u{56fe}\u{751f}\u{56fe}",
        "\u{4ee5}\u{56fe}\u{751f}\u{56fe}",
        "\u{751f}\u{56fe}",
        "\u{753b}\u{4e00}\u{5f20}",
        "\u{753b}\u{4e2a}",
        "\u{98ce}\u{683c}\u{5316}",
        "\u{53c2}\u{8003}\u{8fd9}\u{5f20}\u{56fe}",
        "\u{6309}\u{8fd9}\u{5f20}\u{56fe}",
        "\u{57fa}\u{4e8e}\u{8fd9}\u{5f20}\u{56fe}",
        "\u{628a}\u{8fd9}\u{5f20}\u{56fe}",
        "\u{751f}\u{6210}\u{56fe}\u{7247}",
        "\u{751f}\u{6210}\u{65b0}\u{56fe}\u{7247}",
        "\u{751f}\u{6210}\u{65b0}\u{56fe}",
        "\u{6539}\u{6210}",
        "\u{53d8}\u{6210}",
        "\u{6362}\u{6210}",
        "\u{6362}\u{4e2a}\u{98ce}\u{683c}",
        "\u{91cd}\u{7ed8}",
        "\u{91cd}\u{753b}",
        "\u{4e8c}\u{521b}",
        "\u{91cd}\u{65b0}\u{751f}\u{6210}",
    ];
    let english_image_targets = ["image", "picture", "photo", "avatar", "poster", "logo"];
    let chinese_image_targets = [
        "\u{56fe}",
        "\u{56fe}\u{7247}",
        "\u{56fe}\u{50cf}",
        "\u{5934}\u{50cf}",
        "\u{6d77}\u{62a5}",
        "\u{5c01}\u{9762}",
    ];
    let chinese_style_words = [
        "\u{98ce}\u{683c}",
        "\u{6539}\u{6210}",
        "\u{53d8}\u{6210}",
        "\u{6362}\u{6210}",
        "\u{91cd}\u{7ed8}",
        "\u{91cd}\u{753b}",
        "\u{4e8c}\u{521b}",
        "\u{91cd}\u{65b0}\u{751f}\u{6210}",
    ];

    let has_direct_trigger =
        contains_any(&lower, &english_triggers) || contains_any(trimmed, &chinese_triggers);
    let has_style_image_phrase = (contains_any(trimmed, &chinese_style_words)
        && contains_any(trimmed, &chinese_image_targets))
        || (contains_any(&lower, &english_triggers)
            && contains_any(&lower, &english_image_targets));
    if !has_direct_trigger && !has_style_image_phrase {
        return None;
    }

    let mut prompt = trimmed.to_string();
    let trim_prefixes = [
        "img2img",
        "image to image",
        "generate image",
        "draw",
        "redraw",
        "create image",
        "make image",
        "\u{56fe}\u{751f}\u{56fe}",
        "\u{4ee5}\u{56fe}\u{751f}\u{56fe}",
        "\u{751f}\u{56fe}",
        "\u{751f}\u{6210}\u{56fe}\u{7247}",
        "\u{751f}\u{6210}\u{65b0}\u{56fe}\u{7247}",
        "\u{751f}\u{6210}\u{65b0}\u{56fe}",
        "\u{753b}\u{4e00}\u{5f20}",
        "\u{753b}\u{4e2a}",
        "\u{628a}\u{8fd9}\u{5f20}\u{56fe}",
        "\u{628a}\u{56fe}",
        "\u{5c06}\u{8fd9}\u{5f20}\u{56fe}",
        "\u{57fa}\u{4e8e}\u{8fd9}\u{5f20}\u{56fe}",
        "\u{6309}\u{8fd9}\u{5f20}\u{56fe}",
        "\u{53c2}\u{8003}\u{8fd9}\u{5f20}\u{56fe}",
    ];

    for prefix in trim_prefixes {
        if prompt.to_ascii_lowercase().starts_with(prefix) || prompt.starts_with(prefix) {
            prompt = prompt[prefix.len()..].trim().to_string();
            break;
        }
    }

    if prompt.is_empty() {
        prompt = "Create a polished variation based on this reference image.".to_string();
    }
    Some(prompt)
}

fn extract_aspect_ratio_from_prompt(prompt_text: &str) -> Option<String> {
    let normalized = prompt_text
        .replace('\u{ff1a}', ":")
        .replace('\u{00d7}', "x")
        .replace('\u{6bd4}', ":");

    for ratio in [
        "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21",
    ] {
        if normalized
            .to_ascii_lowercase()
            .contains(&ratio.to_ascii_lowercase())
        {
            return Some(ratio.to_string());
        }
    }

    let lower = normalized.to_ascii_lowercase();
    if lower.contains("square") {
        return Some("1:1".to_string());
    }
    if lower.contains("landscape") {
        return Some("16:9".to_string());
    }
    if lower.contains("portrait") {
        return Some("9:16".to_string());
    }

    None
}

fn default_image_generation_prompt(instruction: &str) -> Option<String> {
    let trimmed = instruction.trim();
    if is_explicit_image_transform_instruction(trimmed) {
        return None;
    }
    if trimmed.is_empty() {
        return Some("Create a polished variation based on this reference image.".to_string());
    }
    Some(trimmed.to_string())
}

fn is_explicit_image_transform_instruction(instruction: &str) -> bool {
    let lower = instruction.to_ascii_lowercase();
    let english_ops = [
        "compress",
        "conversion",
        "convert",
        "resize",
        "crop",
        "rotate",
        "metadata",
        "optimize",
        "quality",
        "dpi",
        "jpg",
        "jpeg",
        "png",
        "webp",
        "avif",
        "gif",
    ];
    let chinese_ops = [
        "\u{538b}\u{7f29}",
        "\u{8f6c}\u{6362}",
        "\u{8f6c}\u{6210}",
        "\u{88c1}\u{526a}",
        "\u{7f29}\u{653e}",
        "\u{65cb}\u{8f6c}",
        "\u{683c}\u{5f0f}",
        "\u{753b}\u{8d28}",
        "\u{6e05}\u{6670}\u{5ea6}",
        "\u{5206}\u{8fa8}\u{7387}",
    ];

    contains_any(&lower, &english_ops) || contains_any(instruction, &chinese_ops)
}

fn image_reference_for_plan(path: &str, ext: &str, fallback_url: &str) -> String {
    image_data_url_from_path(path, ext).unwrap_or_else(|| fallback_url.to_string())
}

fn image_data_url_from_path(path: &str, ext: &str) -> Option<String> {
    if !is_image_ext(ext) {
        return None;
    }
    inline_data_url_from_path(path, ext)
}

fn inline_data_url_from_path(path: &str, ext: &str) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    if bytes.is_empty() {
        return None;
    }
    if bytes.len() > MAX_INLINE_REFERENCE_BYTES {
        return None;
    }
    let mime = mime_for_ext(ext);
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{mime};base64,{encoded}"))
}

fn mime_for_ext(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        "ogg" => "audio/ogg",
        "txt" => "text/plain",
        "md" => "text/markdown",
        "json" => "application/json",
        "csv" => "text/csv",
        "html" => "text/html",
        "yaml" | "yml" => "application/yaml",
        _ => "application/octet-stream",
    }
}

fn normalize_image_format(format: &str) -> &str {
    if format == "jpeg" {
        "jpg"
    } else {
        format
    }
}

fn build_iopaint_studio_url(source: &str) -> String {
    build_iopaint_studio_url_with_options(source, "manual", None, false)
}

fn build_iopaint_studio_url_with_options(
    source: &str,
    preset: &str,
    placement: Option<&str>,
    autorun: bool,
) -> String {
    let encoded = urlencoding::encode(source);
    let mut query = format!("source={encoded}");
    if !preset.trim().is_empty() && preset != "manual" {
        query.push_str("&preset=");
        query.push_str(&urlencoding::encode(preset));
    }
    if let Some(value) = placement {
        if !value.trim().is_empty() {
            query.push_str("&placement=");
            query.push_str(&urlencoding::encode(value));
        }
    }
    if autorun {
        query.push_str("&autorun=1");
    }
    crate::core::backend::load_backend_config().dashboard_tool_url("image.iopaint_studio", &query)
}

fn output_file_name(input_name: &str, output_ext: Option<&str>) -> String {
    let stem = Path::new(input_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("output");
    match output_ext {
        Some(ext) if !ext.trim().is_empty() => format!("{stem}-omni.{ext}"),
        _ => format!("{stem}-omni"),
    }
}

fn absolute_url(url: &str) -> String {
    crate::core::backend::load_backend_config().absolute_url(url)
}

fn format_ureq_error(err: ureq::Error) -> String {
    match err {
        ureq::Error::Status(code, resp) => {
            let body = resp.into_string().unwrap_or_default();
            if let Ok(value) = serde_json::from_str::<Value>(&body) {
                if let Some(msg) = extract_error_message(&value) {
                    return format!("{code}: {msg}");
                }
            }
            format!("{code}: request failed")
        }
        ureq::Error::Transport(t) => normalize_transport_error_message(&t.to_string()),
    }
}

fn normalize_transport_error_message(message: &str) -> String {
    let lower = message.to_ascii_lowercase();
    if lower.contains("connection refused")
        || lower.contains("actively refused")
        || lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("dns")
        || lower.contains("failed to connect")
        || lower.contains("10060")
        || lower.contains("10061")
    {
        crate::core::backend::load_backend_config().unavailable_message()
    } else {
        message.to_string()
    }
}

fn extract_error_message(value: &Value) -> Option<String> {
    if let Some(msg) = value
        .get("error")
        .and_then(|v| v.get("message"))
        .and_then(Value::as_str)
    {
        return Some(msg.to_string());
    }
    value
        .get("message")
        .and_then(Value::as_str)
        .map(|s| s.to_string())
}

fn push_text(buf: &mut Vec<u8>, text: &str) {
    buf.extend_from_slice(text.as_bytes());
}

fn sanitize_filename_for_multipart(name: &str) -> String {
    name.replace('"', "_")
}

fn sanitize_output_name(name: &str) -> String {
    name.chars()
        .map(|ch| match ch {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => ch,
        })
        .collect()
}

fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("file.bin")
        .to_string()
}

fn file_ext(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default()
}

fn contains_any(text: &str, words: &[&str]) -> bool {
    words.iter().any(|word| text.contains(word))
}

fn find_aspect_ratio_recursive(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return extract_aspect_ratio_from_prompt(text);
    }

    if let Some(obj) = value.as_object() {
        for key in ["aspect_ratio", "aspectRatio"] {
            if let Some(raw) = obj.get(key) {
                if let Some(found) = find_aspect_ratio_recursive(raw) {
                    return Some(found);
                }
            }
        }
        for nested in obj.values() {
            if let Some(found) = find_aspect_ratio_recursive(nested) {
                return Some(found);
            }
        }
    }

    if let Some(arr) = value.as_array() {
        for item in arr {
            if let Some(found) = find_aspect_ratio_recursive(item) {
                return Some(found);
            }
        }
    }

    None
}

fn is_image_ext(ext: &str) -> bool {
    matches!(
        ext,
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "avif"
    )
}

fn is_video_ext(ext: &str) -> bool {
    matches!(ext, "mp4" | "mov" | "avi" | "mkv" | "webm")
}

fn is_audio_ext(ext: &str) -> bool {
    matches!(ext, "mp3" | "wav" | "flac" | "aac" | "m4a" | "ogg")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn single_plan(path: &str, ext: &str, instruction: &str, file_url: &str) -> ExecutionPlan {
        choose_plan(
            &[path.to_string()],
            ext,
            instruction,
            &[file_url.to_string()],
        )
        .expect("choose plan result")
        .expect("plan")
    }

    #[test]
    fn normalize_transport_error_message_handles_windows_connection_refused() {
        let message =
            "Connection Failed: Connect error: 目标计算机积极拒绝，无法连接。 (os error 10061)";
        assert_eq!(
            normalize_transport_error_message(message),
            crate::core::backend::load_backend_config().unavailable_message()
        );
    }

    #[test]
    fn choose_plan_prefers_image_generation_for_img2img_instruction() {
        let instruction = "\u{56fe}\u{751f}\u{56fe} \u{628a}\u{8fd9}\u{5f20}\u{56fe}\u{6539}\u{6210}\u{8d5b}\u{535a}\u{670b}\u{514b}\u{98ce}\u{683c}";
        let file_url = "http://127.0.0.1:3010/api/v1/files/demo";
        let plan = single_plan("missing.png", "png", instruction, file_url);

        assert_eq!(plan.tool, "generate.image");
        assert_eq!(plan.output_ext.as_deref(), Some("png"));
        assert_eq!(
            plan.params
                .get("reference_image_url")
                .and_then(Value::as_str),
            Some(file_url)
        );
        assert!(plan
            .params
            .get("prompt")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .contains("\u{8d5b}\u{535a}\u{670b}\u{514b}"));
    }

    #[test]
    fn choose_plan_keeps_convert_for_format_instruction() {
        let file_url = "http://127.0.0.1:3010/api/v1/files/demo";
        let plan = single_plan("missing.png", "png", "convert to webp", file_url);
        assert_eq!(plan.tool, "image.convert");
        assert_eq!(
            plan.params.get("format").and_then(Value::as_str),
            Some("webp")
        );
    }

    #[test]
    fn choose_plan_detects_generate_new_image_phrase() {
        let file_url = "http://127.0.0.1:3010/api/v1/files/demo";
        let plan = single_plan(
            "missing.png",
            "png",
            "\u{751f}\u{6210}\u{65b0}\u{56fe}\u{7247}\u{ff0c}\u{6539}\u{6210}\u{84b8}\u{6c7d}\u{6ce2}\u{98ce}\u{683c}",
            file_url,
        );

        assert_eq!(plan.tool, "generate.image");
        assert_eq!(
            plan.params
                .get("reference_image_url")
                .and_then(Value::as_str),
            Some(file_url)
        );
    }

    #[test]
    fn choose_plan_defaults_to_generate_for_freeform_image_prompt() {
        let file_url = "http://127.0.0.1:3010/api/v1/files/demo";
        let plan = single_plan("missing.png", "png", "make it watercolor style", file_url);
        assert_eq!(plan.tool, "generate.image");
        assert_eq!(
            plan.params
                .get("reference_image_url")
                .and_then(Value::as_str),
            Some(file_url)
        );
    }

    #[test]
    fn choose_plan_uses_data_url_reference_when_local_image_exists() {
        let path = std::env::temp_dir().join("omniagent-island-img2img-ref.bin");
        std::fs::write(&path, [0u8, 1, 2, 3]).expect("write temp file");
        let file_url = "http://127.0.0.1:3010/api/v1/files/demo";
        let plan = single_plan(
            path.to_str().expect("temp path"),
            "png",
            "turn this into a neon icon",
            file_url,
        );

        let reference = plan
            .params
            .get("reference_image_url")
            .and_then(Value::as_str)
            .unwrap_or_default();
        assert!(reference.starts_with("data:image/png;base64,"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn choose_plan_defaults_to_generate_when_instruction_empty() {
        let file_url = "http://127.0.0.1:3010/api/v1/files/demo";
        let plan = single_plan("missing.png", "png", "", file_url);
        assert_eq!(plan.tool, "generate.image");
        assert_eq!(
            plan.params.get("prompt").and_then(Value::as_str),
            Some("Create a polished variation based on this reference image.")
        );
    }

    #[test]
    fn choose_plan_carries_aspect_ratio_from_prompt() {
        let file_url = "http://127.0.0.1:3010/api/v1/files/demo";
        let plan = single_plan(
            "missing.png",
            "png",
            "generate a 4:5 poster from this image",
            file_url,
        );
        assert_eq!(
            plan.params.get("aspect_ratio").and_then(Value::as_str),
            Some("4:5")
        );
    }

    #[test]
    fn choose_plan_routes_image_watermark_cleanup() {
        let file_url = "http://127.0.0.1:3010/api/v1/files/demo";
        let plan = single_plan(
            "missing.png",
            "png",
            "\u{53bb}\u{6389}\u{53f3}\u{4e0b}\u{89d2}\u{6c34}\u{5370}",
            file_url,
        );
        assert_eq!(plan.tool, "image.remove_watermark");
        assert_eq!(
            plan.params.get("placement").and_then(Value::as_str),
            Some("bottom-right")
        );
    }

    #[test]
    fn choose_plan_routes_image_upscale() {
        let file_url = "http://127.0.0.1:3010/api/v1/files/demo";
        let plan = single_plan(
            "missing.png",
            "png",
            "\u{628a}\u{56fe}\u{7247}\u{63d0}\u{5347}\u{6210}4K\u{9ad8}\u{6e05}",
            file_url,
        );
        assert_eq!(plan.tool, "image.upscale");
        assert_eq!(plan.params.get("scale").and_then(Value::as_u64), Some(4));
    }

    #[test]
    fn choose_plan_routes_multi_image_batch_watermark_cleanup() {
        let paths = vec!["a.png".to_string(), "b.png".to_string()];
        let urls = vec![
            "http://127.0.0.1:3010/api/v1/files/a".to_string(),
            "http://127.0.0.1:3010/api/v1/files/b".to_string(),
        ];
        let plan = choose_plan(
            &paths,
            "png",
            "\u{6279}\u{91cf}\u{53bb}\u{6c34}\u{5370}",
            &urls,
        )
        .expect("choose plan result")
        .expect("plan");

        assert_eq!(plan.tool, "image.remove_watermark_batch");
        assert_eq!(plan.output_ext.as_deref(), Some("zip"));
        assert!(
            plan.params
                .get("file_urls")
                .and_then(Value::as_array)
                .map(|items| items.len())
                .unwrap_or_default()
                == 2
        );
    }

    #[test]
    fn choose_plan_routes_generic_file_compress_for_docx() {
        let plan = single_plan(
            "brief.docx",
            "docx",
            "compress this file into zip",
            "http://127.0.0.1:3010/api/v1/files/brief",
        );
        assert_eq!(plan.tool, "file.compress");
        assert_eq!(plan.output_ext.as_deref(), Some("zip"));
    }

    #[test]
    fn choose_plan_routes_multi_file_compress_to_archive() {
        let plan = choose_plan(
            &[
                "a.docx".to_string(),
                "b.png".to_string(),
                "c.txt".to_string(),
            ],
            "docx",
            "archive these files",
            &[
                "http://127.0.0.1:3010/api/v1/files/a".to_string(),
                "http://127.0.0.1:3010/api/v1/files/b".to_string(),
                "http://127.0.0.1:3010/api/v1/files/c".to_string(),
            ],
        )
        .expect("choose plan result")
        .expect("plan");

        assert_eq!(plan.tool, "file.compress");
        assert_eq!(plan.output_ext.as_deref(), Some("zip"));
        assert_eq!(
            plan.params
                .get("file_urls")
                .and_then(Value::as_array)
                .map(|items| items.len()),
            Some(3)
        );
    }

    #[test]
    fn choose_plan_supports_pdf_page_count() {
        let plan = single_plan(
            "report.pdf",
            "pdf",
            "count pages in this pdf",
            "http://127.0.0.1:3010/api/v1/files/report",
        );
        assert_eq!(plan.tool, "pdf.page_count");
        assert_eq!(plan.output_ext.as_deref(), Some("json"));
    }

    #[test]
    fn choose_plan_supports_pdf_split() {
        let plan = single_plan(
            "report.pdf",
            "pdf",
            "split pages 2-5",
            "http://127.0.0.1:3010/api/v1/files/report",
        );
        assert_eq!(plan.tool, "pdf.split");
        assert_eq!(
            plan.params.get("ranges").and_then(Value::as_str),
            Some("2-5")
        );
    }

    #[test]
    fn choose_plan_supports_pdf_to_image() {
        let plan = single_plan(
            "report.pdf",
            "pdf",
            "convert pdf pages to images",
            "http://127.0.0.1:3010/api/v1/files/report",
        );
        assert_eq!(plan.tool, "pdf.to_image");
        assert_eq!(plan.output_ext.as_deref(), Some("png"));
    }

    #[test]
    fn choose_plan_defaults_pdf_to_compress() {
        let plan = single_plan(
            "report.pdf",
            "pdf",
            "",
            "http://127.0.0.1:3010/api/v1/files/report",
        );
        assert_eq!(plan.tool, "pdf.compress");
        assert_eq!(plan.output_ext.as_deref(), Some("pdf"));
    }

    #[test]
    fn choose_plan_supports_pdf_merge_for_multiple_files() {
        let plan = choose_plan(
            &["a.pdf".to_string(), "b.pdf".to_string()],
            "pdf",
            "merge these pdfs",
            &[
                "http://127.0.0.1:3010/api/v1/files/a".to_string(),
                "http://127.0.0.1:3010/api/v1/files/b".to_string(),
            ],
        )
        .expect("choose plan result")
        .expect("plan");
        assert_eq!(plan.tool, "pdf.merge");
        assert_eq!(
            plan.params.get("file_urls").and_then(Value::as_str),
            Some("http://127.0.0.1:3010/api/v1/files/a,http://127.0.0.1:3010/api/v1/files/b")
        );
    }

    #[test]
    fn choose_plan_supports_word_extract_text() {
        let plan = single_plan(
            "notes.docx",
            "docx",
            "extract text",
            "http://127.0.0.1:3010/api/v1/files/notes",
        );
        assert_eq!(plan.tool, "word.extract_text");
        assert_eq!(plan.output_ext.as_deref(), Some("txt"));
    }

    #[test]
    fn choose_plan_supports_json_yaml_conversion() {
        let path = std::env::temp_dir().join("omniagent-island-convert.json");
        std::fs::write(&path, "{\"name\":\"omni\"}").expect("write temp json");
        let plan = single_plan(
            path.to_str().expect("json path"),
            "json",
            "convert to yaml",
            "http://127.0.0.1:3010/api/v1/files/json",
        );
        assert_eq!(plan.tool, "convert.json_yaml");
        assert_eq!(plan.output_ext.as_deref(), Some("yaml"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn choose_plan_supports_json_csv_conversion() {
        let path = std::env::temp_dir().join("omniagent-island-convert-json-csv.json");
        std::fs::write(&path, "[{\"name\":\"omni\"}]").expect("write temp json");
        let plan = single_plan(
            path.to_str().expect("json path"),
            "json",
            "convert to csv",
            "http://127.0.0.1:3010/api/v1/files/json-csv",
        );
        assert_eq!(plan.tool, "convert.json_csv");
        assert_eq!(plan.output_ext.as_deref(), Some("csv"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn choose_plan_supports_json_format_conversion() {
        let path = std::env::temp_dir().join("omniagent-island-convert-json-format.json");
        std::fs::write(&path, "{\"name\":\"omni\"}").expect("write temp json");
        let plan = single_plan(
            path.to_str().expect("json path"),
            "json",
            "format json",
            "http://127.0.0.1:3010/api/v1/files/json-format",
        );
        assert_eq!(plan.tool, "convert.json_format");
        assert_eq!(plan.output_ext.as_deref(), Some("json"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn choose_plan_supports_yaml_json_conversion() {
        let path = std::env::temp_dir().join("omniagent-island-convert.yaml");
        std::fs::write(&path, "name: omni").expect("write temp yaml");
        let plan = single_plan(
            path.to_str().expect("yaml path"),
            "yaml",
            "convert to json",
            "http://127.0.0.1:3010/api/v1/files/yaml",
        );
        assert_eq!(plan.tool, "convert.yaml_json");
        assert_eq!(plan.output_ext.as_deref(), Some("json"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn choose_plan_supports_csv_json_conversion() {
        let path = std::env::temp_dir().join("omniagent-island-convert.csv");
        std::fs::write(&path, "name\nomni\n").expect("write temp csv");
        let plan = single_plan(
            path.to_str().expect("csv path"),
            "csv",
            "convert to json",
            "http://127.0.0.1:3010/api/v1/files/csv",
        );
        assert_eq!(plan.tool, "convert.csv_json");
        assert_eq!(plan.output_ext.as_deref(), Some("json"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn choose_plan_supports_markdown_html_conversion() {
        let path = std::env::temp_dir().join("omniagent-island-convert.md");
        std::fs::write(&path, "# hello").expect("write temp markdown");
        let plan = single_plan(
            path.to_str().expect("markdown path"),
            "md",
            "",
            "http://127.0.0.1:3010/api/v1/files/markdown",
        );
        assert_eq!(plan.tool, "convert.md_html");
        assert_eq!(plan.output_ext.as_deref(), Some("html"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn choose_plan_supports_video_compress() {
        let plan = single_plan(
            "clip.mp4",
            "mp4",
            "compress this video",
            "http://127.0.0.1:3010/api/v1/files/clip",
        );
        assert_eq!(plan.tool, "video.compress");
        assert_eq!(plan.params.get("crf").and_then(Value::as_u64), Some(28));
    }

    #[test]
    fn choose_plan_supports_video_trim() {
        let plan = single_plan(
            "clip.mp4",
            "mp4",
            "trim from 00:00:03 to 00:00:12",
            "http://127.0.0.1:3010/api/v1/files/clip",
        );
        assert_eq!(plan.tool, "video.trim");
        assert_eq!(
            plan.params.get("start").and_then(Value::as_str),
            Some("00:00:03")
        );
        assert_eq!(
            plan.params.get("end").and_then(Value::as_str),
            Some("00:00:12")
        );
    }

    #[test]
    fn choose_plan_supports_video_extract_audio() {
        let plan = single_plan(
            "clip.mp4",
            "mp4",
            "extract audio",
            "http://127.0.0.1:3010/api/v1/files/clip",
        );
        assert_eq!(plan.tool, "video.extract_audio");
        assert_eq!(plan.output_ext.as_deref(), Some("mp3"));
    }

    #[test]
    fn choose_plan_supports_audio_transcribe_text() {
        let plan = single_plan(
            "note.mp3",
            "mp3",
            "transcribe to text file",
            "http://127.0.0.1:3010/api/v1/files/note",
        );
        assert_eq!(plan.tool, "audio.transcribe_text");
        assert_eq!(plan.output_ext.as_deref(), Some("txt"));
    }

    #[test]
    fn choose_plan_defaults_video_to_convert() {
        let plan = single_plan(
            "clip.mp4",
            "mp4",
            "",
            "http://127.0.0.1:3010/api/v1/files/clip",
        );
        assert_eq!(plan.tool, "video.convert");
        assert_eq!(plan.output_ext.as_deref(), Some("mp4"));
    }

    #[test]
    fn extract_result_aspect_ratio_reads_nested_output() {
        let result = json!({
            "output": {
                "aspect_ratio": "16:9"
            }
        });
        assert_eq!(
            extract_result_aspect_ratio(&result).as_deref(),
            Some("16:9")
        );
    }

    #[test]
    fn image_reference_falls_back_to_url_for_large_image() {
        let path = std::env::temp_dir().join("omniagent-island-img2img-large.bin");
        let large = vec![7u8; MAX_INLINE_REFERENCE_BYTES + 1024];
        std::fs::write(&path, large).expect("write temp file");
        let fallback = "http://127.0.0.1:3010/api/v1/files/demo";
        let reference =
            image_reference_for_plan(path.to_str().expect("temp path"), "png", fallback);
        assert_eq!(reference, fallback);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn inline_data_url_from_path_supports_small_audio() {
        let path = std::env::temp_dir().join("omniagent-island-inline-audio.mp3");
        std::fs::write(&path, vec![1_u8, 2, 3, 4]).expect("write temp audio");
        let reference =
            inline_data_url_from_path(path.to_str().expect("temp path"), "mp3").expect("inline");
        assert!(reference.starts_with("data:audio/mpeg;base64,"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn materialize_result_artifact_writes_text_output() {
        let path = materialize_result_artifact(
            &json!({ "output": { "text": "hello omni" } }),
            "result.json",
            Some("yaml"),
        )
        .expect("artifact path");
        let saved = std::fs::read_to_string(&path).expect("read artifact");
        assert_eq!(saved, "hello omni");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn extract_capture_summary_text_prefers_summary_then_analysis_then_transcript() {
        assert_eq!(
            extract_capture_summary_text(&json!({
                "summary": "Short summary",
                "analysis": "Longer analysis",
                "transcript": "Transcript"
            })),
            Some("Short summary".to_string())
        );
        assert_eq!(
            extract_capture_summary_text(&json!({
                "analysis": "Visual analysis",
                "transcript": "Transcript"
            })),
            Some("Visual analysis".to_string())
        );
        assert_eq!(
            extract_capture_summary_text(&json!({
                "transcript": "Transcript only"
            })),
            Some("Transcript only".to_string())
        );
        assert_eq!(extract_capture_summary_text(&json!({})), None);
    }

    #[test]
    fn extract_capture_report_markdown_reads_tool_field() {
        assert_eq!(
            extract_capture_report_markdown(&json!({
                "report_markdown": "# Report\n\nHello"
            })),
            Some("# Report\n\nHello".to_string())
        );
        assert_eq!(extract_capture_report_markdown(&json!({})), None);
    }

    #[test]
    fn materialize_capture_summary_report_writes_markdown_artifact() {
        let (path, file_name, detail) = materialize_capture_summary_report(
            "C:/tmp/audio-note-1.wav",
            "Audio Notes",
            &json!({
                "summary": "Ship island recorder",
                "transcript": "Ship island recorder next."
            }),
        )
        .expect("capture summary artifact");
        let saved = std::fs::read_to_string(&path).expect("read artifact");
        assert!(saved.contains("# Audio Notes Report"));
        assert!(saved.contains("## Overview"));
        assert!(saved.contains("## Transcript"));
        assert_eq!(file_name, "audio-note-1-summary.md");
        assert_eq!(detail, "Markdown notes report. Download to keep.");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn detect_iopaint_studio_options_prefers_watermark_preset() {
        let (preset, placement, autorun, detail) =
            detect_iopaint_studio_options("去水印精修，处理右下角");
        assert_eq!(preset, "watermark");
        assert_eq!(placement, Some("bottom-right"));
        assert!(autorun);
        assert!(detail.contains("Watermark preset"));
    }

    #[test]
    fn detect_iopaint_studio_options_supports_remove_watermark_and_cutout_cn_phrases() {
        let (watermark_preset, watermark_placement, watermark_autorun, _) =
            detect_iopaint_studio_options("去除水印，处理右下角");
        assert_eq!(watermark_preset, "watermark");
        assert_eq!(watermark_placement, Some("bottom-right"));
        assert!(watermark_autorun);

        let (background_preset, background_placement, background_autorun, detail) =
            detect_iopaint_studio_options("扣除背景，保留主体边缘");
        assert_eq!(background_preset, "remove-background");
        assert_eq!(background_placement, None);
        assert!(!background_autorun);
        assert!(detail.contains("Remove background preset"));
    }

    #[test]
    fn build_iopaint_studio_url_with_options_includes_query_flags() {
        let url = build_iopaint_studio_url_with_options(
            "http://127.0.0.1:3010/api/v1/files/demo",
            "watermark",
            Some("top-right"),
            true,
        );
        assert!(url.contains("preset=watermark"));
        assert!(url.contains("placement=top-right"));
        assert!(url.contains("autorun=1"));
    }
}
