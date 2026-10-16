"""Track explicit student reports, never infer ground truth from model scores."""
import re
from backend.agent_context import referenced_numbers

ERROR = re.compile(r"(?:输出|预测|识别|分类).{0,12}(?:错|不对|不正确)|误判|错分")
NEW_INPUT = re.compile(r"换.{0,8}(?:图|照片|物体)|(?:新|另一).{0,6}(?:图|照片|物体)")


def _label(text: str, pattern: str) -> str | None:
    match = re.search(pattern, text)
    if not match:
        return None
    value = re.split(r"[，。！？；,!?;\n]|却|但是|但|而|被|识别|预测", match.group(1))[0]
    value = value.strip(' \t“”"「」').removesuffix('了')
    if not value or len(value) > 40 or re.search(r"不知道|不确定|可能|不是|还是|或者", value):
        return None
    return value


def prepare_feedback(question: str, messages: list, class_names: list[str]) -> dict | None:
    """Handle explicit labels/common error reports; other wording stays model-driven."""
    previous = next((m.get('studentFeedback') for m in reversed(messages) if m['role']=='assistant'), None)
    actual = _label(question, r"(?:实际|其实|本来)(?:上)?(?:是|为)\s*(.+)")
    if not actual:
        actual = _label(question, r"(?:上传的|拍的|画面里|这张图里)(?:是)\s*(.+)")
    if not actual:
        actual = _label(question, r"(?:这(?:张(?:图片|照片)|个|张)?|它)是\s*(.+)")
    predicted = _label(question, r"(?:识别|预测|判)(?:成|为)(?:了)?\s*(.+)")
    # A bare class-name reply is unambiguous only while waiting for a label.
    bare = question.strip(' \t\n。.!！')
    if previous and bare in class_names:
        if previous['phase']=='awaiting_actual':
            actual = bare
        elif previous['phase']=='awaiting_prediction':
            predicted = bare
    error = bool(ERROR.search(question))
    new_input = bool(NEW_INPUT.search(question)) and '同一张' not in question
    if not error and not (actual and predicted) and not (previous and (actual or predicted)):
        return None
    state = dict(actual=None, predicted=None, runNumber=None, source='student_reported_unverified')
    if previous and not new_input:
        state.update({key:previous.get(key) for key in ('actual','predicted','runNumber')})
    if actual:
        state['actual'] = actual
    if predicted:
        state['predicted'] = predicted
    numbers = referenced_numbers(question)
    if len(numbers)==1:
        state['runNumber'] = numbers[0]
    if not state['actual']:
        state.update(phase='awaiting_actual', clarification='你刚才测试的图片或摄像头画面，实际是什么类别？')
    elif not state['predicted']:
        state.update(phase='awaiting_prediction', clarification='模型当时把它识别成了什么类别？')
    else:
        state.update(phase='ready', clarification=None)
    return state
