"""Short text to WAV endpoint. All synthesis is in memory, independent of MySQL."""
import asyncio
from collections import deque
import json
import time
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import ValidationError

from backend.tts_provider import SynthesisInput, TtsError, TtsProvider, VOICES


class TtsService:
    def __init__(self, provider=None):
        self.provider = provider if provider is not None else TtsProvider()
        self.busy = False
        self.recent: deque[float] = deque()
        self.tasks: set[asyncio.Task] = set()
        self.max_per_minute = 10

    def status(self) -> dict:
        return dict(available=self.provider.ready, busy=self.busy, model=self.provider.model,
                    voices=list(VOICES), maxCharacters=100,
                    message='语音合成服务已配置。' if self.provider.ready else '请配置中国内地百炼 API Key 后重启后端。')

    async def work(self, settings: SynthesisInput) -> bytes:
        try:
            return await self.provider.synthesize(settings)
        finally:
            self.busy = False

    def finished(self, task: asyncio.Task) -> None:
        self.tasks.discard(task)
        if not task.cancelled():
            task.exception()  # Consume detached errors after client cancellation.


def install_tts(app: FastAPI, service: TtsService | None = None) -> None:
    engine = service if service is not None else TtsService()
    app.state.tts = engine

    @app.get('/api/tts/status')
    async def status():
        return JSONResponse(engine.status(), headers={'Cache-Control': 'no-store'})

    @app.post('/api/tts/synthesize')
    async def synthesize(request: Request):
        origin = request.headers.get('origin')
        if origin and urlparse(origin).hostname != request.url.hostname:
            raise HTTPException(403, '请从本平台页面提交合成请求。')
        if request.headers.get('content-type', '').split(';')[0] != 'application/json':
            raise HTTPException(415, '请提交 JSON 格式的合成设置。')
        async def read_body() -> bytes:
            body = bytearray()
            async for chunk in request.stream():
                if len(body) + len(chunk) > 4096:
                    raise HTTPException(413, '合成请求过大，文字最多 100 字。')
                body.extend(chunk)
            return bytes(body)
        try:
            body = await asyncio.wait_for(read_body(), timeout=10)
            settings = SynthesisInput.model_validate(json.loads(body))
        except TimeoutError:
            raise HTTPException(408, '请求上传超时，请重试。') from None
        except (ValidationError, ValueError, UnicodeError):
            raise HTTPException(422, '请检查文字（1–100 字）、音色、语速及音调（0.5–2.0）、音量（0–100）。') from None
        if not engine.provider.ready:
            raise HTTPException(503, engine.status()['message'])
        if engine.busy:
            raise HTTPException(429, '正在合成其他语音，请稍后重试。', headers={'Retry-After': '2'})
        now = time.monotonic()
        while engine.recent and now - engine.recent[0] >= 60:
            engine.recent.popleft()
        if len(engine.recent) >= engine.max_per_minute:
            raise HTTPException(429, '合成请求过于频繁，请一分钟后再试。', headers={'Retry-After': '60'})
        engine.busy = True
        engine.recent.append(now)
        task = asyncio.create_task(engine.work(settings))
        engine.tasks.add(task)
        task.add_done_callback(engine.finished)
        try:
            # Keep the slot until the paid upstream request actually exits.
            audio = await asyncio.shield(task)
        except TtsError as error:
            raise HTTPException(error.status, str(error)) from None
        return Response(audio, media_type='audio/wav', headers={
            'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="speech.wav"',
            'X-Content-Type-Options': 'nosniff',
        })
