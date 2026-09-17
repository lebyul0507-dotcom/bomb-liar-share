from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener
import imageio_ffmpeg

register_heif_opener()

OUTPUT_DIR = Path(tempfile.gettempdir()) / "photo_music_video_output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_IMAGE_EXT = {
    ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif"
}
ALLOWED_AUDIO_EXT = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus"}
WIDTH = 1080
HEIGHT = 1920
FPS = 30
SECONDS_PER_IMAGE = 3
MAX_UPLOAD_MB = 150
OUTPUT_TTL_SECONDS = 60 * 60

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024

jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()


def set_job(job_id: str, **kwargs) -> None:
    with jobs_lock:
        if job_id in jobs:
            jobs[job_id].update(kwargs)


def get_job(job_id: str) -> dict | None:
    with jobs_lock:
        data = jobs.get(job_id)
        return dict(data) if data else None


def cleanup_job_later(job_id: str, path: Path) -> None:
    def _cleanup() -> None:
        try:
            path.unlink(missing_ok=True)
        finally:
            with jobs_lock:
                jobs.pop(job_id, None)

    timer = threading.Timer(OUTPUT_TTL_SECONDS, _cleanup)
    timer.daemon = True
    timer.start()


def crop_cover(image: Image.Image, width: int = WIDTH, height: int = HEIGHT) -> Image.Image:
    image = ImageOps.exif_transpose(image)
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGB")
    if image.mode == "RGBA":
        bg = Image.new("RGB", image.size, (0, 0, 0))
        bg.paste(image, mask=image.getchannel("A"))
        image = bg
    return ImageOps.fit(
        image,
        (width, height),
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )


def run_ffmpeg(cmd: list[str]) -> None:
    proc = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if proc.returncode != 0:
        tail = proc.stderr[-5000:] if proc.stderr else "Unknown FFmpeg error"
        raise RuntimeError(tail)


def build_video(
    job_id: str,
    image_paths: list[Path],
    audio_path: Path | None,
    output_path: Path,
    upload_dir: Path,
) -> None:
    workdir = Path(tempfile.mkdtemp(prefix=f"pmvm_{job_id}_"))
    try:
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        set_job(job_id, status="processing", progress=8, message="사진을 준비하고 있습니다.")

        frame_paths: list[Path] = []
        for idx, src in enumerate(image_paths, start=1):
            try:
                with Image.open(src) as img:
                    frame = crop_cover(img)
                    frame_path = workdir / f"frame_{idx:04d}.jpg"
                    frame.save(frame_path, format="JPEG", quality=92, optimize=True)
                    frame_paths.append(frame_path)
            except Exception as exc:
                raise RuntimeError(f"{idx}번째 사진을 읽지 못했습니다: {src.name}\n{exc}") from exc

            progress = 8 + int((idx / max(1, len(image_paths))) * 37)
            set_job(job_id, progress=progress, message=f"사진 {idx}/{len(image_paths)} 처리 중")

        concat_file = workdir / "images.txt"
        with concat_file.open("w", encoding="utf-8") as f:
            for frame in frame_paths:
                escaped = str(frame).replace("'", "'\\''")
                f.write(f"file '{escaped}'\n")
                f.write(f"duration {SECONDS_PER_IMAGE}\n")
            last = str(frame_paths[-1]).replace("'", "'\\''")
            f.write(f"file '{last}'\n")

        total_duration = len(frame_paths) * SECONDS_PER_IMAGE
        set_job(job_id, progress=55, message="영상과 음악을 합성하고 있습니다.")

        cmd = [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel", "error",
            "-f", "concat",
            "-safe", "0",
            "-i", str(concat_file),
        ]

        if audio_path:
            cmd += ["-stream_loop", "-1", "-i", str(audio_path)]

        cmd += [
            "-t", str(total_duration),
            "-vf", f"fps={FPS},format=yuv420p",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "22",
            "-threads", "1",
            "-movflags", "+faststart",
        ]

        if audio_path:
            fade_start = max(0.0, total_duration - 0.8)
            cmd += [
                "-map", "0:v:0",
                "-map", "1:a:0",
                "-c:a", "aac",
                "-b:a", "160k",
                "-af", f"afade=t=out:st={fade_start:.3f}:d=0.8",
            ]
        else:
            cmd += ["-an"]

        cmd.append(str(output_path))
        run_ffmpeg(cmd)

        set_job(
            job_id,
            status="done",
            progress=100,
            message="완료되었습니다. 1시간 안에 다운로드해 주세요.",
            filename=output_path.name,
        )
        cleanup_job_later(job_id, output_path)
    except Exception as exc:
        output_path.unlink(missing_ok=True)
        set_job(job_id, status="error", progress=0, message=str(exc))
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
        shutil.rmtree(upload_dir, ignore_errors=True)


