"""Bounded Qwen Realtime synthesis; no database, logging, retries or URL downloads."""
import asyncio
import base64
import binascii
import io
import json
import os
from pathlib import Path
from typing import Literal, Mapping
from uuid import uuid4
import wave

from dotenv import dotenv_values
from pydantic import BaseModel, ConfigDict, Field, field_validator
from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus, WebSocketException

VOICES = ('Cherry', 'Serena', 'Ethan', 'Neil', 'Jennifer', 'Aiden')
RATE = 24000
MAX_PCM = RATE * 2 * 120
TIMEOUT = 75
ENDPOINT = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime'


class SynthesisInput(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False)
    text: str = Field(min_length=1, max_length=100)
    voice: Literal['Cherry', 'Serena', 'Ethan', 'Neil', 'Jennifer', 'Aiden'] = 'Cherry'
    speed: float = Field(default=1, ge=.5, le=2)
    pitch: float = Field(default=1, ge=.5, le=2)
    volume: int = Field(default=75, ge=0, le=100)

    @field_validator('text')
    @classmethod
    def validate_text(cls, value: str) -> str:
        if not value.strip() or any(0xD800 <= ord(c) <= 0xDFFF or (ord(c) < 32 and c not in '\n\r\t') for c in value):
            raise ValueError('请输入有效文字。')
        return value.strip()


class TtsError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class TtsProvider:
    model = 'qwen3-tts-flash-realtime'

    def __init__(self, config: Mapping[str, str | None] | None = None, connector=None):
        if config is None:
            config = {**dotenv_values(Path(__file__).parent / '.env.agent', interpolate=False), **os.environ}
        self.key = config.get('TTS_API_KEY') or config.get('SPEECH_API_KEY') or config.get('DASHSCOPE_API_KEY') or ''
        self.ready = bool(self.key.strip())
        self.connector = connector or connect

    async def synthesize(self, settings: SynthesisInput) -> bytes:
        if not self.ready:
            raise TtsError(503, '请配置中国内地百炼 API Key 后重启后端。')
        try:
            async with asyncio.timeout(TIMEOUT):
                async with self.connector(ENDPOINT + '?model=' + self.model,
                        additional_headers={'Authorization': 'Bearer ' + self.key},
                        open_timeout=10, close_timeout=3, max_size=2_000_000, proxy=None) as ws:
                    async def send(kind: str, **data) -> None:
                        await ws.send(json.dumps({'event_id': str(uuid4()), 'type': kind, **data}, ensure_ascii=False))

                    async def receive() -> dict:
                        event = json.loads(await ws.recv())
                        if not isinstance(event, dict) or not isinstance(event.get('type'), str):
                            raise ValueError('invalid event')
                        if event['type'] == 'error':
                            # Upstream messages may contain submitted text or credentials.
                            code = str((event.get('error') or {}).get('code', '')).lower()
                            if any(s in code for s in ('rate', 'quota', 'limit')):
                                raise TtsError(429, '百炼合成额度或频率受限，请稍后重试并检查账户。')
                            raise TtsError(502, '百炼未能完成合成，请检查模型权限、额度或更换文字后重试。')
                        return event

                    if (await receive())['type'] != 'session.created':
                        raise ValueError('missing session')
                    await send('session.update', session={
                        'voice': settings.voice, 'mode': 'server_commit', 'language_type': 'Auto',
                        'response_format': 'pcm', 'sample_rate': RATE,
                        'speech_rate': settings.speed, 'pitch_rate': settings.pitch, 'volume': settings.volume,
                    })
                    event = await receive()
                    if event['type'] != 'session.updated':
                        raise ValueError('missing acknowledgement')
                    session = event.get('session', {})
                    if session.get('sample_rate') != RATE or session.get('response_format') != 'pcm' or session.get('voice') != settings.voice:
                        raise ValueError('unexpected output format')
                    await send('input_text_buffer.append', text=settings.text)
                    await send('session.finish')
                    pcm = bytearray()
                    completed = False
                    for _ in range(5000):
                        event = await receive()
                        kind = event['type']
                        if kind == 'response.audio.delta':
                            chunk = base64.b64decode(event['delta'], validate=True)
                            if len(pcm) + len(chunk) > MAX_PCM:
                                raise TtsError(502, '合成音频超过长度限制，请缩短文字。')
                            pcm.extend(chunk)
                        elif kind == 'response.done':
                            if event.get('response', {}).get('status') != 'completed':
                                raise ValueError('incomplete response')
                            completed = True
                        elif kind == 'session.finished':
                            if not completed or not pcm or len(pcm) % 2:
                                raise ValueError('incomplete audio')
                            buffer = io.BytesIO()
                            with wave.open(buffer, 'wb') as audio:
                                audio.setnchannels(1)
                                audio.setsampwidth(2)
                                audio.setframerate(RATE)
                                audio.writeframes(bytes(pcm))
                            return buffer.getvalue()
                    raise ValueError('too many events')
        except TtsError:
            raise
        except TimeoutError:
            raise TtsError(504, '语音合成超时，请稍后重试。') from None
        except InvalidStatus as error:
            if error.response.status_code in (401, 403):
                raise TtsError(503, '百炼鉴权失败，请检查中国内地密钥及模型权限。') from None
            if error.response.status_code == 429:
                raise TtsError(429, '百炼调用受限，请检查额度并稍后重试。') from None
            raise TtsError(502, '无法建立百炼合成连接，请检查模型服务。') from None
        except (WebSocketException, OSError):
            raise TtsError(502, '合成连接中断，请检查后端网络后重试。') from None
        except (ValueError, KeyError, TypeError, AttributeError, binascii.Error):
            raise TtsError(502, '百炼返回的音频不完整或格式异常，请重新合成。') from None
