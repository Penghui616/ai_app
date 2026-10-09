import hashlib
import json
import logging
import os
import threading
import time
from PIL import Image
from backend.model_spec import MODEL_DIR, MODEL_ID, REPOSITORY, REVISION, LABELS_ZH

class ModelUnavailable(Exception): pass
class ModelBusy(Exception): pass

class FruitClassifier:
    def __init__(self):
        self.status = "loading"
        self.error = None
        self.labels = [{"id":i,"name":name,"label":label} for i,(name,label) in enumerate(LABELS_ZH.items())]
        self._gate = threading.Lock()

    def load(self):
        try:
            import torch
            from transformers import AutoImageProcessor, AutoModelForImageClassification
            manifest = json.loads((MODEL_DIR / "manifest.json").read_text(encoding="utf-8"))
            if manifest["revision"] != REVISION or manifest["repository"] != REPOSITORY: raise ValueError("Unexpected model revision")
            for name in ("config.json","preprocessor_config.json","model.safetensors"):
                if hashlib.sha256((MODEL_DIR/name).read_bytes()).hexdigest()!=manifest["files"][name]: raise ValueError("Model checksum mismatch")
            torch.set_num_threads(max(1,min(4,int(os.getenv("VISION_TORCH_THREADS","2")))))
            self.processor = AutoImageProcessor.from_pretrained(str(MODEL_DIR),local_files_only=True,use_fast=False,trust_remote_code=False)
            self.model = AutoModelForImageClassification.from_pretrained(str(MODEL_DIR),local_files_only=True,use_safetensors=True,trust_remote_code=False).eval()
            labels = self.model.config.id2label
            if set(labels.values())!=set(LABELS_ZH) or len(labels)!=36: raise ValueError("Unexpected model labels")
            self.labels = [{"id":i,"name":labels[i],"label":LABELS_ZH[labels[i]]} for i in range(36)]
            # Warm up once so classroom requests do not pay the first-call cost.
            with torch.inference_mode(): self.model(**self.processor(images=Image.new("RGB",(224,224)),return_tensors="pt"))
            self.status="ready"
        except Exception:
            self.status="error"
            self.error="模型未就绪，请完成模型下载并重新启动后端。"
            logging.exception("Could not initialize pinned fruit model")

    def metadata(self):
        return {"id":MODEL_ID,"name":"果蔬分类","repository":REPOSITORY,"version":REVISION,
                "status":self.status,"error":self.error,"isMock":False,"classCount":36,"labels":self.labels,
                "inputSize":224,"device":"cpu","license":"apache-2.0"}

    def predict(self,image):
        if self.status!="ready": raise ModelUnavailable()
        if not self._gate.acquire(blocking=False): raise ModelBusy()
        try:
            import torch
            started=time.perf_counter()
            with torch.inference_mode():
                inputs=self.processor(images=image,return_tensors="pt")
                probabilities=self.model(**inputs).logits.softmax(dim=-1)[0]
                values,indices=torch.topk(probabilities,5)
            scores=[{**self.labels[int(index)],"score":float(value)} for value,index in zip(values,indices)]
            return {"modelId":MODEL_ID,"modelVersion":REVISION,"isMock":False,"scores":scores,
                    "latencyMs":round((time.perf_counter()-started)*1000,1),"uncertain":scores[0]["score"]<0.6,
                    "notice":"仅支持预设的36类果蔬。非果蔬或多物体画面也可能被误分；分数不等于准确率。"}
        finally: self._gate.release()