@app.get("/")
def index():
    return render_template(
        "index.html",
        seconds_per_image=SECONDS_PER_IMAGE,
        max_upload_mb=MAX_UPLOAD_MB,
    )


@app.get("/health")
def health():
    return jsonify({"ok": True})


@app.post("/api/render")
def render_video():
    images = request.files.getlist("images")
    audio = request.files.get("audio")
    order_raw = request.form.get("order", "[]")

    if not images:
        return jsonify({"error": "사진을 1장 이상 선택해 주세요."}), 400

    try:
        order = json.loads(order_raw)
        if not isinstance(order, list) or len(order) != len(images):
            order = list(range(len(images)))
        order = [int(x) for x in order]
        if sorted(order) != list(range(len(images))):
            order = list(range(len(images)))
    except Exception:
        order = list(range(len(images)))

    for f in images:
        ext = Path(f.filename or "").suffix.lower()
        if ext not in ALLOWED_IMAGE_EXT:
            return jsonify({"error": f"지원하지 않는 사진 형식입니다: {f.filename}"}), 400

    if audio and audio.filename:
        audio_ext = Path(audio.filename).suffix.lower()
        if audio_ext not in ALLOWED_AUDIO_EXT:
            return jsonify({"error": f"지원하지 않는 음악 형식입니다: {audio.filename}"}), 400
    else:
        return jsonify({"error": "음악 파일을 선택해 주세요."}), 400

    upload_dir = Path(tempfile.mkdtemp(prefix="pmvm_upload_"))
    saved_images: list[Path] = []

    try:
        for idx, f in enumerate(images):
            ext = Path(f.filename or ".jpg").suffix.lower() or ".jpg"
            target = upload_dir / f"image_{idx:04d}{ext}"
            f.save(target)
            saved_images.append(target)

        saved_images = [saved_images[i] for i in order]

        audio_ext = Path(audio.filename).suffix.lower()
        saved_audio = upload_dir / f"music{audio_ext}"
        audio.save(saved_audio)

        job_id = uuid.uuid4().hex
        stamp = time.strftime("%Y%m%d_%H%M%S")
        output_path = OUTPUT_DIR / f"photo_video_{stamp}_{job_id[:6]}.mp4"

        with jobs_lock:
            jobs[job_id] = {
                "status": "queued",
                "progress": 2,
                "message": "작업을 시작합니다.",
                "filename": None,
            }

        thread = threading.Thread(
            target=build_video,
            args=(job_id, saved_images, saved_audio, output_path, upload_dir),
            daemon=True,
        )
        thread.start()

        return jsonify({"job_id": job_id, "duration": len(images) * SECONDS_PER_IMAGE})
    except Exception:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise


@app.get("/api/status/<job_id>")
def job_status(job_id: str):
    job = get_job(job_id)
    if not job:
        return jsonify({"error": "작업을 찾을 수 없습니다. 다시 영상을 만들어 주세요."}), 404
    return jsonify(job)


@app.get("/api/download/<job_id>")
def download(job_id: str):
    job = get_job(job_id)
    if not job or job.get("status") != "done" or not job.get("filename"):
        return jsonify({"error": "완료된 영상이 없습니다."}), 404

    path = OUTPUT_DIR / job["filename"]
    if not path.exists():
        return jsonify({"error": "영상 보관 시간이 지나 삭제되었습니다. 다시 만들어 주세요."}), 404

    return send_file(path, as_attachment=True, download_name=path.name, mimetype="video/mp4")


@app.get("/api/preview/<job_id>")
def preview(job_id: str):
    job = get_job(job_id)
    if not job or job.get("status") != "done" or not job.get("filename"):
        return jsonify({"error": "완료된 영상이 없습니다."}), 404

    path = OUTPUT_DIR / job["filename"]
    if not path.exists():
        return jsonify({"error": "영상 보관 시간이 지나 삭제되었습니다."}), 404

    return send_file(path, mimetype="video/mp4", conditional=True)


@app.errorhandler(413)
def too_large(_error):
    return jsonify({"error": f"업로드 용량이 너무 큽니다. 전체 파일을 {MAX_UPLOAD_MB}MB 이하로 줄여 주세요."}), 413


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5050"))
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
