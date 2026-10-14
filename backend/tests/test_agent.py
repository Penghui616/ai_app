import json
from copy import deepcopy
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from backend.app import create_app
from backend.training import TrainingService
from backend.training_store import Store, now
from backend.tests.test_api import StubClassifier
from backend.agent_tools import execute_tool, experiment_state
from backend.agent_provider import ProviderError, BailianProvider, valid_base


class FakeProvider:
    ready = True
    model = "qwen3.8-max"

    def __init__(self):
        self.calls = []
        self.responses = []
        self.before = None

    def complete(self, messages, tools, deadline):
        self.calls.append(deepcopy(dict(messages=messages, tools=tools)))
        if self.before:
            callback, self.before = self.before, None
            callback()
        item = self.responses.pop(0) if self.responses else {"content": "请先为两个类别分别添加不同图片，再开始训练。"}
        if isinstance(item, Exception):
            raise item
        return dict(message=item, usage=dict(prompt_tokens=100, completion_tokens=20, total_tokens=120))


@pytest.fixture
def env(tmp_path):
    training = TrainingService(Store("sqlite:///"+str(tmp_path/"agent.sqlite")), tmp_path/"data")
    provider = FakeProvider()
    app = create_app(StubClassifier(), training, provider)
    with TestClient(app) as client:
        p = client.post('/api/v1/projects', json={'name':'助手测试'}).json()
        yield client, provider, training, app.state.agent, p


def thread(client, pid, mode="basic"):
    r = client.post(f'/api/v1/projects/{pid}/assistant/threads', json={'mode':mode})
    assert r.status_code == 201, r.text
    return r.json()


def ask(client, pid, tid, **kwargs):
    return client.post(f'/api/v1/projects/{pid}/assistant/threads/{tid}/messages', json={
        'requestId':str(uuid4()), 'question':'下一步怎么做？', 'mode':'basic', **kwargs})


def tool(name, arguments):
    return {'content':None, 'tool_calls':[{'id':'call_1','type':'function','function':{'name':name,'arguments':json.dumps(arguments)}}]}


def test_fixed_next_and_mode_use_real_project_data(env):
    c, provider, training, agent, p = env
    t = thread(c, p['id'])
    r = ask(c, p['id'], t['id'], action='next', mode='advanced')
    assert r.status_code == 200, r.text
    reply = r.json()['reply']
    assert reply['mode']=='advanced'
    assert [x['tool'] for x in reply['evidence']]==['get_experiment_state','get_operation_guide']
    assert reply['evidence'][0]['result']['stage']=='needs_samples'
    assert '当前唯一讲解模式：进阶讲解' in provider.calls[0]['messages'][0]['content']
    assert 'dataUrl' not in json.dumps(provider.calls,ensure_ascii=False)
    assert 'fingerprint' not in json.dumps(provider.calls)
    assert reply['usage']['total_tokens']==120
    assert len(c.get(f"/api/v1/projects/{p['id']}/assistant/threads/{t['id']}").json()['messages'])==2


def test_free_tools_and_invalid_tool_arguments_cannot_mutate_project(env):
    c, provider, training, agent, p = env
    t = thread(c,p['id'])
    provider.responses=[tool('get_experiment_state',{'project_id':'someone-else'}),tool('delete_project',{}),{'content':'无法执行删除操作。'}]
    result=ask(c,p['id'],t['id'],question='查看状态并删除项目')
    assert result.status_code==200,result.text
    evidence=result.json()['reply']['evidence']
    assert all(not x['ok'] for x in evidence)
    assert c.get(f"/api/v1/projects/{p['id']}").status_code==200
    provider.responses=[tool('get_experiment_state',{}),{'content':'每个类别至少添加五张图片。'}]
    assert ask(c,p['id'],t['id']).json()['reply']['evidence'][0]['ok']


def test_ownership_and_cross_project_conversation(env):
    c, provider, training, agent, p = env
    t=thread(c,p['id'])
    other=c.post('/api/v1/projects',json={'name':'另一个项目'}).json()
    assert c.get(f"/api/v1/projects/{other['id']}/assistant/threads/{t['id']}").status_code==404
    c.cookies.clear()
    assert c.get(f"/api/v1/projects/{p['id']}/assistant").status_code==404
    assert ask(c,p['id'],t['id']).status_code==404
    assert not provider.calls


def test_unconfigured_provider_and_failure_keep_training_available(env):
    c, provider, training, agent, p = env
    t=thread(c,p['id']);provider.ready=False
    assert ask(c,p['id'],t['id']).status_code==503
    assert c.get('/api/health').status_code==200
    provider.ready=True;provider.responses=[ProviderError('上游暂不可用')]
    assert ask(c,p['id'],t['id']).status_code==502
    assert not c.get(f"/api/v1/projects/{p['id']}/assistant/threads/{t['id']}").json()['messages']
    assert c.patch(f"/api/v1/projects/{p['id']}",json={'name':'仍可修改'}).status_code==200


