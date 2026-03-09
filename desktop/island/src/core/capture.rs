use std::fs::{self, File};
use std::io::{Read, Write};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

pub const AUDIO_CAPTURE_SAMPLE_RATE: u32 = 16_000;
pub const AUDIO_CAPTURE_CHANNELS: u16 = 1;
pub const AUDIO_CAPTURE_BITS: u16 = 16;
const AUDIO_QUIET_PEAK_THRESHOLD: i32 = 200;
const AUDIO_QUIET_RMS_THRESHOLD: f32 = 40.0;
const AUDIO_NORMALIZE_TARGET_PEAK: f32 = 22_000.0;
const AUDIO_NORMALIZE_MAX_GAIN: f32 = 8.0;
const AUDIO_NORMALIZE_MIN_GAIN: f32 = 1.6;

pub struct AudioCaptureResult {
    pub path: PathBuf,
    pub duration_ms: u64,
}

pub struct ScreenCaptureResult {
    pub path: PathBuf,
    pub duration_ms: u64,
}

pub struct AudioCaptureHandle {
    child: Child,
    raw_path: Option<PathBuf>,
    wav_path: PathBuf,
    mp3_path: PathBuf,
    started_at: Instant,
    copy_thread: Option<thread::JoinHandle<Result<u64, String>>>,
}

pub struct ScreenCaptureHandle {
    child: Child,
    output_path: PathBuf,
    started_at: Instant,
}

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static AUDIO_DEVICE_CACHE: OnceLock<Mutex<Option<String>>> = OnceLock::new();

#[derive(Clone, Copy, Debug)]
struct AudioLevelStats {
    peak: i32,
    rms: f32,
}

fn candidate_roots() -> [PathBuf; 2] {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    [manifest_dir.join("../../../.."), manifest_dir.join("../..")]
}

fn local_tool_path(parts: &[&str]) -> Option<PathBuf> {
    for root in candidate_roots() {
        let mut path = root;
        for part in parts {
            path.push(part);
        }
        if path.exists() {
            return Some(path);
        }
    }
    None
}

fn resolve_tool_path(env_key: &str, fallback_parts: &[&str], fallback_bin: &str) -> PathBuf {
    if let Ok(path) = std::env::var(env_key) {
        if !path.trim().is_empty() {
            return PathBuf::from(path);
        }
    }
    if let Some(local) = local_tool_path(fallback_parts) {
        return local;
    }
    PathBuf::from(fallback_bin)
}

fn configure_subprocess(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

fn hidden_command(program: &Path) -> Command {
    let mut command = Command::new(program);
    configure_subprocess(&mut command);
    command
}

fn sox_path() -> PathBuf {
    resolve_tool_path(
        "OMNIAGENT_SOX_PATH",
        &["tools", "sox-14.4.2", "sox.exe"],
        "sox",
    )
}

fn ffmpeg_path() -> PathBuf {
    resolve_tool_path(
        "OMNIAGENT_FFMPEG_PATH",
        &[
            "tools",
            "ffmpeg",
            "ffmpeg-8.0.1-essentials_build",
            "bin",
            "ffmpeg.exe",
        ],
        "ffmpeg",
    )
}

fn capture_dir(download_dir: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(download_dir).join("OmniAgent Captures");
    fs::create_dir_all(&path).map_err(|err| format!("create capture dir: {err}"))?;
    Ok(path)
}

fn unix_stamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

fn audio_capture_paths(download_dir: &str) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let dir = capture_dir(download_dir)?;
    let stem = format!("audio-note-{}", unix_stamp());
    let wav = dir.join(format!("{stem}.wav"));
    let mp3 = dir.join(format!("{stem}.mp3"));
    let raw = dir.join(format!("{stem}.raw"));
    Ok((raw, wav, mp3))
}

