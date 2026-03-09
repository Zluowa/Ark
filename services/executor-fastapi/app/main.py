from __future__ import annotations

import json
import mimetypes
import os
import re
import shutil
import subprocess
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import boto3
import httpx
import imageio_ffmpeg
from botocore.client import BaseClient
from botocore.exceptions import ClientError
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from PIL import Image
from pydantic import BaseModel, Field
from pypdf import PdfReader, PdfWriter


app = FastAPI(title="omniagent-executor-fastapi", version="0.2.0")


class ToolExecutionError(Exception):
    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


class ExecuteRequest(BaseModel):
    tool: str
    params: dict[str, Any] = Field(default_factory=dict)


TOOL_ALIASES: dict[str, str] = {
    "pdf_compress": "official.pdf.compress",
    "pdf_merge": "official.pdf.merge",
    "pdf_split": "official.pdf.split",
    "image_compress": "official.image.compress",
    "image_convert": "official.image.convert",
    "image_crop": "official.image.crop",
    "video_transcode": "official.video.transcode",
    "video_extract_audio": "official.video.extract_audio",
    "video_clip": "official.video.clip",
    "json_format": "official.utility.json_format",
    "official.utility.json-format": "official.utility.json_format",
    "official.video.extract-audio": "official.video.extract_audio",
}

REQUIRED_INPUTS: dict[str, list[str]] = {
    "official.pdf.compress": ["file"],
    "official.pdf.merge": ["files"],
    "official.pdf.split": ["file"],
    "official.image.compress": ["file"],
    "official.image.convert": ["file"],
    "official.image.crop": ["file"],
    "official.video.transcode": ["file"],
    "official.video.extract_audio": ["file"],
    "official.video.clip": ["file"],
    "official.utility.json_format": ["text"],
}

SUPPORTED_TOOLS = sorted(REQUIRED_INPUTS.keys())
SAMPLE_DIR = Path(os.getenv("EXECUTOR_SAMPLE_DIR", Path(tempfile.gettempdir()) / "omniagent-samples"))
SAMPLE_DIR.mkdir(parents=True, exist_ok=True)
DEFAULT_ARTIFACT_BASE_URL = "https://cdn.omniagent.dev/outputs"
ALLOW_STUB_INPUTS = os.getenv("EXECUTOR_ALLOW_SAMPLE_INPUT_FALLBACK", "").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}


def as_number(value: Any, fallback: float) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            return float(value)
        except ValueError:
            return fallback
    return fallback


def normalize_tool_id(tool_id: str) -> str:
    normalized = tool_id.strip()
    if not normalized:
        return normalized
    return TOOL_ALIASES.get(normalized.lower(), normalized)


def normalize_ext(value: str | None, fallback: str) -> str:
    if not value:
        return fallback
    normalized = re.sub(r"[^a-z0-9]", "", value.strip().lower().lstrip("."))
    return normalized or fallback


def safe_tool_id(tool_id: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]", "_", tool_id) or "tool"


def is_url(value: str) -> bool:
    return value.startswith("http://") or value.startswith("https://")


