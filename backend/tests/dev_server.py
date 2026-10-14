"""Playwright only. Never initializes the company database."""
import os
import tempfile
from pathlib import Path
if os.environ.get("VISION_TEST_SERVER")!="1":
    raise RuntimeError("Use the Playwright real-test configuration.")
from backend.app import create_app
from backend.training import TrainingService
from backend.training_store import Store
root=Path(tempfile.mkdtemp(prefix="vision-lab-e2e-"))
class TutorTestProvider:
    ready=True
    model="isolated-test-provider"
    def complete(self,messages,tools,deadline):
        advanced="当前唯一讲解模式：进阶讲解" in messages[0]["content"]
        content=("进阶测试回答" if advanced else "基础测试回答")+"：请先检查各类别的样本，再通过独立图片验证结果。此文本来自隔离测试替身，并非 Qwen 实测回答。"
        return dict(message=dict(content=content),usage=dict(prompt_tokens=100,completion_tokens=25,total_tokens=125))
app=create_app(agent_provider=TutorTestProvider(),training_service=TrainingService(Store("sqlite:///"+str(root/"test.sqlite")),root/"data"))