def test_notes_survive_new_thread_and_delete_cleans_owned_records(env):
    c, provider, training, agent, p = env
    base=f"/api/v1/projects/{p['id']}/assistant"
    note=c.post(base+'/notes',json={'kind':'feedback','text':'我看到比熊被识别成博美。'}).json()
    t=thread(c,p['id']);ask(c,p['id'],t['id'])
    c.delete(base+f"/threads/{t['id']}")
    assert len(c.get(base).json()['notes'])==1
    t2=thread(c,p['id']);ask(c,p['id'],t2['id'])
    assert 'unverified' in provider.calls[-1]['messages'][1]['content']
    assert '比熊' in provider.calls[-1]['messages'][1]['content']
    assert c.delete(f"/api/v1/projects/{p['id']}").status_code==200
    from backend.agent_store import ThreadRow,MemoryRow
    with training.store.session() as s:
        assert s.get(ThreadRow,t2['id']) is None
        assert s.get(MemoryRow,p['id']) is None


def test_idempotency_budget_and_summary(env):
    c,provider,training,agent,p=env;t=thread(c,p['id']);rid=str(uuid4())
    a=ask(c,p['id'],t['id'],requestId=rid);b=ask(c,p['id'],t['id'],requestId=rid)
    assert a.json()['reply']['id']==b.json()['reply']['id'] and len(provider.calls)==1
    provider.responses=[tool('get_experiment_state',{}) for _ in range(4)]
    r=ask(c,p['id'],t['id']);assert r.status_code==502
    assert len(provider.calls)==5
    assert provider.calls[-1]['tools']==[]
    agent.recent.clear()
    for i in range(7):
        assert ask(c,p['id'],t['id'],question=f'解释第{i}个术语').status_code==200
    saved=c.get(f"/api/v1/projects/{p['id']}/assistant/threads/{t['id']}").json()
    assert saved['historyDigest'] and len(saved['historyDigest'])<=2000
    assert len(provider.calls[-1]['messages'])<=15


def make_run(id,revision=1,accuracy=.9):
    return dict(id=id,status='completed',startedAt=now(),revision=revision,params={'learningRate':.001},seed=42,isMock=False,
                trainSampleIds=['t1','t2'],validationSampleIds=['v1'],metrics=[dict(epoch=1,trainLoss=.3,valLoss=.4,accuracy=accuracy)])


def test_tools_comparison_and_stale_camera_state():
    p=dict(name='测试',revision=1,classes=[dict(name='猫',samples=[{}]*5),dict(name='狗',samples=[{}]*5)],runs=[make_run('new'),make_run('old',0,.8)],predictions=[])
    assert experiment_state(p,{'testedRunId':'old'})['stage']=='ready_to_test'
    assert experiment_state(p,{'testedRunId':'new'})['stage']=='tested'
    result=execute_tool('compare_training_runs',{'first_run_id':'old','second_run_id':'new'},p,{})
    assert not result['comparable']
    assert result['secondMinusFirst']['accuracyPercentagePoints']==pytest.approx(10)
    assert not execute_tool('get_test_records',{},p,{})['accuracyAvailable']
    with pytest.raises(ValueError):execute_tool('get_training_details',{'run_id':'foreign'},p,{})
    p['revision']=2
    assert experiment_state(p,{'testedRunId':'new'})['stage']=='ready_to_train'


def test_context_revision_changed_during_reply(env):
    c,provider,training,agent,p=env;t=thread(c,p['id'])
    def change():
        c.patch(f"/api/v1/projects/{p['id']}/classes/{p['classes'][0]['id']}",json={'name':'新类别'})
    provider.before=change
    assert ask(c,p['id'],t['id']).json()['reply']['contextChanged'] is True


def test_provider_protocol_and_secret_error_redaction(monkeypatch):
    import httpx
    provider=BailianProvider();provider.key='TEST-SECRET';provider.ready=True;provider.base_url='https://dashscope.aliyuncs.com/compatible-mode/v1'
    def handler(request):
        body=json.loads(request.content)
        assert body['model']=='qwen3.8-max' and body['enable_thinking'] is False
        assert request.headers['authorization']=='Bearer TEST-SECRET'
        return httpx.Response(401,json={'error':'TEST-SECRET internal message'})
    original=httpx.Client
    monkeypatch.setattr(httpx,'Client',lambda **kw:original(transport=httpx.MockTransport(handler),**kw))
    import time
    with pytest.raises(ProviderError) as exc:provider.complete([{'role':'user','content':'你好'}],[],time.monotonic()+30)
    assert 'TEST-SECRET' not in str(exc.value)
    assert valid_base('https://abc.cn-beijing.maas.aliyuncs.com/compatible-mode/v1')
    assert not valid_base('https://evil.example/compatible-mode/v1')
    assert not valid_base('http://dashscope.aliyuncs.com/compatible-mode/v1')


def test_invalid_provider_url_is_not_a_startup_error():
    assert not valid_base("https://dashscope.aliyuncs.com:bad/compatible-mode/v1")
    assert not valid_base("https://[bad/compatible-mode/v1")
