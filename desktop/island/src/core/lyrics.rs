use serde_json::Value;
use std::sync::Arc;

#[derive(Clone, Default, Debug, serde::Serialize, serde::Deserialize)]
pub struct LyricLine {
    pub time_ms: u64,
    pub text: String,
}

pub fn fetch_lyrics(title: &str, artist: &str) -> Option<Arc<Vec<LyricLine>>> {
    if title.is_empty() {
        return None;
    }

    let query = format!("{} {}", title, artist);
    let url = format!(
        "http://music.163.com/api/search/get/web?s={}&type=1&offset=0&total=true&limit=1",
        url_encode(&query)
    );

    let res = ureq::get(&url)
        .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
        .call()
        .ok()?;

    let json: Value = res.into_json().ok()?;

    let song_id = json
        .get("result")?
        .get("songs")?
        .as_array()?
        .get(0)?
        .get("id")?
        .as_i64()?;

    fetch_lyrics_by_id(song_id)
}

pub fn fetch_lyrics_by_id(song_id: i64) -> Option<Arc<Vec<LyricLine>>> {
    let lyric_url = format!(
        "http://music.163.com/api/song/lyric?id={}&lv=1&kv=1&tv=-1",
        song_id
    );

    let lyric_res = ureq::get(&lyric_url)
        .set(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )
        .call()
        .ok()?;

    let lyric_json: Value = lyric_res.into_json().ok()?;

    let lrc_str = lyric_json.get("lrc")?.get("lyric")?.as_str()?;

    Some(Arc::new(parse_lyrics(lrc_str)))
}

fn parse_lyrics(lrc: &str) -> Vec<LyricLine> {
    let mut lines = Vec::new();
    for line in lrc.lines() {
        if line.starts_with('[') {
            if let Some(close_bracket) = line.find(']') {
                let time_str = &line[1..close_bracket];
                let text = line[close_bracket + 1..].trim().to_string();
                if text.is_empty() || is_metadata_line(&text) {
                    continue;
                }

                let parts: Vec<&str> = time_str.split(':').collect();
                if parts.len() == 2 {
                    if let (Ok(mins), Ok(secs)) = (parts[0].parse::<u64>(), parts[1].parse::<f64>())
                    {
                        let time_ms = (mins * 60000) + (secs * 1000.0) as u64;
                        lines.push(LyricLine { time_ms, text });
                    }
                }
            }
        }
    }
    lines.sort_by_key(|l| l.time_ms);
    lines
}

fn is_metadata_line(text: &str) -> bool {
    let compact = text.replace(char::is_whitespace, "");
    if compact.is_empty() {
        return true;
    }
    const PREFIXES: &[&str] = &[
        "作词",
        "作曲",
        "编曲",
        "制作",
        "录音",
        "混音",
        "和声",
        "吉他",
        "贝斯",
        "鼓",
        "词：",
        "曲：",
        "编曲：",
        "producer",
        "prod.",
    ];
    let lower = compact.to_lowercase();
    if PREFIXES
        .iter()
        .any(|prefix| lower.starts_with(&prefix.to_lowercase()))
    {
        return true;
    }

    let trimmed = text.trim();
    trimmed.contains(" - ")
        || trimmed.contains("（")
        || (trimmed.contains('(') && trimmed.contains(')'))
}

fn url_encode(input: &str) -> String {
    let mut output = String::new();
    for b in input.bytes() {
        match b {
            b'0'..=b'9' | b'a'..=b'z' | b'A'..=b'Z' | b'-' | b'_' | b'.' | b'~' => {
                output.push(b as char);
            }
            b' ' => {
                output.push('+');
            }
            _ => {
                output.push_str(&format!("%{:02X}", b));
            }
        }
    }
    output
}
