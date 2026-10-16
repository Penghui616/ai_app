from copy import deepcopy
import json
import pytest
from backend.agent_tools import execute_tool, run_summary
from backend.agent_advice import ground_model_test_advice
from backend.agent_tools import experiment_state
from backend.tests.test_agent import env, thread, ask, make_run, tool


def sample_run(rid='a'):
    r = make_run(rid)
    r.update(backbone='mobilenet-v3-test', params={'learningRate':.001,'optimizer':'SGD','epochs':4,'imageSize':224,'batchSize':16},
             metrics=[dict(epoch=i+1,trainLoss=.4/(i+1),valLoss=v,accuracy=a)
                      for i,(v,a) in enumerate(zip([.5,.2,.9,.1],[1.,1.,.6,1.]))])
    return r


def test_numbered_misclassification_question_does_not_prefetch_before_clarification(env):
    c,provider,training,agent,p=env
    r=sample_run();r.update(projectId=p['id'],revision=p['revision'])
    training.store.save_run(r)
    provider.responses=[{'content':'你刚才测试的内容实际是什么类别？'}]
    t=thread(c,p['id'])
    reply=ask(c,p['id'],t['id'],question='第1次实验的输出结果是错的，请分析一下。').json()['reply']
    assert reply['evidence']==[]
    assert provider.calls==[]


def test_complete_misclassification_feedback_can_query_training_evidence(env):
    c,provider,training,agent,p=env
    r=sample_run();r.update(projectId=p['id'],revision=p['revision'])
    training.store.save_run(r)
    provider.responses=[tool('get_training_details',{'run_number':1}),{'content':'根据你反馈的实际类别和预测结果，我们再做对照验证。'}]
    t=thread(c,p['id'])
    reply=ask(c,p['id'],t['id'],question='第1次实验里实际是猫，却识别成狗了，为什么？').json()['reply']
    assert len(reply['evidence'])==1 and reply['evidence'][0]['ok']
    assert reply['evidence'][0]['result']['id']==r['id']


def test_camera_history_is_not_a_frame_match():
    p=dict(name='测试',revision=1,classes=[],runs=[sample_run()],
           predictions=[dict(runId='a',createdAt='2026-01-01',scores=[])])
    result=execute_tool('get_test_records',{},p,{})
    assert result['reportedIncidentMatched'] is False
    assert result['cameraFramesIncluded'] is False
    assert result['accuracyAvailable'] is False


@pytest.mark.parametrize('counts,total,equal,ratio',[
    ([0,0],0,None,None), ([10,10],20,True,1.0),
    ([5,50],55,False,10.0), ([0,10],10,False,None),
])
def test_sample_distribution_is_counted_without_quality_claims(counts,total,equal,ratio):
    p=dict(name='样本',revision=1,runs=[],predictions=[],
           classes=[dict(name=str(i),samples=[{}]*count) for i,count in enumerate(counts)])
    state=experiment_state(p,{})
    stats=state['sampleDistribution']
    assert stats['totalSamples']==total
    assert stats['countsEqual'] is equal
    assert stats['maxToMinRatio']==ratio
    assert [c['count'] for c in state['classes']]==counts
    assert state['constraints']['minPerClass']==5


def test_sample_question_has_fresh_counts_even_when_model_does_not_call_tools(env):
    from backend.training_store import ProjectRow
    c,provider,training,agent,p=env
    with training.store.session() as session:
        owner=session.get(ProjectRow,p['id']).owner
    for category,count in zip(p['classes'],[5,50]):
        category['samples']=[{'id':f"{category['id']}-{i}",'dataUrl':'DO_NOT_SEND_IMAGE'} for i in range(count)]
    training.store.save(owner,p)
    t=thread(c,p['id'])
    for count in (5,10):
        p['classes'][0]['samples']=p['classes'][0]['samples']+[{'id':str(i)} for i in range(count-len(p['classes'][0]['samples']))]
        p['revision']+=1
        training.store.save(owner,p)
        assert ask(c,p['id'],t['id'],question='帮我检查样本分布，并说明下一步怎么做。',mode='advanced').status_code==200
        context=json.loads(provider.calls[-1]['messages'][1]['content'].split('\n',1)[1])
        state=context['experimentState']
        assert state['sampleDistribution']['totalSamples']==count+50
        assert state['revision']==p['revision']
        assert 'DO_NOT_SEND_IMAGE' not in json.dumps(provider.calls[-1])
    assert len(provider.calls)==2


