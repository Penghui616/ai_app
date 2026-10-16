import json
import pytest
from backend.agent_feedback import prepare_feedback
from backend.tests.test_agent import env, thread, ask
from backend.tests.test_agent_numbering import seed_runs


def history(state):
    return [{'role':'assistant','studentFeedback':state}]


def test_explicit_pair_and_outside_label_are_preserved():
    result=prepare_feedback('上传的实际是猫，却识别成狗，为什么？',[],['猫','狗'])
    assert (result['actual'],result['predicted'],result['phase'])==('猫','狗','ready')
    result=prepare_feedback('我上传的是兔子，却识别成猫了，为什么？',[],['猫','狗'])
    assert (result['actual'],result['predicted'])==('兔子','猫')


@pytest.mark.parametrize('question',['这是比熊，识别成了博美。','这张照片是比熊，却预测为博美。'])
def test_this_is_label_does_not_trigger_repeated_question(question):
    result=prepare_feedback(question,[],['比熊','博美'])
    assert (result['actual'],result['predicted'],result['phase'])==('比熊','博美','ready')


def test_followups_keep_labels_but_new_image_resets_them():
    first=prepare_feedback('第4次实验的输出结果错了',[],['猫','狗'])
    assert first['phase']=='awaiting_actual'
    second=prepare_feedback('猫',history(first),['猫','狗'])
    assert second['phase']=='awaiting_prediction'
    third=prepare_feedback('它识别成狗了。',history(second),['猫','狗'])
    assert (third['actual'],third['predicted'],third['runNumber'])==('猫','狗',4)
    new=prepare_feedback('另外换了一张图片，又识别错了。',history(third),['猫','狗'])
    assert new['actual'] is None and new['predicted'] is None and new['runNumber'] is None
    same=prepare_feedback('同一张图片又识别错了',history(third),['猫','狗'])
    assert same['phase']=='ready'


@pytest.mark.parametrize('question',['批大小是什么','不要分析了','它识别正确了','先比较第二次和第四次'])
def test_unrelated_turn_does_not_force_error_diagnosis(question):
    previous=prepare_feedback('输出结果错了',[],['猫','狗'])
    assert prepare_feedback(question,history(previous),['猫','狗']) is None


def test_uncertain_labels_are_not_treated_as_ground_truth():
    result=prepare_feedback('实际是不确定的类别，但识别成猫，输出错了',[],['猫','狗'])
    assert result['actual'] is None
    assert result['source']=='student_reported_unverified'


def test_clarification_is_persisted_without_model_or_tools(env):
    c,provider,training,agent,p=env
    t=thread(c,p['id'])
    first=ask(c,p['id'],t['id'],question='为什么我的输出结果是错的？').json()['reply']
    assert first['studentFeedback']['phase']=='awaiting_actual'
    assert first['usage']['total_tokens']==0 and first['evidence']==[]
    assert provider.calls==[]
    second=ask(c,p['id'],t['id'],question='实际是猫。').json()['reply']
    assert second['studentFeedback']['actual']=='猫'
    assert second['studentFeedback']['phase']=='awaiting_prediction'
    assert provider.calls==[]


def test_complete_feedback_prefetches_current_model_not_selected_history(env):
    c,provider,training,agent,p=env
    ids=seed_runs(training,p,count=6)
    from backend.training_store import ProjectRow
    with training.store.session() as session:
        owner=session.get(ProjectRow,p['id']).owner
    for item,name in zip(p['classes'],['猫','狗']):
        item['name']=name
    training.store.save(owner,p)
    t=thread(c,p['id'])
    reply=ask(c,p['id'],t['id'],question='实际是猫，却识别成狗了',runId=ids[3]).json()['reply']
    assert reply['studentFeedback']['phase']=='ready'
    assert reply['evidence'][0]['result']['id']==ids[5]
    assert len(provider.calls)==1
    context=json.loads(provider.calls[0]['messages'][1]['content'].split('\n',1)[1])
    assert context['studentFeedback']['source']=='student_reported_unverified'
