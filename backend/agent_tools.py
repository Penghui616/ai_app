"""Read-only teaching tools. Every result is scoped to a verified project snapshot."""
import json
import re
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
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

    @field_validator("run_number", mode="before")
    @classmethod
    def normalize_number(cls, value):
        # Some providers emit JSON integers as strings. Do not coerce booleans,
        # floats, expressions, IDs, or other fields; project lookup remains strict.
        if isinstance(value, str) and re.fullmatch(r"[1-9][0-9]{0,8}", value):
            return int(value)
        return value

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

PRODUCT_CAPABILITIES = dict(
    earlyStoppingSetting=False, regularizationSetting=False,
    intermediateCheckpoints=False, historicalModelSwitch=False,
    modelExport=False,
    dataAugmentationSetting=False, sampleSplitViewer=False,
    predictionPolicy="校验始终使用当前数据版本下最新完成的有效模型；助手选择历史记录只用于分析，不切换预测模型。",
    supportedAlternative="可在训练参数中调整轮数后重新训练；不能取回上次训练中间轮次的权重。",
    operationLocations={
        "samples": "当前实验页左侧‘准备样本’直接显示各类别图片数量；在对应类别点击‘上传图片’或‘摄像头’补充。没有单独的‘样本’页面或标签，没有查看训练/验证图片划分的入口。",
        "testing": "当前实验页右侧‘部署与校验’→‘输入来源’选‘文件’→‘选择测试图片’→‘开始识别’；每次一张。不是单独的测试页面。",
        "parameters": "当前实验页中间‘训练模型’→‘训练参数’→修改‘训练轮数’或‘学习率’→‘开始训练’。",
        "curve": "右侧‘最近训练’点击记录打开‘训练监控’查看曲线；更早记录可让助手按第N次查询。没有‘包含曲线’勾选框。",
    },
)
GUIDES["training"].append("当前没有早停设置；取消训练不会保存可校验模型。只有正常训练结束才保存最后一轮权重。")
GUIDES["parameters"].append("当前没有早停或正则化设置入口。若需较少轮数，在训练参数里修改轮数并重新训练，不是恢复旧的中间权重。")
GUIDES["testing"].append(PRODUCT_CAPABILITIES["predictionPolicy"])
GUIDES["history"].append("历史选择器只选择分析对象，不能把校验模型切换为历史模型；也不能下载某一轮权重。")
GUIDES["samples"].append(PRODUCT_CAPABILITIES["operationLocations"]["samples"])
GUIDES["samples"].append("没有数据增强设置入口；数量只反映类别分布，不能证明图片多样性或标注质量。修改样本后旧模型失效，需重新训练。")


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
                  final=metrics[-1] if metrics else None, bestValidation=best,
                  curveIncluded=False, curveStats=None,
                  evidenceScope="首尾、最优值及程序统计，不含逐轮曲线。样本数量不能证明样本划分相同，参数归因须查compare_training_runs。")
    if metrics:
        minimum = metrics[0]["valLoss"]
        rebound = 0.0
        for point in metrics:
            rebound = max(rebound, point["valLoss"]-minimum)
            minimum = min(minimum, point["valLoss"])
        low_accuracy = min(metrics, key=lambda m: m["accuracy"])
        high_accuracy = max(m["accuracy"] for m in metrics)
        all_full = all(m["accuracy"] >= 1 for m in metrics)
        increases = sum(b["valLoss"] > a["valLoss"]+1e-9 for a,b in zip(metrics,metrics[1:]))
        result["curveStats"] = dict(
            scope="对全部已记录轮次计算，不是独立测试或因果判断。",
            recordedEpochs=len(metrics), lastRecordedEpoch=metrics[-1]["epoch"],
            validationLossIncreaseSteps=increases,
            maxValidationLossRebound=rebound,
            minAccuracy=low_accuracy["accuracy"],
            maxAccuracy=high_accuracy,
            minAccuracyFirstEpoch=low_accuracy["epoch"],
            allEpochsFullAccuracy=all_full,
            firstFullAccuracyEpoch=next((m["epoch"] for m in metrics if m["accuracy"] >= 1), None),
            facts=[
                f"已记录{len(metrics)}轮，验证准确率范围{low_accuracy['accuracy']:.0%}至{high_accuracy:.0%}；"
                + ("每轮均为100%。" if all_full else f"并非全程100%，最低值首次在第{low_accuracy['epoch']}轮出现。"),
                f"验证损失有{increases}次相邻轮次上升，最大相对之前最低点反弹{rebound:.6g}。首尾相同不等于中途稳定。",
                "这些统计只描述现象；首次达到100%不证明之后始终100%，单次曲线不证明学习率导致波动或已记住图片细节。",
            ],
        )
        result["trend"] = dict(trainLossChange=metrics[-1]["trainLoss"]-metrics[0]["trainLoss"],
                               valLossChange=metrics[-1]["valLoss"]-metrics[0]["valLoss"],
                               accuracyPercentagePointChange=100*(metrics[-1]["accuracy"]-metrics[0]["accuracy"]),
                               validationLossRiseFromMinimum=metrics[-1]["valLoss"]-best["valLoss"],
                               scope="首尾差值；validationLossRiseFromMinimum仅表示末轮减最小值，为0不代表过程中没有反弹。")
    return result


