use crate::core::command::Command;
use crate::core::types::ToolStatus;
use serde_json::{json, Value};
use std::sync::mpsc;
use std::time::Duration;

const EXECUTE_ENDPOINT: &str = "http://127.0.0.1:3010/api/v1/execute";

pub fn run_json_format(tx: mpsc::Sender<Command>) {
    std::thread::spawn(move || {
        let name = "convert.json_format".to_string();
        let _ = tx.send(Command::ToolProgress {
            name: name.clone(),
            progress: 0.2,
            status: ToolStatus::Running,
        });

        let payload = json!({
            "tool": "convert.json_format",
            "params": {
                "input": "{\"hello\":true,\"items\":[1,2,3]}"
            }
        });

        let agent = ureq::AgentBuilder::new()
            .try_proxy_from_env(false)
            .timeout_connect(Duration::from_secs(8))
            .timeout(Duration::from_secs(30))
            .build();

        let response = match agent
            .post(EXECUTE_ENDPOINT)
            .set("Content-Type", "application/json")
            .send_string(&payload.to_string())
        {
            Ok(r) => r,
            Err(err) => {
                let _ = tx.send(Command::ToolProgress {
                    name: name.clone(),
                    progress: 1.0,
                    status: ToolStatus::Error,
                });
                let _ = tx.send(Command::ShowNotification {
                    title: "JSON 执行器".to_string(),
                    body: format!("执行失败: {}", format_ureq_error(err)),
                    ttl_ms: 2200,
                });
                return;
            }
        };

        let value = match response.into_json::<Value>() {
            Ok(v) => v,
            Err(err) => {
                let _ = tx.send(Command::ToolProgress {
                    name: name.clone(),
                    progress: 1.0,
                    status: ToolStatus::Error,
                });
                let _ = tx.send(Command::ShowNotification {
                    title: "JSON 执行器".to_string(),
                    body: format!("响应解析失败: {err}"),
                    ttl_ms: 2200,
                });
                return;
            }
        };

        let status = value
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default();

        if status.eq_ignore_ascii_case("success") {
            let _ = tx.send(Command::ToolProgress {
                name: name.clone(),
                progress: 1.0,
                status: ToolStatus::Complete,
            });
            let preview = extract_preview(&value).unwrap_or_else(|| "执行完成".to_string());
            let _ = tx.send(Command::ShowNotification {
                title: "JSON 执行器".to_string(),
                body: preview,
                ttl_ms: 2000,
            });
        } else {
            let detail = value
                .get("error")
                .and_then(|v| v.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("unknown error");
            let _ = tx.send(Command::ToolProgress {
                name: name,
                progress: 1.0,
                status: ToolStatus::Error,
            });
            let _ = tx.send(Command::ShowNotification {
                title: "JSON 执行器".to_string(),
                body: format!("执行失败: {detail}"),
                ttl_ms: 2200,
            });
        }
    });
}

fn extract_preview(value: &Value) -> Option<String> {
    let text = value
        .get("result")
        .and_then(|v| v.get("text"))
        .and_then(Value::as_str)?;
    let one_line = text.replace('\n', " ");
    let preview: String = one_line.chars().take(40).collect();
    Some(format!("结果: {preview}"))
}

fn format_ureq_error(err: ureq::Error) -> String {
    match err {
        ureq::Error::Status(code, resp) => {
            let body = resp.into_string().unwrap_or_default();
            if let Ok(value) = serde_json::from_str::<Value>(&body) {
                if let Some(msg) = value
                    .get("error")
                    .and_then(|v| v.get("message"))
                    .and_then(Value::as_str)
                {
                    return format!("{code}: {msg}");
                }
            }
            format!("{code}: request failed")
        }
        ureq::Error::Transport(t) => {
            let msg = t.to_string();
            let lower = msg.to_ascii_lowercase();
            if lower.contains("connection refused")
                || lower.contains("timed out")
                || lower.contains("dns")
                || lower.contains("failed to connect")
            {
                "backend unavailable on 3010".to_string()
            } else {
                msg
            }
        }
    }
}