def should_stub_url(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host in {"example.com", "www.example.com"}


def rewrite_fetch_url(url: str) -> str:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if host not in {"127.0.0.1", "localhost"}:
        return url

    alias = os.getenv("EXECUTOR_HOST_ALIAS", "host.docker.internal").strip()
    if not alias:
        return url

    netloc = alias
    if parsed.port:
        netloc = f"{alias}:{parsed.port}"
    if parsed.username:
        auth = parsed.username
        if parsed.password:
            auth = f"{auth}:{parsed.password}"
        netloc = f"{auth}@{netloc}"

    return parsed._replace(netloc=netloc).geturl()


def ffmpeg_bin() -> str:
    custom = os.getenv("EXECUTOR_FFMPEG_PATH", "").strip()
    if custom:
        return custom
    return imageio_ffmpeg.get_ffmpeg_exe()


def run_ffmpeg(args: list[str]) -> None:
    completed = subprocess.run(args, check=False, capture_output=True, text=True)
    if completed.returncode == 0:
        return
    stderr = completed.stderr.strip()[-1200:] if completed.stderr else "ffmpeg failed"
    raise ToolExecutionError("ffmpeg_error", stderr, 500)


def write_sample_pdf(path: Path) -> None:
    writer = PdfWriter()
    for _ in range(3):
        writer.add_blank_page(width=595, height=842)
    with path.open("wb") as fp:
        writer.write(fp)


def write_sample_image(path: Path) -> None:
    Image.new("RGB", (1280, 720), (30, 64, 130)).save(path, format="PNG")


def write_sample_video(path: Path) -> None:
    ffmpeg = ffmpeg_bin()
    run_ffmpeg(
        [
            ffmpeg,
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=640x360:rate=24",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=44100",
            "-t",
            "4",
            "-shortest",
            "-pix_fmt",
            "yuv420p",
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            str(path),
        ]
    )


def sample_pdf() -> Path:
    path = SAMPLE_DIR / "sample.pdf"
    if not path.exists():
        write_sample_pdf(path)
    return path


def sample_image() -> Path:
    path = SAMPLE_DIR / "sample.png"
    if not path.exists():
        write_sample_image(path)
    return path


def sample_video() -> Path:
    path = SAMPLE_DIR / "sample.mp4"
    if not path.exists():
        write_sample_video(path)
    return path


def fetch_file(url: str, target: Path) -> None:
    request_url = rewrite_fetch_url(url)
    with httpx.Client(follow_redirects=True, timeout=12.0) as client:
        response = client.get(request_url)
        response.raise_for_status()
        target.write_bytes(response.content)


def valid_pdf(path: Path) -> bool:
    try:
        return path.read_bytes()[:5] == b"%PDF-"
    except OSError:
        return False


def valid_image(path: Path) -> bool:
    try:
        with Image.open(path) as image:
            image.verify()
        return True
    except Exception:
        return False


def valid_video(path: Path) -> bool:
    ffmpeg = ffmpeg_bin()
    completed = subprocess.run(
        [ffmpeg, "-v", "error", "-i", str(path), "-f", "null", "-"],
        check=False,
        capture_output=True,
        text=True,
    )
    return completed.returncode == 0


def resolve_input(value: Any, workdir: Path, name: str, kind: str) -> Path:
    fallback = {
        "pdf": sample_pdf,
        "image": sample_image,
        "video": sample_video,
    }[kind]()
    ext = {"pdf": "pdf", "image": "png", "video": "mp4"}[kind]
    target = workdir / f"{name}.{ext}"

    def copy_stub() -> Path:
        shutil.copyfile(fallback, target)
        return target

    validators = {"pdf": valid_pdf, "image": valid_image, "video": valid_video}
    validate = validators[kind]

    if isinstance(value, str) and value.strip():
        source = value.strip()
        if is_url(source):
            if should_stub_url(source):
                return copy_stub()
            try:
                fetch_file(source, target)
            except Exception as exc:
                if ALLOW_STUB_INPUTS:
                    return copy_stub()
                raise ToolExecutionError(
                    "input_fetch_failed",
                    f"Unable to download {kind} file from URL: {source}",
                    400,
                ) from exc
            if validate(target):
                return target
            if ALLOW_STUB_INPUTS:
                return copy_stub()
            raise ToolExecutionError(
                "validation_error",
                f"Invalid {kind} file content from URL: {source}",
                400,
            )

        local = Path(source)
        if not local.exists():
            if ALLOW_STUB_INPUTS:
                return copy_stub()
            raise ToolExecutionError("validation_error", f"File not found: {source}", 400)
        if not local.is_file():
            raise ToolExecutionError("validation_error", f"Not a file: {source}", 400)

        try:
            shutil.copyfile(local, target)
        except OSError as exc:
            raise ToolExecutionError(
                "validation_error",
                f"Unable to read {kind} file: {source}",
                400,
            ) from exc

        if validate(target):
            return target
        if ALLOW_STUB_INPUTS:
            return copy_stub()
        raise ToolExecutionError("validation_error", f"Invalid {kind} file: {source}", 400)

    if ALLOW_STUB_INPUTS:
        return copy_stub()

    raise ToolExecutionError("validation_error", f"Missing required {kind} file input", 400)


def parse_ranges(raw: Any, total_pages: int) -> list[tuple[int, int]]:
    if total_pages < 1:
        return []
    if not isinstance(raw, str) or not raw.strip():
        return [(1, total_pages)]
    result: list[tuple[int, int]] = []
    for token in raw.split(","):
        item = token.strip()
        if not item:
            continue
        if "-" in item:
            left, right = item.split("-", 1)
            try:
                start = int(left) if left else 1
                end = int(right) if right else total_pages
            except ValueError:
                continue
        else:
            try:
                start = end = int(item)
            except ValueError:
                continue
        start = max(1, min(total_pages, start))
        end = max(1, min(total_pages, end))
        if end < start:
            start, end = end, start
        result.append((start, end))
    return result or [(1, total_pages)]


class ArtifactStore:
    def __init__(self) -> None:
        self.bucket = os.getenv("S3_BUCKET", "").strip()
        self.region = os.getenv("S3_REGION", "us-east-1").strip() or "us-east-1"
        self.access_key = os.getenv("S3_ACCESS_KEY", "").strip()
        self.secret_key = os.getenv("S3_SECRET_KEY", "").strip()
        self.endpoint = os.getenv("S3_ENDPOINT", "").strip()
        self.public_endpoint = os.getenv("S3_PUBLIC_ENDPOINT", "").strip()
        self.base_url = os.getenv("EXECUTOR_ARTIFACT_BASE_URL", "").strip().rstrip("/")
        self.ttl_sec = max(1, int(as_number(os.getenv("S3_SIGNED_URL_TTL_SEC"), 3600)))
        self.enabled = bool(self.bucket and self.access_key and self.secret_key and self.endpoint)
        self._bucket_ready = False
        self._upload_client: BaseClient | None = None
        self._sign_client: BaseClient | None = None

    @property
    def upload_client(self) -> BaseClient | None:
        if not self.enabled:
            return None
        if self._upload_client is None:
            self._upload_client = boto3.client(
                "s3",
                endpoint_url=self.endpoint,
                aws_access_key_id=self.access_key,
                aws_secret_access_key=self.secret_key,
                region_name=self.region,
            )
        return self._upload_client

    @property
    def sign_client(self) -> BaseClient | None:
        if not self.enabled:
            return None
        if self._sign_client is None:
            sign_endpoint = self.public_endpoint or self.endpoint
            self._sign_client = boto3.client(
                "s3",
                endpoint_url=sign_endpoint,
                aws_access_key_id=self.access_key,
                aws_secret_access_key=self.secret_key,
                region_name=self.region,
            )
        return self._sign_client

    def ensure_bucket(self, client: BaseClient) -> None:
        if self._bucket_ready:
            return
        try:
            client.head_bucket(Bucket=self.bucket)
        except ClientError as error:
            status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if status not in (400, 404):
                raise
            try:
                client.create_bucket(Bucket=self.bucket)
            except ClientError as create_error:
                code = create_error.response.get("Error", {}).get("Code")
                if code not in {"BucketAlreadyOwnedByYou", "BucketAlreadyExists"}:
                    raise
        self._bucket_ready = True

    def upload(self, local_path: Path, tool_id: str, extension: str, content_type: str) -> dict[str, Any]:
        safe = safe_tool_id(tool_id)
        ext = normalize_ext(extension, "bin")
        ts = int(time.time() * 1000)
        key = f"tools/{safe}/{time.strftime('%Y-%m-%d')}/{ts}-{os.urandom(6).hex()}.{ext}"

        if not self.enabled:
            base = self.base_url or DEFAULT_ARTIFACT_BASE_URL
            return {"url": f"{base}/{safe}-{ts}.{ext}"}

        upload_client = self.upload_client
        sign_client = self.sign_client
        assert upload_client is not None and sign_client is not None
        self.ensure_bucket(upload_client)
        upload_client.upload_file(
            str(local_path),
            self.bucket,
            key,
            ExtraArgs={"ContentType": content_type, "Metadata": {"tool_id": safe}},
        )
        signed = sign_client.generate_presigned_url(
            ClientMethod="get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=self.ttl_sec,
        )
        return {
            "url": signed,
            "artifact": {
                "bucket": self.bucket,
                "key": key,
                "storage": "s3",
                "content_type": content_type,
                "size_bytes": local_path.stat().st_size,
                "expires_at": int(time.time() * 1000) + self.ttl_sec * 1000,
            },
        }


artifact_store = ArtifactStore()


def upload_file(path: Path, tool_id: str, extension: str) -> dict[str, Any]:
    ctype = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    return artifact_store.upload(path, tool_id, extension, ctype)


def assert_required(tool_id: str, params: dict[str, Any]) -> None:
    for key in REQUIRED_INPUTS.get(tool_id, []):
        value = params.get(key)
        missing = (
            value is None
            or value == ""
            or (isinstance(value, str) and not value.strip())
            or (isinstance(value, list) and len(value) == 0)
        )
        if missing:
            raise ToolExecutionError("validation_error", f"Missing required param: {key}", 400)


def process_pdf_compress(params: dict[str, Any], workdir: Path, tool_id: str) -> dict[str, Any]:
    input_file = resolve_input(params.get("file"), workdir, "input", "pdf")
    quality = int(max(1, min(100, as_number(params.get("quality"), 75))))
    output_file = workdir / "compressed.pdf"
    reader = PdfReader(str(input_file))
    writer = PdfWriter()
    for page in reader.pages:
        try:
            page.compress_content_streams()
        except Exception:
            pass
        writer.add_page(page)
    with output_file.open("wb") as fp:
        writer.write(fp)
    uploaded = upload_file(output_file, tool_id, "pdf")
    original_size = input_file.stat().st_size
    compressed_size = output_file.stat().st_size
    ratio = int(max(0, min(99, round((1 - compressed_size / max(1, original_size)) * 100))))
    result = {
        "output_file_url": uploaded["url"],
        "original_size": f"{original_size / (1024 * 1024):.2f} MB",
        "compressed_size": f"{compressed_size / (1024 * 1024):.2f} MB",
        "compression_ratio": f"{ratio}%",
        "quality": quality,
    }
    if "artifact" in uploaded:
        result["artifact"] = uploaded["artifact"]
    return result


def process_pdf_merge(params: dict[str, Any], workdir: Path, tool_id: str) -> dict[str, Any]:
    files = params.get("files")
    if not isinstance(files, list) or not files:
        raise ToolExecutionError("validation_error", "Missing required param: files", 400)
    paths = [resolve_input(value, workdir, f"merge-{idx}", "pdf") for idx, value in enumerate(files, start=1)]
    output_file = workdir / "merged.pdf"
    writer = PdfWriter()
    for path in paths:
        writer.append(str(path))
    with output_file.open("wb") as fp:
        writer.write(fp)
    uploaded = upload_file(output_file, tool_id, "pdf")
    result = {"output_file_url": uploaded["url"], "merged_files": len(paths)}
    if "artifact" in uploaded:
        result["artifact"] = uploaded["artifact"]
    return result


def process_pdf_split(params: dict[str, Any], workdir: Path, tool_id: str) -> dict[str, Any]:
    input_file = resolve_input(params.get("file"), workdir, "split-source", "pdf")
    reader = PdfReader(str(input_file))
    ranges = parse_ranges(params.get("ranges"), len(reader.pages))
    parts_dir = workdir / "parts"
    parts_dir.mkdir(parents=True, exist_ok=True)
    part_files: list[Path] = []
    for idx, (start, end) in enumerate(ranges, start=1):
        writer = PdfWriter()
        for page_index in range(start - 1, end):
            writer.add_page(reader.pages[page_index])
        file_path = parts_dir / f"part-{idx:03d}-{start}-{end}.pdf"
        with file_path.open("wb") as fp:
            writer.write(fp)
        part_files.append(file_path)
    output_file = workdir / "split.zip"
    with zipfile.ZipFile(output_file, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file_path in part_files:
            zf.write(file_path, arcname=file_path.name)
    uploaded = upload_file(output_file, tool_id, "zip")
    normalized_ranges = ",".join(f"{start}-{end}" for start, end in ranges)
    result = {
        "output_archive_url": uploaded["url"],
        "ranges": normalized_ranges,
        "parts": len(part_files),
    }
    if "artifact" in uploaded:
        result["artifact"] = uploaded["artifact"]
    return result


def process_image_compress(params: dict[str, Any], workdir: Path, tool_id: str) -> dict[str, Any]:
    input_file = resolve_input(params.get("file"), workdir, "image-source", "image")
    quality = int(max(1, min(100, as_number(params.get("quality"), 80))))
    output_file = workdir / "image-compressed.webp"
    with Image.open(input_file) as image:
        image.save(output_file, format="WEBP", quality=quality, method=6)
    uploaded = upload_file(output_file, tool_id, "webp")
    result = {"output_file_url": uploaded["url"], "quality": quality}
    if "artifact" in uploaded:
        result["artifact"] = uploaded["artifact"]
    return result


def process_image_convert(params: dict[str, Any], workdir: Path, tool_id: str) -> dict[str, Any]:
    input_file = resolve_input(params.get("file"), workdir, "image-convert-source", "image")
    target = normalize_ext(str(params.get("target_format", "png")), "png")
    if target not in {"png", "jpg", "jpeg", "webp", "gif"}:
        raise ToolExecutionError("validation_error", f"Unsupported target_format: {target}", 400)
    output_ext = "jpg" if target == "jpeg" else target
    output_file = workdir / f"converted.{output_ext}"
    with Image.open(input_file) as image:
        if output_ext == "jpg":
            image.convert("RGB").save(output_file, format="JPEG", quality=90, optimize=True)
        elif output_ext == "webp":
            image.save(output_file, format="WEBP", quality=92, method=6)
        elif output_ext == "gif":
            image.convert("P").save(output_file, format="GIF")
        else:
            image.save(output_file, format=output_ext.upper())
    uploaded = upload_file(output_file, tool_id, output_ext)
    result = {"output_file_url": uploaded["url"], "target_format": output_ext}
    if "artifact" in uploaded:
        result["artifact"] = uploaded["artifact"]
    return result


def process_image_crop(params: dict[str, Any], workdir: Path, tool_id: str) -> dict[str, Any]:
    input_file = resolve_input(params.get("file"), workdir, "image-crop-source", "image")
    x = int(max(0, as_number(params.get("x"), 0)))
    y = int(max(0, as_number(params.get("y"), 0)))
    width = int(max(1, as_number(params.get("width"), 256)))
    height = int(max(1, as_number(params.get("height"), 256)))
    output_file = workdir / "cropped.png"
    with Image.open(input_file) as image:
        right = min(image.width, x + width)
        bottom = min(image.height, y + height)
        if right <= x or bottom <= y:
            raise ToolExecutionError("validation_error", "Crop box is outside image bounds", 400)
        image.crop((x, y, right, bottom)).save(output_file, format="PNG")
    uploaded = upload_file(output_file, tool_id, "png")
    result = {
        "output_file_url": uploaded["url"],
        "crop_box": {"x": x, "y": y, "width": width, "height": height},
    }
    if "artifact" in uploaded:
        result["artifact"] = uploaded["artifact"]
    return result


def process_video_transcode(params: dict[str, Any], workdir: Path, tool_id: str) -> dict[str, Any]:
    input_file = resolve_input(params.get("file"), workdir, "video-source", "video")
    target = normalize_ext(str(params.get("target_format", "mp4")), "mp4")
    if target not in {"mp4", "mov", "mkv", "webm"}:
        raise ToolExecutionError("validation_error", f"Unsupported target_format: {target}", 400)
    output_file = workdir / f"transcoded.{target}"
    ffmpeg = ffmpeg_bin()
    args = [ffmpeg, "-y", "-i", str(input_file)]
    if target == "webm":
        args += ["-c:v", "libvpx-vp9", "-crf", "33", "-b:v", "0", "-c:a", "libopus"]
    else:
        args += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac"]
        if target == "mp4":
            args += ["-movflags", "+faststart"]
    args.append(str(output_file))
    run_ffmpeg(args)
    uploaded = upload_file(output_file, tool_id, target)
    result = {"output_file_url": uploaded["url"], "target_format": target}
    if "artifact" in uploaded:
        result["artifact"] = uploaded["artifact"]
    return result


def process_video_extract_audio(params: dict[str, Any], workdir: Path, tool_id: str) -> dict[str, Any]:
    input_file = resolve_input(params.get("file"), workdir, "video-audio-source", "video")
    target = normalize_ext(str(params.get("target_format", "mp3")), "mp3")
    if target not in {"mp3", "wav", "m4a", "aac", "ogg"}:
        raise ToolExecutionError("validation_error", f"Unsupported target_format: {target}", 400)
    output_file = workdir / f"audio.{target}"
    ffmpeg = ffmpeg_bin()
    args = [ffmpeg, "-y", "-i", str(input_file), "-vn", "-ac", "2", "-ar", "44100"]
    if target == "mp3":
        args += ["-c:a", "libmp3lame", "-b:a", "192k"]
    elif target == "wav":
        args += ["-c:a", "pcm_s16le"]
    elif target in {"m4a", "aac"}:
        args += ["-c:a", "aac", "-b:a", "192k"]
    else:
        args += ["-c:a", "libvorbis", "-q:a", "5"]
    args.append(str(output_file))
    run_ffmpeg(args)
    uploaded = upload_file(output_file, tool_id, target)
    result = {"output_file_url": uploaded["url"], "target_format": target}
    if "artifact" in uploaded:
        result["artifact"] = uploaded["artifact"]
    return result


def process_video_clip(params: dict[str, Any], workdir: Path, tool_id: str) -> dict[str, Any]:
    input_file = resolve_input(params.get("file"), workdir, "video-clip-source", "video")
    start = max(0.0, as_number(params.get("start_seconds"), 0.0))
    end = max(start + 0.1, as_number(params.get("end_seconds"), start + 10.0))
    output_file = workdir / "clip.mp4"
    run_ffmpeg(
        [
            ffmpeg_bin(),
            "-y",
            "-ss",
            f"{start:.3f}",
            "-to",
            f"{end:.3f}",
            "-i",
            str(input_file),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            str(output_file),
        ]
    )
    uploaded = upload_file(output_file, tool_id, "mp4")
    result = {
        "output_file_url": uploaded["url"],
        "start_seconds": round(start, 3),
        "end_seconds": round(end, 3),
    }
    if "artifact" in uploaded:
        result["artifact"] = uploaded["artifact"]
    return result


def process_json_format(params: dict[str, Any], workdir: Path, tool_id: str) -> dict[str, Any]:
    text = params.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ToolExecutionError("validation_error", "Missing required param: text", 400)
    try:
        parsed = json.loads(text)
    except Exception as exc:
        raise ToolExecutionError("invalid_json", "Input text is not valid JSON", 400) from exc
    formatted = json.dumps(parsed, indent=2, ensure_ascii=False)
    output_file = workdir / "formatted.json"
    output_file.write_text(formatted, encoding="utf-8")
    uploaded = upload_file(output_file, tool_id, "json")
    result = {
        "formatted_text": formatted,
        "line_count": len(formatted.splitlines()),
        "output_file_url": uploaded["url"],
    }
    if "artifact" in uploaded:
        result["artifact"] = uploaded["artifact"]
    return result


def execute_by_tool_id(tool_id: str, params: dict[str, Any]) -> dict[str, Any]:
    workdir = Path(tempfile.mkdtemp(prefix="omniagent-exec-"))
    try:
        if tool_id == "official.pdf.compress":
            return process_pdf_compress(params, workdir, tool_id)
        if tool_id == "official.pdf.merge":
            return process_pdf_merge(params, workdir, tool_id)
        if tool_id == "official.pdf.split":
            return process_pdf_split(params, workdir, tool_id)
        if tool_id == "official.image.compress":
            return process_image_compress(params, workdir, tool_id)
        if tool_id == "official.image.convert":
            return process_image_convert(params, workdir, tool_id)
        if tool_id == "official.image.crop":
            return process_image_crop(params, workdir, tool_id)
        if tool_id == "official.video.transcode":
            return process_video_transcode(params, workdir, tool_id)
        if tool_id == "official.video.extract_audio":
            return process_video_extract_audio(params, workdir, tool_id)
        if tool_id == "official.video.clip":
            return process_video_clip(params, workdir, tool_id)
        if tool_id == "official.utility.json_format":
            return process_json_format(params, workdir, tool_id)
        raise ToolExecutionError("tool_not_supported", f"Unsupported tool: {tool_id}", 400)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "executor-fastapi",
        "tools": len(SUPPORTED_TOOLS),
        "artifact_store": "s3" if artifact_store.enabled else "none",
        "ffmpeg": ffmpeg_bin(),
    }


@app.get("/v1/tools")
def list_tools() -> dict[str, Any]:
    return {
        "ok": True,
        "count": len(SUPPORTED_TOOLS),
        "tools": SUPPORTED_TOOLS,
    }


@app.post("/v1/execute")
def execute(payload: ExecuteRequest):
    tool_id = normalize_tool_id(payload.tool)
    if not tool_id:
        return JSONResponse(
            status_code=400,
            content={"status": "failed", "error": {"code": "bad_request", "message": "Missing tool id"}},
        )

    if tool_id not in SUPPORTED_TOOLS:
        return JSONResponse(
            status_code=404,
            content={
                "status": "failed",
                "error": {"code": "tool_not_found", "message": f"Tool not found: {tool_id}"},
            },
        )

    params = payload.params if isinstance(payload.params, dict) else {}
    try:
        assert_required(tool_id, params)
        started_at = time.time()
        result = execute_by_tool_id(tool_id, params)
        duration_ms = max(1, int((time.time() - started_at) * 1000))
        return {"status": "success", "tool": tool_id, "result": result, "duration_ms": duration_ms}
    except ToolExecutionError as exc:
        return JSONResponse(
            status_code=exc.status,
            content={"status": "failed", "error": {"code": exc.code, "message": exc.message}},
        )
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={
                "status": "failed",
                "error": {"code": "execution_error", "message": str(exc)},
            },
        )