def test_final_minimum_does_not_hide_intermediate_rebound():
    r = sample_run()
    s = run_summary(r)
    assert s['curveIncluded'] is False
    assert s['curveStats']['validationLossIncreaseSteps'] == 1
    assert s['curveStats']['maxValidationLossRebound'] == pytest.approx(.7)
    assert s['curveStats']['minAccuracy'] == .6
    assert s['curveStats']['allEpochsFullAccuracy'] is False
    assert s['curveStats']['minAccuracyFirstEpoch'] == 3
    assert '60%至100%' in s['curveStats']['facts'][0]
    assert '并非全程100%' in s['curveStats']['facts'][0]
    detail=execute_tool('get_training_details',{'run_id':'a','include_curve':True},{'runs':[r]}, {})
    assert detail['curveIncluded'] is True
    assert detail['curve'] == r['metrics']


def test_empty_curve_does_not_claim_stability():
    r=sample_run();r['metrics']=[]
    s=run_summary(r)
    assert s['curveStats'] is None
    assert s['curveIncluded'] is False


def test_monotonic_curve_statistics_and_first_full_accuracy():
    r=sample_run()
    for i,m in enumerate(r['metrics']):
        m.update(valLoss=.4/(i+1),accuracy=.75 if i<2 else 1.)
    s=run_summary(r)['curveStats']
    assert s['maxValidationLossRebound']==0
    assert s['validationLossIncreaseSteps']==0
    assert s['firstFullAccuracyEpoch']==3
    assert s['lastRecordedEpoch']==4


def test_string_run_number_is_narrowly_normalized_without_mutation():
    args={'run_number':'1','include_curve':True}
    result=execute_tool('get_training_details',args,{'runs':[sample_run()]},{})
    assert result['id']=='a' and result['curveIncluded']
    assert args['run_number']=='1'


@pytest.mark.parametrize('number',[True,1.0,'1.0','-1','0',' 1','1e0','第1次','1;DROP TABLE x','9'*100])
def test_invalid_number_forms_remain_rejected(number):
    with pytest.raises(ValueError):
        execute_tool('get_training_details',{'run_number':number},{'runs':[sample_run()]},{})


def test_normalization_does_not_relax_other_fields_or_project_scope():
    with pytest.raises(ValueError):
        execute_tool('get_training_details',{'run_number':'1','include_curve':'true'},{'runs':[sample_run()]},{})
    with pytest.raises(ValueError):
        execute_tool('get_training_details',{'run_number':'1','run_id':'a'},{'runs':[sample_run()]},{})
    with pytest.raises(ValueError):
        execute_tool('get_training_details',{'run_number':'1'},{'runs':[]},{})


def test_same_counts_do_not_imply_same_split():
    a=sample_run('a');b=deepcopy(a);b['id']='b'
    b['params']['learningRate']=.1
    b['validationSampleIds']=['other-validation']
    result=execute_tool('compare_training_runs',{'first_run_id':'a','second_run_id':'b'},{'runs':[a,b]},{})
    assert result['sameSplit'] is False
    assert result['attributionAllowed'] is False
    assert '实际样本划分不同' in result['controlVerdict']


def test_missing_metadata_is_unknown_and_asymmetric_parameters_are_compared():
    a=sample_run('a');b=sample_run('b')
    for r in (a,b):
        r.pop('trainSampleIds');r.pop('validationSampleIds');r.pop('seed');r.pop('backbone')
    a['params']['extraParam']=.5
    result=execute_tool('compare_training_runs',{'first_run_id':'a','second_run_id':'b'},{'runs':[a,b]},{})
    assert result['sameSplit'] is None
    assert result['sameSeed'] is None and result['sameBackbone'] is None
    assert result['parameterChanges']['extraParam']==[.5,None]
    assert result['attributionAllowed'] is False


