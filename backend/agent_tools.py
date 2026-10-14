"""Read-only teaching tools. Every result is scoped to a verified project snapshot."""
import json
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from backend.training_store import now


class Args(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class EmptyArgs(Args):
    pass


class GuideArgs(Args):
    step: Literal["samples", "training", "testing", "parameters", "history"]


class ListArgs(Args):
    limit: int = Field(default=5, ge=1, le=20)
    offset: int = Field(default=0, ge=0)


class RunArgs(Args):
    run_id: str | None = Field(default=None, min_length=1, max_length=36)
    run_number: int | None = Field(default=None, ge=1)
    include_curve: bool = False

    @model_validator(mode="after")
    def one_reference(self):
        if (self.run_id is None) == (self.run_number is None):
            raise ValueError("提供 run_number 或 run_id 中的一项。")
        return self


class CompareArgs(Args):
    first_run_id: str = Field(min_length=1, max_length=36)
    second_run_id: str = Field(min_length=1, max_length=36)


class TestArgs(Args):
    run_id: str | None = Field(default=None, max_length=36)
    limit: int = Field(default=5, ge=1, le=10)


GUIDES = {
    "samples": ["在左侧类别名称输入框填写名称，点击输入框外保存。", "每个类别点击‘上传图片’，选择 JPG、PNG 或 WebP；一次最多 50 张。也可点击‘摄像头’采集。", "至少两个类别，每类至少 5 张不同图片。最低数量只保证流程可运行，不保证效果。"],
    "training": ["确认每类至少有 5 张不同图片。", "在中间‘训练模型’区域点击‘开始训练’，首次实验可保留默认参数。", "训练监控中查看训练曲线和运行日志；训练完成后点击‘完成，去测试’。"],
    "testing": ["在右侧‘部署与校验’的‘输入来源’选择‘文件’。", "上传未参与训练的新图片，点击‘开始识别’。", "也可选择‘摄像头’，点击‘开启摄像头’进行实时识别。", "对照真实类别判断是否正确。预测分数不是整体准确率，可在聊天里反馈误分类。"],
    "parameters": ["在中间‘训练参数’中调整学习率、批大小、优化器或训练轮数。", "建议一次只改一个因素，保留相同样本和验证划分，再点击‘开始训练’。", "每次从固定种子初始化的新分类层开始训练，不是在上次结果上继续训练。"],
    "history": ["右侧‘最近训练’显示最近三次记录，点击可查看训练监控。", "助手的训练记录选择器可选择更早记录，比较时选择两次训练。", "页面上方‘导出实验记录’可下载 JSON 记录，不含模型权重。"],
}


def find_run(p, run_id):
    run = next((r for r in p["runs"] if r["id"] == run_id), None)
    if run is None:
        raise ValueError("当前项目没有这条训练记录，请先列出训练记录。")
    return run


def numbered_runs(p):
    # Matches the frontend: reverse-chronological list, oldest is experiment 1.
    return [(len(p["runs"])-i, r) for i, r in enumerate(p["runs"])]


def find_run_number(p, number):
    if number < 1 or number > len(p["runs"]):
        raise ValueError(f"当前项目共有 {len(p['runs'])} 次训练，没有第 {number} 次。")
    return p["runs"][len(p["runs"])-number]


def training_index(p, limit=12, offset=0, include_numbers=()):
    numbered = numbered_runs(p)
    rows = numbered[offset:offset+limit]
    ids = {r["id"] for _, r in rows}
    rows += [(n, r) for n, r in numbered if n in include_numbers and r["id"] not in ids]
    return dict(total=len(numbered), offset=offset, nextOffset=offset+limit if offset+limit < len(numbered) else None,
                numbering="第N次按创建时间从早到晚编号，包含失败和取消的训练，与页面一致；列表倒序不改变编号。",
                runs=[dict(runNumber=n, id=r["id"], status=r["status"], startedAt=r.get("startedAt"),
                           params=r.get("params", {}), revision=r.get("revision")) for n, r in rows])


def run_summary(r):
    metrics = r.get("metrics", [])
    best = min(metrics, key=lambda x: x["valLoss"]) if metrics else None
    result = {k: r.get(k) for k in ("id", "status", "startedAt", "revision", "params", "seed", "isMock", "backbone")}
    result.update(trainCount=len(r.get("trainSampleIds", [])), validationCount=len(r.get("validationSampleIds", [])),
                  epochsFinished=len(metrics), first=metrics[0] if metrics else None,
                  final=metrics[-1] if metrics else None, bestValidation=best)
    if metrics:
        result["trend"] = dict(trainLossChange=metrics[-1]["trainLoss"]-metrics[0]["trainLoss"],
                               valLossChange=metrics[-1]["valLoss"]-metrics[0]["valLoss"],
                               accuracyPercentagePointChange=100*(metrics[-1]["accuracy"]-metrics[0]["accuracy"]),
                               validationLossRiseFromMinimum=metrics[-1]["valLoss"]-best["valLoss"])
    return result


def experiment_state(p, client):
    active = next((r for r in p["runs"] if r["status"] == "running"), None)
    valid = next((r for r in p["runs"] if r["status"] == "completed" and r["revision"] == p["revision"]), None)
    missing = [dict(name=c["name"], needed=max(0, 5-len(c["samples"]))) for c in p["classes"] if len(c["samples"]) < 5]
    file_tested = bool(valid and any(t.get("runId") == valid["id"] for t in p.get("predictions", [])))
    browser_tested = bool(valid and client.get("testedRunId") == valid["id"])
    if active:
        stage, step = "training", "等待训练完成，可查看曲线或取消训练。"
    elif valid:
        stage = "tested" if file_tested or browser_tested else "ready_to_test"
        step = "比较新图片的实际类别与预测结果，记录错误，再设计对照实验。" if stage == "tested" else "使用未参与训练的新图片或摄像头测试当前模型。"
    elif missing:
        stage, step = "needs_samples", "为不足的类别补充不同图片，再开始训练。"
    else:
        stage, step = "ready_to_train", "样本满足最低训练条件，可以开始训练。"
    return dict(projectName=p["name"], revision=p["revision"], capturedAt=now(), stage=stage, nextStep=step,
                classes=[dict(name=c["name"], count=len(c["samples"])) for c in p["classes"]],
                missing=missing, activeRunId=active["id"] if active else None,
                validModelRunId=valid["id"] if valid else None,
                fileTestRecorded=file_tested, browserReportsSuccessfulTest=browser_tested,
                browserStateNotice="浏览器报告只用于操作指导，不是已验证的准确率或正确标签。",
                lastRunStatus=p["runs"][0]["status"] if p["runs"] else None,
                constraints=dict(minPerClass=5, maxProjectSamples=200, frozenBackbone=True, splitSeed=42,
                                 modelExportAvailable=False, assistantCanExecuteTraining=False))


def compare_runs(p, a, b):
    if a == b:
        raise ValueError("请选择两次不同的训练。")
    first, second = find_run(p, a), find_run(p, b)
    same_data = first["revision"] == second["revision"]
    same_split = (set(first.get("trainSampleIds", [])) == set(second.get("trainSampleIds", [])) and
                  set(first.get("validationSampleIds", [])) == set(second.get("validationSampleIds", [])))
    complete = all(r["status"] == "completed" and r.get("metrics") for r in (first, second))
    result = dict(first=run_summary(first), second=run_summary(second), sameDataVersion=same_data,
                  sameSplit=same_split, bothCompleted=bool(complete),
                  parameterChanges={k: [first["params"].get(k), second["params"].get(k)] for k in second["params"] if first["params"].get(k) != second["params"].get(k)},
                  comparable=bool(same_data and same_split and complete),
                  caveat="多个因素同时变化时，不能把指标变化单独归因于某个参数；验证结果不等于独立测试结果。")
    if complete:
        x, y = first["metrics"][-1], second["metrics"][-1]
        result["secondMinusFirst"] = dict(trainLoss=y["trainLoss"]-x["trainLoss"], valLoss=y["valLoss"]-x["valLoss"], accuracyPercentagePoints=100*(y["accuracy"]-x["accuracy"]))
    return result


SPECS = {
    "get_experiment_state": (EmptyArgs, "获取当前项目的样本数量、训练和测试状态以及程序确定的下一步。"),
    "get_operation_guide": (GuideArgs, "查询页面真实操作步骤；不要自行编造按钮或未实现功能。"),
    "list_training_runs": (ListArgs, "列出轻量训练索引，runNumber与页面第N次一致；倒序列表不影响编号。可用offset翻页。"),
    "get_training_details": (RunArgs, "按run_number（页面第N次）或run_id读取训练详情。分析曲线必须设置include_curve=true，无需学生提供ID。"),
    "compare_training_runs": (CompareArgs, "比较当前项目的两次训练，检查数据和划分是否一致并计算指标差异。"),
    "get_test_records": (TestArgs, "读取最近文件测试的类别分数，默认筛选当前有效模型；不含图片或真实标签，不能计算测试准确率。"),
}
TOOLS = [dict(type="function", function=dict(name=name, description=desc, parameters=cls.model_json_schema())) for name, (cls, desc) in SPECS.items()]


def execute_tool(name, arguments, p, client):
    if name not in SPECS:
        raise ValueError("未开放这个工具。助手只有六个只读工具。")
    arg = SPECS[name][0].model_validate(arguments)
    if name == "get_experiment_state":
        return experiment_state(p, client)
    if name == "get_operation_guide":
        return dict(step=arg.step, instructions=GUIDES[arg.step])
    if name == "list_training_runs":
        return training_index(p, arg.limit, arg.offset)
    if name == "get_training_details":
        r = find_run_number(p, arg.run_number) if arg.run_number is not None else find_run(p, arg.run_id)
        result = run_summary(r)
        result["runNumber"] = next(n for n, item in numbered_runs(p) if item["id"] == r["id"])
        if arg.include_curve:
            result["curve"] = r.get("metrics", [])[:100]
        result["confusionMatrix"] = r.get("confusionMatrix")
        result["classOrder"] = [c["name"] for c in r.get("classes", [])]
        return result
    if name == "compare_training_runs":
        return compare_runs(p, arg.first_run_id, arg.second_run_id)
    run_id = arg.run_id
    if run_id:
        find_run(p, run_id)
    else:
        valid = next((r for r in p["runs"] if r["status"] == "completed" and r["revision"] == p["revision"]), None)
        run_id = valid["id"] if valid else None
    rows = [r for r in p.get("predictions", []) if run_id and r.get("runId") == run_id]
    return dict(runId=run_id, totalStored=len(rows), records=[{k: r.get(k) for k in ("runId", "createdAt", "scores")} for r in rows[:arg.limit]],
                accuracyAvailable=False, notice="未保存测试图片及正确类别；摄像头实时帧不逐帧保存。学生对话中的纠正属于反馈，不能视为已核验标签。")
