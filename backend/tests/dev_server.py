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
app=create_app(training_service=TrainingService(Store("sqlite:///"+str(root/"test.sqlite")),root/"data"))
