"""Regression tests use the existing isolated SQLite fixture and fake provider."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4
import json
import pytest
from backend.tests.test_agent import env, thread, ask, make_run
from backend.agent_context import prepare_numbered_query
from backend.agent_tools import execute_tool, training_index


def seed_runs(training, p, count=15):
    ids = []
    for n in range(1, count+1):
        r = make_run(str(uuid4()), revision=p['revision'])
        r.update(projectId=p['id'], startedAt=(datetime(2026,1,1,tzinfo=timezone.utc)+timedelta(minutes=n)).isoformat(),
                 params={'learningRate':.1 if n==4 else .001, 'optimizer':'SGD', 'epochs':3, 'batchSize':16},
                 metrics=[dict(epoch=e, trainLoss=n/(e+1), valLoss=n/(e+2), accuracy=e/3) for e in range(1,4)])
        training.store.save_run(r)
        ids.append(r['id'])
    return ids


@pytest.mark.parametrize('question',['分析一下第五次实验的曲线图','分析第5次的曲线','看看第５次训练的收敛情况'])
def test_numbered_curve_is_prefetched_without_model_tool_decision(env, question):
    c, provider, training, agent, p=env
    ids=seed_runs(training,p); t=thread(c,p['id'])
    r=ask(c,p['id'],t['id'],question=question,runId=ids[-1])
    assert r.status_code==200,r.text
    e=r.json()['reply']['evidence'][0]
    assert e['tool']=='get_training_details' and e['ok']
    assert e['result']['id']==ids[4] and e['result']['runNumber']==5
    assert len(e['result']['curve'])==3 and e['result']['curve'][0]['valLoss']==5/3
    assert len(provider.calls)==1
    context=json.loads(provider.calls[0]['messages'][1]['content'].split('\n',1)[1])
    index=context['trainingIndex']
    assert index['runs'][0]['runNumber']==15
    assert all('metrics' not in row and 'final' not in row for row in index['runs'])


def test_bare_number_continues_curve_question_and_old_record_is_resolvable(env):
    c,provider,training,agent,p=env;ids=seed_runs(training,p,25);t=thread(c,p['id'])
    ask(c,p['id'],t['id'],question='分析第五次实验曲线')
    r=ask(c,p['id'],t['id'],question='第5次')
    assert r.json()['reply']['evidence'][0]['result']['id']==ids[4]
    assert 'curve' in r.json()['reply']['evidence'][0]['result']
    context=json.loads(provider.calls[-1]['messages'][1]['content'].split('\n',1)[1])
    assert any(row['runNumber']==5 for row in context['trainingIndex']['runs'])


def test_missing_ordinal_never_falls_back_to_current_run(env):
    c,provider,training,agent,p=env;ids=seed_runs(training,p,2);t=thread(c,p['id'])
    r=ask(c,p['id'],t['id'],question='分析第5次实验曲线',runId=ids[-1])
    evidence=r.json()['reply']['evidence'][0]
    assert not evidence['ok']
    assert evidence['result']['totalRuns']==2 and evidence['result']['requestedRunNumber']==5
    assert 'curve' not in evidence['result']


def test_index_pagination_and_number_details_are_consistent(env):
    c,provider,training,agent,p=env;ids=seed_runs(training,p,25)
    # API snapshot includes the same sorted run list used by the assistant.
    snapshot=c.get(f"/api/v1/projects/{p['id']}").json()
    page=execute_tool('list_training_runs',{'limit':5,'offset':20},snapshot,{})
    assert [r['runNumber'] for r in page['runs']]==[5,4,3,2,1]
    assert page['nextOffset'] is None
    detail=execute_tool('get_training_details',{'run_number':5,'include_curve':True},snapshot,{})
    assert detail['id']==ids[4]
    with pytest.raises(ValueError):execute_tool('get_training_details',{'run_number':5,'run_id':ids[4]},snapshot,{})
    # A different project's fifth record must never be used to satisfy a missing number.
    other=c.post('/api/v1/projects',json={'name':'other'}).json()
    with pytest.raises(ValueError):execute_tool('get_training_details',{'run_number':5},other,{})


def test_explicit_pair_prefetches_comparison(env):
    c,provider,training,agent,p=env;ids=seed_runs(training,p,5);t=thread(c,p['id'])
    reply=ask(c,p['id'],t['id'],question='对比第二次和第四次实验').json()['reply']
    e=reply['evidence'][0]
    assert e['tool']=='compare_training_runs'
    assert e['result']['first']['id']==ids[1] and e['result']['second']['id']==ids[3]
    assert e['result']['parameterChanges']['learningRate']==[.001,.1]


@pytest.mark.parametrize('question',['第五轮训练的损失是什么意思','不要分析第五次实验曲线','为什么之前没有分析第5次曲线','分析列表里第5次实验'])
def test_ambiguous_or_meta_questions_are_not_force_routed(question):
    fixed,_=prepare_numbered_query(question,[],{'runs':[]},None)
    assert fixed==[]


def test_parameter_correction_continues_current_comparison(env):
    c,provider,training,agent,p=env;ids=seed_runs(training,p,5);t=thread(c,p['id'])
    ask(c,p['id'],t['id'],question='学习率0.1和0.001哪个好',runId=ids[3])
    reply=ask(c,p['id'],t['id'],question='第三次用的也是SGD',runId=ids[3]).json()['reply']
    e=reply['evidence'][0]
    assert e['tool']=='compare_training_runs'
    assert e['result']['first']['id']==ids[3] and e['result']['second']['id']==ids[2]


def test_repeated_bare_number_retains_curve_intent(env):
    c,provider,training,agent,p=env;ids=seed_runs(training,p,5);t=thread(c,p['id'])
    for question in ['分析第五次曲线','第5次','第五次']:
        result=ask(c,p['id'],t['id'],question=question).json()['reply']
        assert result['evidence'][0]['result']['id']==ids[4]
        assert 'curve' in result['evidence'][0]['result']