fn extract_dshow_device_name(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if !trimmed.contains("(audio)") {
        return None;
    }
    let first_quote = trimmed.find('"')?;
    let remainder = &trimmed[first_quote + 1..];
    let second_quote = remainder.find('"')?;
    let name = remainder[..second_quote].trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

fn detect_ffmpeg_audio_device(ffmpeg: &Path) -> Option<String> {
    let output = hidden_command(ffmpeg)
        .args(["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"])
        .output()
        .ok()?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut fallback = None;
    for line in stderr.lines() {
        let Some(name) = extract_dshow_device_name(line) else {
            continue;
        };
        if fallback.is_none() {
            fallback = Some(name.clone());
        }
        if !name.eq_ignore_ascii_case("virtual-audio-capturer") {
            return Some(name);
        }
    }
    fallback
}

fn resolve_ffmpeg_audio_device(ffmpeg: &Path) -> Option<String> {
    if let Ok(value) = std::env::var("OMNIAGENT_FFMPEG_AUDIO_DEVICE") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    let cache = AUDIO_DEVICE_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(guard) = cache.lock() {
        if let Some(name) = guard.clone() {
            return Some(name);
        }
    }

    let detected = detect_ffmpeg_audio_device(ffmpeg);
    if let Some(name) = detected.as_ref() {
        if let Ok(mut guard) = cache.lock() {
            *guard = Some(name.clone());
        }
    }
    detected
}

fn screen_capture_path(download_dir: &str) -> Result<PathBuf, String> {
    let dir = capture_dir(download_dir)?;
    Ok(dir.join(format!("screen-record-{}.mp4", unix_stamp())))
}

fn write_wav_header(file: &mut File, pcm_len: u32) -> Result<(), String> {
    let sample_rate = AUDIO_CAPTURE_SAMPLE_RATE;
    let channels = AUDIO_CAPTURE_CHANNELS;
    let bits_per_sample = AUDIO_CAPTURE_BITS;
    let block_align = channels * (bits_per_sample / 8);
    let byte_rate = sample_rate * block_align as u32;
    let riff_len = 36_u32.saturating_add(pcm_len);

    file.write_all(b"RIFF")
        .map_err(|err| format!("wav header riff: {err}"))?;
    file.write_all(&riff_len.to_le_bytes())
        .map_err(|err| format!("wav header riff len: {err}"))?;
    file.write_all(b"WAVEfmt ")
        .map_err(|err| format!("wav header wave: {err}"))?;
    file.write_all(&16_u32.to_le_bytes())
        .map_err(|err| format!("wav header fmt size: {err}"))?;
    file.write_all(&1_u16.to_le_bytes())
        .map_err(|err| format!("wav header audio format: {err}"))?;
    file.write_all(&channels.to_le_bytes())
        .map_err(|err| format!("wav header channels: {err}"))?;
    file.write_all(&sample_rate.to_le_bytes())
        .map_err(|err| format!("wav header sample rate: {err}"))?;
    file.write_all(&byte_rate.to_le_bytes())
        .map_err(|err| format!("wav header byte rate: {err}"))?;
    file.write_all(&block_align.to_le_bytes())
        .map_err(|err| format!("wav header block align: {err}"))?;
    file.write_all(&bits_per_sample.to_le_bytes())
        .map_err(|err| format!("wav header bits: {err}"))?;
    file.write_all(b"data")
        .map_err(|err| format!("wav header data: {err}"))?;
    file.write_all(&pcm_len.to_le_bytes())
        .map_err(|err| format!("wav header data len: {err}"))?;
    Ok(())
}

fn read_u32_le(bytes: &[u8], offset: usize) -> Option<u32> {
    let slice = bytes.get(offset..offset + 4)?;
    Some(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn wav_data_range(bytes: &[u8]) -> Result<(usize, usize), String> {
    if bytes.len() < 12 {
        return Err("captured wav was too small".to_string());
    }
    if &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("captured audio was not a wav file".to_string());
    }

    let mut offset = 12usize;
    while offset + 8 <= bytes.len() {
        let chunk_len = read_u32_le(bytes, offset + 4)
            .ok_or_else(|| "captured wav chunk header was truncated".to_string())?
            as usize;
        let data_start = offset + 8;
        let data_end = data_start.saturating_add(chunk_len);
        if data_end > bytes.len() {
            return Err("captured wav chunk exceeded file length".to_string());
        }
        if &bytes[offset..offset + 4] == b"data" {
            return Ok((data_start, chunk_len));
        }
        offset = data_end + (chunk_len % 2);
    }

    Err("captured wav data chunk was missing".to_string())
}

fn analyze_pcm16le(pcm: &[u8]) -> Result<AudioLevelStats, String> {
    if pcm.is_empty() {
        return Err("captured audio was empty".to_string());
    }
    if pcm.len() % 2 != 0 {
        return Err("captured audio pcm had an invalid byte length".to_string());
    }

    let mut peak = 0_i32;
    let mut energy = 0_f64;
    let mut sample_count = 0_usize;
    for sample_bytes in pcm.chunks_exact(2) {
        let sample = i16::from_le_bytes([sample_bytes[0], sample_bytes[1]]) as i32;
        let abs = sample.abs();
        peak = peak.max(abs);
        energy += (sample as f64) * (sample as f64);
        sample_count += 1;
    }

    if sample_count == 0 {
        return Err("captured audio was empty".to_string());
    }

    Ok(AudioLevelStats {
        peak,
        rms: (energy / sample_count as f64).sqrt() as f32,
    })
}

fn apply_gain_pcm16le(pcm: &mut [u8], gain: f32) -> Result<(), String> {
    if pcm.len() % 2 != 0 {
        return Err("captured audio pcm had an invalid byte length".to_string());
    }
    for sample_bytes in pcm.chunks_exact_mut(2) {
        let sample = i16::from_le_bytes([sample_bytes[0], sample_bytes[1]]) as f32;
        let boosted = (sample * gain)
            .round()
            .clamp(i16::MIN as f32, i16::MAX as f32) as i16;
        let encoded = boosted.to_le_bytes();
        sample_bytes[0] = encoded[0];
        sample_bytes[1] = encoded[1];
    }
    Ok(())
}

fn repair_pcm16le_for_voice(pcm: &mut [u8]) -> Result<Option<f32>, String> {
    let stats = analyze_pcm16le(pcm)?;
    if stats.peak < AUDIO_QUIET_PEAK_THRESHOLD && stats.rms < AUDIO_QUIET_RMS_THRESHOLD {
        return Err(
            "Recorded audio was too quiet. Check microphone input and try again.".to_string(),
        );
    }

    let gain = (AUDIO_NORMALIZE_TARGET_PEAK / stats.peak.max(1) as f32)
        .clamp(1.0, AUDIO_NORMALIZE_MAX_GAIN);
    if gain < AUDIO_NORMALIZE_MIN_GAIN {
        return Ok(None);
    }
    apply_gain_pcm16le(pcm, gain)?;
    Ok(Some(gain))
}

fn prepare_wav_for_delivery(wav_path: &Path) -> Result<(), String> {
    let mut bytes = fs::read(wav_path).map_err(|err| format!("read wav: {err}"))?;
    let (data_start, data_len) = wav_data_range(&bytes)?;
    let data_end = data_start.saturating_add(data_len);
    if data_end > bytes.len() {
        return Err("captured wav data chunk exceeded file length".to_string());
    }
    repair_pcm16le_for_voice(&mut bytes[data_start..data_end])?;
    fs::write(wav_path, bytes).map_err(|err| format!("write repaired wav: {err}"))?;
    Ok(())
}

fn finalize_raw_pcm_to_wav(raw_path: &Path, wav_path: &Path) -> Result<u64, String> {
    let raw_bytes = fs::read(raw_path).map_err(|err| format!("read raw audio: {err}"))?;
    if raw_bytes.is_empty() {
        return Err("captured audio was empty".to_string());
    }

    let mut wav_file = File::create(wav_path).map_err(|err| format!("create wav: {err}"))?;
    write_wav_header(&mut wav_file, raw_bytes.len() as u32)?;
    wav_file
        .write_all(&raw_bytes)
        .map_err(|err| format!("write wav data: {err}"))?;
    wav_file
        .flush()
        .map_err(|err| format!("flush wav: {err}"))?;
    let _ = fs::remove_file(raw_path);

    let bytes_per_second = AUDIO_CAPTURE_SAMPLE_RATE as u64 * AUDIO_CAPTURE_CHANNELS as u64 * 2_u64;
    let duration_ms = (raw_bytes.len() as u64).saturating_mul(1000) / bytes_per_second.max(1);
    Ok(duration_ms.max(1))
}

fn transcode_wav_to_mp3(wav_path: &Path, mp3_path: &Path) -> Result<(), String> {
    let ffmpeg = ffmpeg_path();
    let output = hidden_command(&ffmpeg)
        .args([
            "-y",
            "-i",
            wav_path.to_string_lossy().as_ref(),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "64k",
            mp3_path.to_string_lossy().as_ref(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|err| format!("transcode audio to mp3: {err}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "transcode audio to mp3 failed".to_string()
        } else {
            format!("transcode audio to mp3 failed: {stderr}")
        });
    }
    let meta = fs::metadata(mp3_path).map_err(|err| format!("mp3 output: {err}"))?;
    if meta.len() == 0 {
        return Err("transcoded mp3 was empty".to_string());
    }
    let _ = fs::remove_file(wav_path);
    Ok(())
}

impl AudioCaptureHandle {
    pub fn start(download_dir: &str) -> Result<Self, String> {
        Self::start_with_source(download_dir, None)
    }

    pub fn start_with_source(
        download_dir: &str,
        source_path: Option<&Path>,
    ) -> Result<Self, String> {
        let ffmpeg = ffmpeg_path();
        let (_, ffmpeg_wav_path, ffmpeg_mp3_path) = audio_capture_paths(download_dir)?;
        if let Some(source) = source_path {
            if !source.exists() {
                return Err(format!(
                    "audio proof source not found: {}",
                    source.display()
                ));
            }
            match hidden_command(&ffmpeg)
                .args([
                    "-y",
                    "-re",
                    "-i",
                    source.to_string_lossy().as_ref(),
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    "-c:a",
                    "pcm_s16le",
                    ffmpeg_wav_path.to_string_lossy().as_ref(),
                ])
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
            {
                Ok(child) => {
                    return Ok(Self {
                        child,
                        raw_path: None,
                        wav_path: ffmpeg_wav_path,
                        mp3_path: ffmpeg_mp3_path,
                        started_at: Instant::now(),
                        copy_thread: None,
                    });
                }
                Err(err) => {
                    return Err(format!("start ffmpeg file audio capture: {err}"));
                }
            }
        }

        if let Some(device_name) = resolve_ffmpeg_audio_device(&ffmpeg) {
            match hidden_command(&ffmpeg)
                .args([
                    "-y",
                    "-f",
                    "dshow",
                    "-i",
                    &format!("audio={device_name}"),
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    "-c:a",
                    "pcm_s16le",
                    ffmpeg_wav_path.to_string_lossy().as_ref(),
                ])
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
            {
                Ok(child) => {
                    return Ok(Self {
                        child,
                        raw_path: None,
                        wav_path: ffmpeg_wav_path,
                        mp3_path: ffmpeg_mp3_path,
                        started_at: Instant::now(),
                        copy_thread: None,
                    });
                }
                Err(err) => {
                    let _ = err;
                }
            }
        }

        let sox = sox_path();
        let (raw_path, wav_path, mp3_path) = audio_capture_paths(download_dir)?;
        let mut child = hidden_command(&sox)
            .args([
                "-q",
                "-d",
                "-t",
                "raw",
                "-r",
                "16000",
                "-b",
                "16",
                "-c",
                "1",
                "-e",
                "signed-integer",
                "-",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|err| format!("start sox: {err}"))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "audio recorder stdout unavailable".to_string())?;
        let raw_target = raw_path.clone();
        let copy_thread = thread::spawn(move || {
            let mut reader = stdout;
            let mut file =
                File::create(&raw_target).map_err(|err| format!("create raw audio: {err}"))?;
            let mut total = 0_u64;
            let mut buffer = [0_u8; 8192];
            loop {
                let read = reader
                    .read(&mut buffer)
                    .map_err(|err| format!("read recorder pipe: {err}"))?;
                if read == 0 {
                    break;
                }
                file.write_all(&buffer[..read])
                    .map_err(|err| format!("write raw audio: {err}"))?;
                total = total.saturating_add(read as u64);
            }
            file.flush()
                .map_err(|err| format!("flush raw audio: {err}"))?;
            Ok(total)
        });

        Ok(Self {
            child,
            raw_path: Some(raw_path),
            wav_path,
            mp3_path,
            started_at: Instant::now(),
            copy_thread: Some(copy_thread),
        })
    }

    pub fn stop(mut self) -> Result<AudioCaptureResult, String> {
        if self.copy_thread.is_none() {
            if let Some(stdin) = self.child.stdin.as_mut() {
                let _ = stdin.write_all(b"q\n");
                let _ = stdin.flush();
            }

            let deadline = Instant::now() + std::time::Duration::from_secs(3);
            loop {
                if self
                    .child
                    .try_wait()
                    .map_err(|err| format!("wait ffmpeg audio: {err}"))?
                    .is_some()
                {
                    break;
                }
                if Instant::now() >= deadline {
                    let _ = self.child.kill();
                    let _ = self.child.wait();
                    break;
                }
                thread::sleep(std::time::Duration::from_millis(120));
            }

            let meta =
                fs::metadata(&self.wav_path).map_err(|err| format!("audio output: {err}"))?;
            if meta.len() == 0 {
                return Err("captured audio was empty".to_string());
            }
            prepare_wav_for_delivery(&self.wav_path)?;
            transcode_wav_to_mp3(&self.wav_path, &self.mp3_path)?;
            return Ok(AudioCaptureResult {
                path: self.mp3_path,
                duration_ms: self.started_at.elapsed().as_millis() as u64,
            });
        }

        if self
            .child
            .try_wait()
            .map_err(|err| format!("wait sox: {err}"))?
            .is_none()
        {
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
        if let Some(join) = self.copy_thread.take() {
            match join.join() {
                Ok(result) => {
                    result?;
                }
                Err(_) => {
                    return Err("audio recorder thread panicked".to_string());
                }
            }
        }
        let raw_path = self
            .raw_path
            .as_ref()
            .ok_or_else(|| "audio raw path missing".to_string())?;
        let duration_ms = finalize_raw_pcm_to_wav(raw_path, &self.wav_path)?;
        prepare_wav_for_delivery(&self.wav_path)?;
        transcode_wav_to_mp3(&self.wav_path, &self.mp3_path)?;
        Ok(AudioCaptureResult {
            path: self.mp3_path,
            duration_ms: duration_ms.max(self.started_at.elapsed().as_millis() as u64),
        })
    }
}

impl ScreenCaptureHandle {
    pub fn start(download_dir: &str) -> Result<Self, String> {
        let ffmpeg = ffmpeg_path();
        let output_path = screen_capture_path(download_dir)?;
        let child = hidden_command(&ffmpeg)
            .args([
                "-y",
                "-f",
                "gdigrab",
                "-framerate",
                "12",
                "-draw_mouse",
                "1",
                "-i",
                "desktop",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-pix_fmt",
                "yuv420p",
                output_path.to_string_lossy().as_ref(),
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|err| format!("start ffmpeg: {err}"))?;

        Ok(Self {
            child,
            output_path,
            started_at: Instant::now(),
        })
    }

    pub fn stop(mut self) -> Result<ScreenCaptureResult, String> {
        if let Some(stdin) = self.child.stdin.as_mut() {
            let _ = stdin.write_all(b"q\n");
            let _ = stdin.flush();
        }

        let deadline = Instant::now() + std::time::Duration::from_secs(3);
        loop {
            if self
                .child
                .try_wait()
                .map_err(|err| format!("wait ffmpeg: {err}"))?
                .is_some()
            {
                break;
            }
            if Instant::now() >= deadline {
                let _ = self.child.kill();
                let _ = self.child.wait();
                break;
            }
            thread::sleep(std::time::Duration::from_millis(120));
        }

        let meta = fs::metadata(&self.output_path).map_err(|err| format!("video output: {err}"))?;
        if meta.len() == 0 {
            return Err("captured video was empty".to_string());
        }
        Ok(ScreenCaptureResult {
            path: self.output_path,
            duration_ms: self.started_at.elapsed().as_millis() as u64,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pcm_from_samples(samples: &[i16]) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(samples.len() * 2);
        for sample in samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        bytes
    }

    fn wav_from_pcm(pcm: &[u8]) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(44 + pcm.len());
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36_u32 + pcm.len() as u32).to_le_bytes());
        bytes.extend_from_slice(b"WAVE");
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&AUDIO_CAPTURE_CHANNELS.to_le_bytes());
        bytes.extend_from_slice(&AUDIO_CAPTURE_SAMPLE_RATE.to_le_bytes());
        let block_align = AUDIO_CAPTURE_CHANNELS * (AUDIO_CAPTURE_BITS / 8);
        let byte_rate = AUDIO_CAPTURE_SAMPLE_RATE * block_align as u32;
        bytes.extend_from_slice(&byte_rate.to_le_bytes());
        bytes.extend_from_slice(&block_align.to_le_bytes());
        bytes.extend_from_slice(&AUDIO_CAPTURE_BITS.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
        bytes.extend_from_slice(pcm);
        bytes
    }

    #[test]
    fn wav_data_range_finds_pcm_chunk() {
        let pcm = pcm_from_samples(&[0, 256, -256, 512]);
        let wav = wav_from_pcm(&pcm);
        let (start, len) = wav_data_range(&wav).expect("data chunk");
        assert_eq!(len, pcm.len());
        assert_eq!(&wav[start..start + len], pcm.as_slice());
    }

    #[test]
    fn repair_pcm_boosts_quiet_but_valid_voice_signal() {
        let mut pcm = pcm_from_samples(&[0, 600, -600, 1200, -1200, 1800, -1800]);
        let before = analyze_pcm16le(&pcm).expect("before stats");
        let gain = repair_pcm16le_for_voice(&mut pcm)
            .expect("repair should succeed")
            .expect("gain should apply");
        let after = analyze_pcm16le(&pcm).expect("after stats");

        assert!(gain > 1.0);
        assert!(after.peak > before.peak);
        assert!(after.rms > before.rms);
    }

    #[test]
    fn repair_pcm_rejects_near_silent_signal() {
        let mut pcm = pcm_from_samples(&[0, 8, -12, 10, -6, 0, 4, -4]);
        let err = repair_pcm16le_for_voice(&mut pcm).expect_err("near silence should fail");
        assert!(err.contains("too quiet"));
    }
}
