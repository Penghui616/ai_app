"""Official mainland Bailian ASR adapter. Never logs credentials or audio."""
import base64
import os
from pathlib import Path
from typing import Mapping, Literal

import httpx
from dotenv import dotenv_values
from backend.agent_provider import valid_base

SpeechLanguage = Literal['auto', 'zh', 'en']


class SpeechProviderError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class SpeechProvider:
    model = 'qwen3-asr-flash'

    def __init__(self, config: Mapping[str, str | None] | None = None, transport: httpx.BaseTransport | None = None):
        if config is None:
            config = {**dotenv_values(Path(__file__).parent / '.env.agent', interpolate=False), **os.environ}
        self.key = config.get('SPEECH_API_KEY') or config.get('DASHSCOPE_API_KEY') or ''
        self.base_url = (config.get('SPEECH_BASE_URL') or config.get('AGENT_BASE_URL')
                         or 'https://dashscope.aliyuncs.com/compatible-mode/v1').rstrip('/')
        self.ready = bool(self.key and valid_base(self.base_url))
        self.transport = transport

    def transcribe(self, audio: bytes, language: SpeechLanguage) -> str:
        if not self.ready:
            raise SpeechProviderError(503, '百炼语音服务尚未配置，请配置 API Key 与中国内地接口地址后重启后端。')
        if language not in ('auto', 'zh', 'en'):
            raise SpeechProviderError(422, '请选择普通话、英语或自动识别。')
        data_uri = 'data:audio/wav;base64,' + base64.b64encode(audio).decode('ascii')
        if len(data_uri) > 10_000_000:
            raise SpeechProviderError(413, '转换后的音频超过百炼输入限制，请缩短音频。')
        options: dict[str, str | bool] = {'enable_itn': False}
        if language != 'auto': options['language'] = language
        payload = {
            'model': self.model, 'stream': False,
            'messages': [{'role': 'user', 'content': [{'type': 'input_audio', 'input_audio': {'data': data_uri}}]}],
            'asr_options': options,
        }
        try:
            # No automatic retry: avoid duplicate paid submissions on uncertain outcomes.
            with httpx.Client(timeout=httpx.Timeout(60, connect=10), follow_redirects=False, transport=self.transport) as client:
                response = client.post(self.base_url + '/chat/completions', json=payload,
                                       headers={'Authorization': 'Bearer ' + self.key})
        except httpx.TimeoutException:
            raise SpeechProviderError(504, '百炼语音识别超时，请稍后重试。') from None
        except httpx.HTTPError:
            raise SpeechProviderError(502, '无法连接百炼语音服务，请检查后端网络。') from None
        if response.status_code in (401, 403):
            raise SpeechProviderError(503, '百炼鉴权或模型授权失败，请检查 API Key、业务空间及语音模型权限。')
        if response.status_code == 429:
            raise SpeechProviderError(429, '百炼调用达到额度或频率限制，请稍后重试并检查账户额度。')
        if response.status_code >= 400:
            raise SpeechProviderError(502, f'百炼语音调用失败（HTTP {response.status_code}），请检查模型权限、配置及额度。')
        try:
            choice = response.json()['choices'][0]
            text = choice['message']['content']
            if not isinstance(text, str) or choice.get('finish_reason') not in (None, 'stop'):
                raise ValueError()
            return text.strip()
        except (KeyError, IndexError, TypeError, ValueError):
            raise SpeechProviderError(502, '百炼返回的识别结果不完整或格式异常，请重试。') from None
