"""Short-audio recognition endpoints, independent of project databases."""
import asyncio
from collections import deque
import threading
import time
from typing import Literal
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from backend.speech_audio import AudioError, MAX_BYTES, MAX_SECONDS, ffmpeg_path, normalize_audio
from backend.speech_provider import SpeechProvider, SpeechProviderError

TYPES = {'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mpeg', 'audio/mp3', 'audio/mp4',
         'audio/x-m4a', 'audio/m4a', 'audio/webm', 'audio/ogg', 'application/ogg',
         'video/webm', 'video/mp4', 'application/octet-stream'}


class SpeechService:
    def __init__(self, provider=None):
        self.provider = provider if provider is not None else SpeechProvider()
        self.gate = threading.Lock()
        self.recent: deque[float] = deque()
        self.max_per_minute = 10

    def status(self) -> dict:
        decoder_ready = bool(ffmpeg_path())
        available = self.provider.ready and decoder_ready
        return dict(available=available, model=self.provider.model, languages=['zh','en','auto'],
                    maxSeconds=MAX_SECONDS, maxBytes=MAX_BYTES, busy=self.gate.locked(),
                    message=('已配置百炼语音服务，识别时会上传音频。' if available else
                             '请配置百炼 API Key 与中国内地接口地址后重启后端。' if not self.provider.ready else
                             '音频转换组件未安装，请安装 backend/requirements-speech.txt 后重启后端。'))

    def recognize(self, content: bytes, language: Literal['auto', 'zh', 'en']) -> dict:
        start = time.monotonic()
        audio = normalize_audio(content)
        text = '' if audio.silent else self.provider.transcribe(audio.wav, language)
        return dict(text=text, durationSeconds=round(audio.duration, 3),
                    elapsedMs=round((time.monotonic()-start)*1000), model=self.provider.model,
                    noSpeech=not bool(text),
                    notice='未检测到有效声音，请检查录音音量后重试。' if audio.silent else
                           '未识别到文字，请检查是否包含清晰语音。' if not text else '')


def install_speech(app: FastAPI, service: SpeechService | None = None) -> None:
    engine = service if service is not None else SpeechService()
    app.state.speech = engine

    @app.get('/api/speech/status')
    async def status():
        return JSONResponse(engine.status(), headers={'Cache-Control':'no-store'})

    @app.post('/api/speech/transcribe')
    async def transcribe(request: Request, language: Literal['auto','zh','en'] = 'auto'):
        origin = request.headers.get('origin')
        if origin and urlparse(origin).hostname != request.url.hostname:
            raise HTTPException(403, '请从本平台页面提交识别请求。')
        media_type = request.headers.get('content-type', '').split(';')[0].strip().lower()
        if media_type not in TYPES:
            raise HTTPException(415, '请上传 WAV、MP3、M4A、OGG 或 WebM 音频。')
        try:
            length = int(request.headers.get('content-length', '0'))
            if length < 0: raise ValueError()
        except ValueError:
            raise HTTPException(400, '音频请求长度无效。') from None
        if length > MAX_BYTES: raise HTTPException(413, '音频文件不能超过 20 MB。')
        if not engine.status()['available']:
            raise HTTPException(503, engine.status()['message'])
        if not engine.gate.acquire(blocking=False):
            raise HTTPException(429, '正在识别其他音频，请稍后重试。', headers={'Retry-After':'2'})
        handed_to_worker = False
        try:
            now = time.monotonic()
            while engine.recent and now - engine.recent[0] >= 60: engine.recent.popleft()
            if len(engine.recent) >= engine.max_per_minute:
                raise HTTPException(429, '识别请求过于频繁，请一分钟后再试。', headers={'Retry-After':'60'})
            engine.recent.append(now)
            async def read_audio() -> bytes:
                content = bytearray()
                async for chunk in request.stream():
                    if len(content) + len(chunk) > MAX_BYTES:
                        raise HTTPException(413, '音频文件不能超过 20 MB。')
                    content.extend(chunk)
                return bytes(content)
            try:
                content = await asyncio.wait_for(read_audio(), timeout=15)
            except asyncio.TimeoutError:
                raise HTTPException(408, '音频上传超时，请检查网络后重试。') from None
            def work():
                try:
                    return engine.recognize(content, language)
                finally:
                    engine.gate.release()
            task = asyncio.create_task(run_in_threadpool(work))
            # A disconnected browser cannot cancel an upstream paid request.
            # Keep the slot until its worker really exits; consume detached errors.
            task.add_done_callback(lambda done: done.exception() if not done.cancelled() else None)
            handed_to_worker = True
            try:
                result = await asyncio.shield(task)
            except AudioError as error:
                raise HTTPException(422, str(error)) from None
            except SpeechProviderError as error:
                raise HTTPException(error.status, str(error)) from None
            return JSONResponse(result, headers={'Cache-Control':'no-store'})
        finally:
            if not handed_to_worker:
                engine.gate.release()
