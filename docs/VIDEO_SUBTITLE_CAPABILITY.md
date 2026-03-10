# Video Subtitle Capability

This document records the real current boundary for video subtitle and transcription work in Ark.

It exists to prevent product copy from over-claiming a universal subtitle tool before the implementation is actually unified.

## Current status

Status:
- Partial

Ark still does not yet ship one universal `video.get_subtitles` contract for arbitrary links.

However, Ark now does ship one local-file subtitle contract for uploaded video files.
It also now ships a real remote-link subtitle flow for Bilibili, YouTube, Douyin, and direct downloadable video URLs.

## What works today

### Bilibili link subtitle extraction

Implemented:
- `media.extract_subtitle`

Current boundary:
- Tries official subtitles first
- Falls back to ASR when the video does not expose usable subtitles
- Returns unified `txt + srt + vtt + subtitle bundle` artifacts

### YouTube link subtitle extraction

Implemented:
- `media.extract_subtitle`

Current boundary:
- Tries official or automatic subtitle tracks first
- Downloads subtitle tracks through direct fetch first and proxy fallback when `MEDIA_PROXY` is configured
- Falls back to ASR by downloading audio through `yt-dlp` with an Android client path
- Returns unified `txt + srt + vtt + subtitle bundle` artifacts

### Remote video handling

Implemented:
- `media.video_info`
- `media.download_video`
- `media.download_audio`

Current boundary:
- Link handling exists for Bilibili, YouTube, Douyin, and Xiaohongshu flows
- Unified subtitle extraction is currently validated for:
  - Bilibili links
  - YouTube links
  - Douyin links
  - direct downloadable video URLs
- Xiaohongshu still depends on deployment auth:
  - a valid tenant Xiaohongshu connection
  - or `OMNIAGENT_XHS_COOKIE`
  - and a reachable XHS bridge, defaulting to `http://127.0.0.1:5556` or overridden through `OMNIAGENT_XHS_BRIDGE_URL`

### Local video transcription fallback

Implemented:
- `video.transcribe_subtitle`

Current boundary:
- Local video files can now be processed in one public tool call
- The tool automatically extracts audio, runs ASR, and returns:
  - `transcript`
  - `txt`
  - `srt`
  - `vtt`
  - downloadable subtitle bundle artifact
- This is local-file focused, not a universal link subtitle product yet

### Video summary

Implemented:
- video analysis and summary flows exist

Current boundary:
- Summary is not the same thing as subtitle extraction
- Product copy must not present video summary as if it were subtitle generation

## What does not exist yet

Not finished yet:
- one universal subtitle tool for arbitrary links
- fully unattended Xiaohongshu subtitle extraction without deployment auth
- a managed hosted subtitle product mode

## Correct future product shape

The future public capability should look like this:

1. Try official subtitles first
2. If unavailable, download or extract audio
3. Run transcription fallback
4. Deliver artifacts such as:
   - `txt`
   - `srt`
   - `vtt`
   - optional `md` summary

## Real acceptance cases for the future tool

The minimum real-case matrix should include:
- Bilibili video with or without official subtitles
- YouTube video with available subtitles
- YouTube video without subtitles, using transcription fallback
- local `mp4`
- Chinese speech
- English speech
- mixed-language speech
- a longer recording, not just a short clip

What is validated today:
- real Bilibili link:
  - `https://www.bilibili.com/video/BV1m34y1F7fD/`
- real YouTube link:
  - `https://www.youtube.com/watch?v=dQw4w9WgXcQ`
- real Douyin link:
  - `https://www.iesdouyin.com/share/video/6941975668934610176/`
- remote link subtitle extraction with:
  - unified `txt + srt + vtt`
  - downloadable subtitle bundle
  - recorded `subtitle_source`
  - precise `auth_required` or `bridge_unavailable` boundary recording for Xiaohongshu when deployment auth is missing
- direct downloadable video URL:
  - generated locally during smoke and served through a temporary HTTP URL for reproducible self-hosted validation
- local generated `mp4`
- automatic audio extraction
- ASR fallback
- `txt + srt + vtt` generation
- downloadable subtitle bundle
- self-hosted compatibility:
  - direct network path when reachable
  - optional `MEDIA_PROXY` / `HTTPS_PROXY` / `HTTP_PROXY`

Ark should still describe the overall video subtitle capability as partial because the
cross-platform arbitrary-link matrix is not yet complete, especially for Xiaohongshu.
