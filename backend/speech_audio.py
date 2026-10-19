"""Bounded local audio decoding. No remote URLs or persistent audio storage."""
from array import array
from dataclasses import dataclass
import io
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import wave

MAX_BYTES = 20 * 1024 * 1024
MAX_SECONDS = 60
RATE = 16000


class AudioError(Exception):
    pass


@dataclass(frozen=True)
class NormalizedAudio:
    wav: bytes
    duration: float
    silent: bool


def ffmpeg_path() -> str | None:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except (ImportError, RuntimeError):
        return shutil.which('ffmpeg')


def normalize_audio(content: bytes) -> NormalizedAudio:
    if not content or len(content) > MAX_BYTES:
        raise AudioError('音频不能为空，文件大小不能超过 20 MB。')
    executable = ffmpeg_path()
    if not executable:
        raise AudioError('音频转换组件未安装，请安装 backend/requirements-speech.txt 后重启后端。')
    with tempfile.TemporaryDirectory(prefix='vision-speech-') as directory:
        source = Path(directory) / 'input.audio'
        source.write_bytes(content)
        command = [
            executable, '-hide_banner', '-loglevel', 'error', '-nostdin',
            '-max_alloc', '67108864', '-threads', '1',
            '-protocol_whitelist', 'file,pipe',
            '-format_whitelist', 'wav,mp3,mov,matroska,webm,ogg',
            '-i', str(source), '-map', '0:a:0', '-vn', '-sn', '-dn',
            '-filter_threads', '1', '-ac', '1', '-ar', str(RATE),
            '-t', str(MAX_SECONDS + 1), '-f', 's16le', 'pipe:1',
        ]
        try:
            decoded = subprocess.run(command, capture_output=True, timeout=15, check=False,
                                     creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
        except subprocess.TimeoutExpired:
            raise AudioError('音频解码超时，请换用较短的 WAV 或 MP3 音频。') from None
        except OSError:
            raise AudioError('音频转换组件无法运行，请检查后端安装。') from None
    pcm = decoded.stdout
    if decoded.returncode or not pcm or len(pcm) % 2:
        raise AudioError('无法解码音频，请检查文件是否损坏，或换用 WAV、MP3 格式。')
    duration = len(pcm) / (RATE * 2)
    # MediaRecorder stop events may trail the 60-second timer slightly.
    if duration > MAX_SECONDS + 0.25:
        raise AudioError('音频时长超过 60 秒，请截取较短片段后重试。')
    pcm = pcm[:MAX_SECONDS * RATE * 2]
    duration = len(pcm) / (RATE * 2)
    samples = array('h', pcm)
    if sys.byteorder != 'little': samples.byteswap()
    silent = max((abs(sample) for sample in samples), default=0) < 8
    output = io.BytesIO()
    with wave.open(output, 'wb') as target:
        target.setnchannels(1); target.setsampwidth(2); target.setframerate(RATE)
        target.writeframes(pcm)
    return NormalizedAudio(output.getvalue(), duration, silent)
