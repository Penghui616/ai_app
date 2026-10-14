"""Resolve explicit experiment numbers before the model answers; no database writes."""
import re
from backend.agent_tools import find_run_number

ORDINAL = r"第\s*([0-9０-９零〇一二两三四五六七八九十百]+)\s*次"
CURVE = re.compile(r"曲线|走势图|收敛|震荡|振荡|过拟合")
COMPARE = re.compile(r"比较|对比|哪个.{0,6}好|哪次.{0,6}好|哪个好|优于|差异|区别")
NEGATION = re.compile(r"不要|别查|不用|不需要|为什么|为何|怎么不")


def number_value(text):
    if text.isdecimal():
        return int(text)
    digits = dict(zip("零〇一二两三四五六七八九", [0,0,1,2,2,3,4,5,6,7,8,9]))
    if not any(x in text for x in "十百"):
        return int("".join(str(digits[x]) for x in text))
    total = current = 0
    for x in text:
        if x in "十百":
            total += (current or 1) * (10 if x == "十" else 100)
            current = 0
        else:
            current = digits[x]
    return total + current


def referenced_numbers(question):
    return list(dict.fromkeys(number_value(m) for m in re.findall(ORDINAL, question)))


def prepare_numbered_query(question, previous_messages, p, selected_id):
    """Small deterministic fast path. Other language remains model/tool driven."""
    numbers = referenced_numbers(question)
    prior = next((m["text"] for m in reversed(previous_messages) if m["role"] == "user"), "")
    bare = bool(re.fullmatch(r"\s*"+ORDINAL+r"(?:实验|训练)?[。！!，,\s]*", question))
    if bare:
        # Keep the requested task across repeated short clarification replies.
        prior = next((m["text"] for m in reversed(previous_messages[-12:])
                      if m["role"] == "user" and not re.fullmatch(r"\s*"+ORDINAL+r"(?:实验|训练)?[。！!，,\s]*", m["text"])), prior)
    intent = prior if bare else question
    if NEGATION.search(question) or re.search(r"倒数|列表|最近.{0,3}第", question):
        return [], numbers
    if len(numbers) == 1 and CURVE.search(intent):
        return [("get_training_details", dict(run_number=numbers[0], include_curve=True))], numbers
    # Corrections like “第三次也是SGD” refer back to the active comparison.
    if len(numbers) == 1 and COMPARE.search(prior) and re.search(r"也是|用的|相同|一样", question) and selected_id:
        try:
            other = find_run_number(p, numbers[0])
        except ValueError:
            other = None
        if other and other["id"] != selected_id:
            return [("compare_training_runs", dict(first_run_id=selected_id, second_run_id=other["id"]))], numbers
        return [("get_training_details", dict(run_number=numbers[0]))], numbers
    if len(numbers) == 1 and re.search(r"分析|结果|参数|学习率|优化器|损失|准确率", intent):
        return [("get_training_details", dict(run_number=numbers[0]))], numbers
    if len(numbers) == 2 and COMPARE.search(intent):
        try:
            first, second = [find_run_number(p, n) for n in numbers]
        except ValueError:
            return [("get_training_details", dict(run_number=n)) for n in numbers], numbers
        return [("compare_training_runs", dict(first_run_id=first["id"], second_run_id=second["id"]))], numbers
    return [], numbers