def experiment_state(p, client):
    counts = [len(c["samples"]) for c in p["classes"]]
    total = sum(counts)
    minimum, maximum = min(counts, default=0), max(counts, default=0)
    distribution = dict(totalSamples=total, classCount=len(counts),
                        minClassCount=minimum, maxClassCount=maximum,
                        countsEqual=(minimum == maximum) if total else None,
                        maxToMinRatio=(maximum/minimum) if minimum else None,
                        scope="当前项目全部样本的类别数量统计，不是某次训练的划分，也不包含独立测试集。数量均衡不等于样本质量好；每类5张是运行最低要求，没有每类30张的统一合格标准。")
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
                sampleDistribution=distribution,
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
    def same_known(key):
        if first.get(key) is None or second.get(key) is None:
            return None
        return first[key] == second[key]
    same_data = same_known("revision")
    split_known = all(isinstance(r.get(k), list) and bool(r[k])
                      for r in (first, second) for k in ("trainSampleIds", "validationSampleIds"))
    same_split = ((set(first["trainSampleIds"]) == set(second["trainSampleIds"]) and
                   set(first["validationSampleIds"]) == set(second["validationSampleIds"])) if split_known else None)
    same_seed, same_backbone = same_known("seed"), same_known("backbone")
    params_a, params_b = first.get("params", {}), second.get("params", {})
    changes = {k: [params_a.get(k), params_b.get(k)] for k in sorted(params_a.keys() | params_b.keys())
               if params_a.get(k) != params_b.get(k)}
    required_params = {"imageSize", "batchSize", "epochs", "optimizer", "learningRate"}
    parameter_keys_known = required_params <= params_a.keys() and params_a.keys() == params_b.keys() and all(
        v is not None for params in (params_a, params_b) for v in params.values())
    complete = all(r["status"] == "completed" and r.get("metrics") for r in (first, second))
    result = dict(first=run_summary(first), second=run_summary(second), sameDataVersion=same_data,
                  sameSplit=same_split, bothCompleted=bool(complete),
                  parameterChanges=changes, sameSeed=same_seed, sameBackbone=same_backbone,
                  comparable=bool(same_data and same_split and complete),
                  attributionAllowed=bool(complete and same_data and same_split and same_seed and same_backbone
                                          and parameter_keys_known and len(changes)==1),
                  caveat="null表示信息缺失，不等于相同。attributionAllowed仅说明已记录的控制条件支持本次单因素比较，不证明统计显著或泛化优势；为false时不作单参数归因。")
    result["controlVerdict"] = (
        "已记录的控制条件一致且只有一个参数变化；只支持本次指标比较，不证明统计显著或泛化。"
        if result["attributionAllowed"] else
        "控制条件不一致或证据不完整；禁止把指标差异归因于单个参数。"
    )
    if same_split is False:
        result["controlVerdict"] += "两次实际样本划分不同，即使数量和种子相同也不能作为相同划分的对照。"
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
    "get_test_records": (TestArgs, "读取最近文件测试的类别分数，默认筛选当前有效模型；不含摄像头帧、图片或真实标签。用户只说识别错了时先问实际类别，不用此工具猜测。最近记录不一定是用户反馈的那次，不能计算测试准确率。"),
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
            result["curveIncluded"] = True
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
                accuracyAvailable=False, cameraFramesIncluded=False, reportedIncidentMatched=False,
                notice="这些是文件测试历史，尚未与用户说的那次误判匹配，不能自动把最近一条当成那次。未保存测试图片及正确类别；摄像头实时帧不逐帧保存。学生对话中的纠正属于反馈，不能视为已核验标签。")