def test_single_parameter_attribution_requires_verified_controls():
    a=sample_run('a');b=sample_run('b');b['params']['learningRate']=.1
    def compare():
        return execute_tool('compare_training_runs',{'first_run_id':'a','second_run_id':'b'},{'runs':[a,b]},{})
    assert compare()['attributionAllowed'] is True
    b['seed']=99
    assert compare()['attributionAllowed'] is False
    b['seed']=a['seed'];b['params']['epochs']=5
    assert compare()['attributionAllowed'] is False


def test_matching_but_incomplete_parameters_do_not_allow_attribution():
    a=sample_run('a');b=sample_run('b');b['params']['learningRate']=.1
    for r in (a,b):
        r['params'].pop('batchSize')
    result=execute_tool('compare_training_runs',{'first_run_id':'a','second_run_id':'b'},{'runs':[a,b]},{})
    assert result['attributionAllowed'] is False


def test_product_limits_and_active_prediction_model_are_in_context(env):
    c,provider,training,agent,p=env
    first=sample_run('00000000-0000-0000-0000-000000000001')
    last=sample_run('00000000-0000-0000-0000-000000000002')
    for i,r in enumerate([first,last]):
        r.update(projectId=p['id'],revision=p['revision'],startedAt=f'2026-01-01T00:0{i}:00+00:00')
        training.store.save_run(r)
    t=thread(c,p['id'])
    result=ask(c,p['id'],t['id'],question='我能取回第2轮权重吗',runId=first['id'])
    assert result.status_code==200
    context=json.loads(provider.calls[0]['messages'][1]['content'].split('\n',1)[1])
    capabilities=context['productCapabilities']
    assert capabilities['intermediateCheckpoints'] is False
    assert capabilities['earlyStoppingSetting'] is False
    assert capabilities['regularizationSetting'] is False
    assert capabilities['historicalModelSwitch'] is False
    assert context['predictionModel']['runId']==last['id']
    assert context['predictionModel']['runNumber']==2
    assert context['selectedRunId']==first['id']


def test_realistic_string_tool_call_succeeds_without_error_retry(env):
    c,provider,training,agent,p=env
    r=sample_run();r.update(projectId=p['id'],revision=p['revision'])
    training.store.save_run(r)
    provider.responses=[tool('get_training_details',{'run_number':'1','include_curve':True}),{'content':'中途发生反弹。'}]
    t=thread(c,p['id'])
    reply=ask(c,p['id'],t['id'],question='帮我看看曲线').json()['reply']
    assert reply['evidence'][0]['ok']
    assert len(provider.calls)==2


@pytest.mark.parametrize('text',[
    '建议分别校验当前最新模型（第6次）和第5次模型的识别效果。',
    '可以使用第五次的模型识别新图。',
    '请切换历史模型进行测试。',
    '可以用新图片分别校验这两个模型的实际识别效果。',
    '下一步建议：用新图片分别校验两个模型的识别效果。',
])
def test_historical_prediction_instructions_are_corrected(text):
    result,changed=ground_model_test_advice(text,6)
    assert changed
    assert '不能切换历史模型' in result
    assert '分别重新训练' in result


@pytest.mark.parametrize('text',[
    '不能切换第五次模型进行测试。',
    '建议使用第六次模型测试新图。',
    '第五次模型的验证损失为0.54；建议测试新图。',
    '请参考第五次模型的参数重新训练，再测试新图片。',
    '未来可以支持切换历史模型测试。',
    '请分别重新训练后测试这两个模型。',
    '可以分别测试两个模型。需分别重新训练对应参数，完成一次就用同一组新图校验一次。',
])
def test_capability_guard_preserves_valid_analysis_and_operations(text):
    assert ground_model_test_advice(text,6)==(text,False)


def test_guard_corrects_live_failure_without_extra_model_call(env):
    c,provider,training,agent,p=env
    r=sample_run();r.update(projectId=p['id'],revision=p['revision'])
    training.store.save_run(r)
    provider.responses=[{'content':'当前验证损失为0.1。建议切换历史模型测试。'}]
    t=thread(c,p['id'])
    reply=ask(c,p['id'],t['id'],question='怎么测试').json()['reply']
    assert reply['guidanceAdjusted'] is True
    assert '当前验证损失为0.1' in reply['text']
    assert '不能切换历史模型' in reply['text']
    assert len(provider.calls)==1
