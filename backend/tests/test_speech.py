import base64
import io
import json
import math
import struct
import wave
from unittest.mock import patch

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.speech import SpeechService, install_speech
from backend.speech_audio import AudioError, ffmpeg_path, normalize_audio
from backend.speech_provider import SpeechProvider, SpeechProviderError


def wav(seconds=1, silent=False):
    stream = io.BytesIO()
    with wave.open(stream, 'wb') as audio:
        audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(16000)
        audio.writeframes(b''.join(struct.pack('<h', 0 if silent else int(8000*math.sin(i*0.09))) for i in range(int(16000*seconds))))
    return stream.getvalue()


class FakeProvider:
    ready = True
    model = 'qwen3-asr-flash'

    def __init__(self): self.calls = []
    def transcribe(self, audio, language):
        self.calls.append((audio, language))
        return '这是语音测试。'


def client_for(provider=None):
    app = FastAPI()
    service = SpeechService(provider or FakeProvider())
    install_speech(app, service)
    return TestClient(app), service


def test_real_decoder_wav_and_cleanup(tmp_path):
    with patch('backend.speech_audio.tempfile.tempdir', str(tmp_path)):
        audio = normalize_audio(wav())
    assert audio.duration == pytest.approx(1, abs=.01)
    assert audio.silent is False
    assert list(tmp_path.iterdir()) == []
    with wave.open(io.BytesIO(audio.wav)) as result:
        assert result.getframerate() == 16000
        assert result.getnchannels() == 1


@pytest.mark.parametrize('data', [b'', b'not an audio file', b'#EXTM3U\nhttps://example.com/private.wav'])
def test_invalid_audio_rejected(data):
    with pytest.raises(AudioError): normalize_audio(data)


def test_long_audio_rejected():
    with pytest.raises(AudioError, match='60'): normalize_audio(wav(61))


