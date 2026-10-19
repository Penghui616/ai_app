import asyncio
import base64
import io
import json
import wave
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
import httpx
import pytest

from backend.tts import TtsService, install_tts
from backend.tts_provider import SynthesisInput, TtsError, TtsProvider


class Socket:
    def __init__(self, events): self.events = iter(events); self.sent = []; self.closed = False
    async def __aenter__(self): return self
    async def __aexit__(self, *args): self.closed = True
    async def send(self, value): self.sent.append(json.loads(value))
    async def recv(self):
        item = next(self.events)
        if isinstance(item, Exception): raise item
        return json.dumps(item)


def events(voice='Cherry'):
    return [
        {'type': 'session.created'},
        {'type': 'session.updated', 'session': {'voice': voice, 'response_format': 'pcm', 'sample_rate': 24000}},
        {'type': 'response.audio.delta', 'delta': base64.b64encode(b'\x01\x00' * 2400).decode()},
        {'type': 'response.done', 'response': {'status': 'completed'}},
        {'type': 'session.finished'},
    ]


def provider_for(items):
    socket = Socket(items)
    def connector(url, **kwargs):
        assert url == 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-tts-flash-realtime'
        assert kwargs['additional_headers']['Authorization'] == 'Bearer test-only'
        return socket
    return TtsProvider({'TTS_API_KEY': 'test-only'}, connector), socket


def test_parameters_protocol_and_valid_wav():
    provider, socket = provider_for(events('Neil'))
    audio = asyncio.run(provider.synthesize(SynthesisInput(text='测试。', voice='Neil', speed=1.5, pitch=.7, volume=30)))
    with wave.open(io.BytesIO(audio)) as wav:
        assert (wav.getframerate(), wav.getnchannels(), wav.getsampwidth(), wav.getnframes()) == (24000, 1, 2, 2400)
    session = socket.sent[0]['session']
    assert (session['voice'], session['speech_rate'], session['pitch_rate'], session['volume']) == ('Neil', 1.5, .7, 30)
    assert [e['type'] for e in socket.sent] == ['session.update', 'input_text_buffer.append', 'session.finish']
    assert socket.sent[1]['text'] == '测试。' and socket.closed
    assert len({e['event_id'] for e in socket.sent}) == 3


@pytest.mark.parametrize('case', ['invalid_base64', 'failed', 'empty', 'odd', 'wrong_format', 'error', 'too_large', 'timeout'])
def test_incomplete_or_failed_audio_never_returned(case):
    items = events()
    if case == 'invalid_base64': items[2]['delta'] = '!bad!'
    if case == 'failed': items[3]['response']['status'] = 'failed'
    if case == 'empty': items.pop(2)
    if case == 'odd': items[2]['delta'] = 'AQ=='
    if case == 'wrong_format': items[1]['session']['sample_rate'] = 16000
    if case == 'error': items[2] = {'type': 'error', 'error': {'code': 'bad', 'message': 'SECRET private text'}}
    if case == 'timeout': items[2] = TimeoutError('SECRET')
    provider, socket = provider_for(items)
    with patch('backend.tts_provider.MAX_PCM', 20 if case == 'too_large' else 5_760_000):
        with pytest.raises(TtsError) as failure:
            asyncio.run(provider.synthesize(SynthesisInput(text='测试')))
    assert 'SECRET' not in str(failure.value) and socket.closed


@pytest.mark.parametrize('voice', ['Cherry','Serena','Ethan','Neil','Jennifer','Aiden'])
def test_six_voices(voice):
    provider, _ = provider_for(events(voice))
    assert asyncio.run(provider.synthesize(SynthesisInput(text='你好', voice=voice))).startswith(b'RIFF')


def client_for(items=None):
    provider, socket = provider_for(items if items is not None else events())
    service = TtsService(provider)
    app = FastAPI(); install_tts(app, service)
    return TestClient(app), service, socket, app


def test_api_and_private_status():
    client, service, _, _ = client_for()
    status = client.get('/api/tts/status')
    assert status.json()['available'] and 'test-only' not in status.text
    response = client.post('/api/tts/synthesize', json={'text':'你好'})
    assert response.status_code == 200 and response.headers['content-type'] == 'audio/wav'
    assert response.headers['cache-control'] == 'no-store' and not service.busy
    assert 'attachment' in response.headers['content-disposition']


@pytest.mark.parametrize('fields', [
    {'text':''}, {'text':'  '}, {'text':'字'*101}, {'text':'\ud800'}, {'text':12}, {'text':'a\x00'},
    {'voice':'unknown'}, {'speed':0}, {'speed':2.1}, {'speed':'1'}, {'speed':True},
    {'pitch':0}, {'pitch':float('inf')}, {'volume':-1}, {'volume':101}, {'volume':1.2}, {'extra':'value'},
])
def test_bad_inputs_rejected_before_upstream(fields):
    client, service, socket, _ = client_for()
    response = client.post('/api/tts/synthesize', content=json.dumps({'text':'测试', **fields}), headers={'Content-Type':'application/json'})
    assert response.status_code == 422
    assert not socket.sent and not service.busy and not service.recent


def test_body_limits_origin_and_rate():
    client, service, socket, _ = client_for()
    assert client.post('/api/tts/synthesize', content='a'*4097, headers={'Content-Type':'application/json'}).status_code == 413
    assert client.post('/api/tts/synthesize', content='{}').status_code == 415
    assert client.post('/api/tts/synthesize', json={'text':'a'}, headers={'Origin':'https://other.test'}).status_code == 403
    service.max_per_minute = 0
    assert client.post('/api/tts/synthesize', json={'text':'a'}).status_code == 429
    assert not service.busy and not socket.sent


def test_missing_key_and_provider_failure():
    client, service, _, _ = client_for([{'type':'error','error':{'code':'rate_limit','message':'secret'}}])
    response = client.post('/api/tts/synthesize', json={'text':'你好'})
    assert response.status_code == 429 and 'secret' not in response.text and not service.busy
    service.provider.ready = False
    assert client.post('/api/tts/synthesize', json={'text':'你好'}).status_code == 503


def test_cancelled_request_holds_slot_until_worker_finishes():
    async def scenario():
        _, service, _, app = client_for()
        entered, release = asyncio.Event(), asyncio.Event()
        async def delayed(settings):
            entered.set(); await release.wait(); return b'RIFF-test'
        service.provider.synthesize = delayed
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            first = asyncio.create_task(client.post('/api/tts/synthesize', json={'text':'a'}))
            await entered.wait(); first.cancel()
            with pytest.raises(asyncio.CancelledError): await first
            assert service.busy
            assert (await client.post('/api/tts/synthesize', json={'text':'b'})).status_code == 429
            release.set()
            await asyncio.gather(*service.tasks)
            await asyncio.sleep(0)
            assert not service.busy and not service.tasks
    asyncio.run(scenario())
