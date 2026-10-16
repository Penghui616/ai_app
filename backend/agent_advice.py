"""Narrow product-capability guard, not a general factual verifier."""
import re
from backend.agent_context import ORDINAL, number_value


def ground_model_test_advice(text: str, prediction_number: int | None) -> tuple[str, bool]:
    """Replace explicit unsupported historical-model test instructions.

    Keep analysis, denials and retraining advice. This guard does not claim to
    understand every paraphrase, and does not add another paid model call.
    """
    parts = re.split(r"([。！？；;\n])", text)
    changed = False
    for index in range(0, len(parts), 2):
        sentence = parts[index]
        if not re.search(r"校验|识别|测试|预测", sentence):
            continue
        if not re.search(r"建议|可以|请|尝试|切换|选择|加载|恢复|取回|分别|直接|使用", sentence):
            continue
        if re.search(r"不能|无法|不支持|不提供|没有|不可|重新训练|重训|未来|将来", sentence):
            continue
        references = re.findall(ORDINAL + r"\s*(?:训练)?(?:的)?(?:模型|权重|结果)", sentence)
        old_model = any(number_value(number) != prediction_number for number in references)
        # A generic two-model comparison is executable when the answer already
        # tells the student to retrain each configuration before testing it.
        two_models_without_retraining = re.search(r"两[个次]模型", sentence) and not re.search(r"重新训练|重训", text)
        if not old_model and not re.search(r"历史模型|旧模型|历史权重", sentence) and not two_models_without_retraining:
            continue
        current = f"第{prediction_number}次训练的模型" if prediction_number else "当前数据版本下最新完成的有效模型（当前尚无）"
        parts[index] = (
            f"操作说明（按当前功能校正）：校验只会使用{current}，不能切换历史模型；"
            "如需对比不同设置，请分别重新训练，每次完成后立即用同一组新图逐张校验并记录对错，再训练下一组"
        )
        changed = True
    return "".join(parts), changed