@pytest.mark.parametrize('suffix,codec', [('mp3','libmp3lame'),('webm','libopus'),('ogg','libvorbis'),('m4a','aac')])
def test_real_audio_formats(tmp_path, suffix, codec):
    import subprocess
    import sys
    source = tmp_path / 'source.wav'
    destination = tmp_path / ('encoded.'+suffix)
    source.write_bytes(wav())
    subprocess.run([ffmpeg_path(), '-hide_banner', '-loglevel', 'error', '-i', str(source), '-c:a', codec, str(destination)], check=True, timeout=15, capture_output=True,
                   creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
    converted = normalize_audio(destination.read_bytes())
    assert .9 < converted.duration < 1.2
    assert not converted.silent


def test_upload_round_trip():
    client, service = client_for()
    response = client.post('/api/speech/transcribe?language=zh', content=wav(), headers={'content-type': 'audio/wav'})
    assert response.status_code == 200
    assert response.json()['text'] == '这是语音测试。'
    assert response.json()['durationSeconds'] == pytest.approx(1)
    assert response.headers['cache-control'] == 'no-store'
    assert service.provider.calls[0][1] == 'zh'


def test_silence_does_not_call_paid_provider():
    client, service = client_for()
    response = client.post('/api/speech/transcribe', content=wav(silent=True), headers={'content-type': 'audio/wav'})
    assert response.status_code == 200
    assert response.json()['noSpeech'] is True
    assert service.provider.calls == []


@pytest.mark.parametrize('query,headers,body,code', [
    ('?language=yue', {'content-type':'audio/wav'}, b'x', 422),
    ('', {'content-type':'image/png'}, b'x', 415),
    ('', {'content-type':'audio/wav'}, b'', 422),
    ('', {'content-type':'audio/wav','content-length':'99999999'}, b'x', 413),
    ('', {'content-type':'audio/wav','content-length':'bad'}, b'x', 400),
    ('', {'content-type':'audio/wav','origin':'https://evil.test'}, b'x', 403),
])
def test_input_rejections(query, headers, body, code):
    client, service = client_for()
    assert client.post('/api/speech/transcribe'+query, headers=headers, content=body).status_code == code
    assert service.provider.calls == []


def test_status_missing_configuration_and_busy_lock():
    client, service = client_for()
    service.provider.ready = False
    assert client.get('/api/speech/status').json()['available'] is False
    assert client.post('/api/speech/transcribe', content=wav(), headers={'content-type':'audio/wav'}).status_code == 503
    service.provider.ready = True
    assert service.gate.acquire(blocking=False)
    try:
        assert client.post('/api/speech/transcribe', content=wav(), headers={'content-type':'audio/wav'}).status_code == 429
    finally: service.gate.release()


def test_failure_releases_slot():
    client, service = client_for()
    with patch.object(service.provider, 'transcribe', side_effect=SpeechProviderError(504, '识别超时')):
        assert client.post('/api/speech/transcribe', content=wav(), headers={'content-type':'audio/wav'}).status_code == 504
    assert client.post('/api/speech/transcribe', content=wav(), headers={'content-type':'audio/wav'}).status_code == 200


def test_rate_limit():
    client, service = client_for()
    service.max_per_minute = 1
    client.post('/api/speech/transcribe', content=b'broken', headers={'content-type':'audio/wav'})
    assert client.post('/api/speech/transcribe', content=b'broken', headers={'content-type':'audio/wav'}).status_code == 429


def test_provider_request_does_not_include_reference_text():
    requests = []
    def handle(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={'choices':[{'message':{'content':'你好'},'finish_reason':'stop'}]})
    provider = SpeechProvider(config={'DASHSCOPE_API_KEY':'test-only', 'AGENT_BASE_URL':'https://dashscope.aliyuncs.com/compatible-mode/v1'}, transport=httpx.MockTransport(handle))
    assert provider.transcribe(wav(), 'auto') == '你好'
    payload = requests[0]
    assert payload['model'] == 'qwen3-asr-flash'
    assert payload['asr_options'] == {'enable_itn':False}
    assert len(payload['messages']) == 1
    item = payload['messages'][0]['content'][0]
    assert item['type'] == 'input_audio'
    assert base64.b64decode(item['input_audio']['data'].split(',')[1]) == wav()


@pytest.mark.parametrize('status,expected', [(401,503),(403,503),(429,429),(500,502)])
def test_provider_errors_do_not_expose_upstream_secrets(status, expected):
    provider = SpeechProvider(config={'DASHSCOPE_API_KEY':'test-only'}, transport=httpx.MockTransport(lambda _: httpx.Response(status, text='sensitive upstream text')))
    with pytest.raises(SpeechProviderError) as error: provider.transcribe(wav(), 'en')
    assert error.value.status == expected
    assert 'sensitive' not in str(error.value)


def test_provider_rejects_bad_response_and_untrusted_endpoint():
    provider = SpeechProvider(config={'DASHSCOPE_API_KEY':'test-only'}, transport=httpx.MockTransport(lambda _: httpx.Response(200, json={'choices':[]})))
    with pytest.raises(SpeechProviderError): provider.transcribe(wav(), 'zh')
    assert not SpeechProvider(config={'DASHSCOPE_API_KEY':'test-only','SPEECH_BASE_URL':'https://evil.test/compatible-mode/v1'}).ready


def test_decoder_timeout_is_bounded():
    import subprocess
    with patch('backend.speech_audio.subprocess.run', side_effect=subprocess.TimeoutExpired('ffmpeg', 15)):
        with pytest.raises(AudioError, match='超时'): normalize_audio(wav())


def test_cancelling_http_request_keeps_slot_until_worker_finishes():
    import asyncio
    import threading
    entered = threading.Event()
    release = threading.Event()
    class SlowProvider(FakeProvider):
        def transcribe(self, audio, language):
            entered.set()
            assert release.wait(5)
            return 'done'
    async def scenario():
        app = FastAPI()
        service = SpeechService(SlowProvider())
        install_speech(app, service)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://testserver') as client:
            first = asyncio.create_task(client.post('/api/speech/transcribe', content=wav(), headers={'content-type':'audio/wav'}))
            try:
                for _ in range(200):
                    if entered.is_set(): break
                    await asyncio.sleep(.01)
                assert entered.is_set()
                first.cancel()
                with pytest.raises(asyncio.CancelledError): await first
                second = await client.post('/api/speech/transcribe', content=wav(), headers={'content-type':'audio/wav'})
                assert second.status_code == 429
            finally:
                release.set()
            for _ in range(200):
                if not service.gate.locked(): break
                await asyncio.sleep(.01)
            assert not service.gate.locked()
    asyncio.run(scenario())
