"""Frozen MobileNetV3 features and a truly trained linear classifier."""
import hashlib
import os
import threading
from pathlib import Path
import torch
from PIL import Image
from safetensors.torch import load_file, save_file
from torchvision.models import mobilenet_v3_large, MobileNet_V3_Large_Weights

WEIGHTS = MobileNet_V3_Large_Weights.IMAGENET1K_V2
BACKBONE_VERSION = "mobilenet_v3_large-imagenet1k_v2-5c1a4163"
MODEL_DIR = Path(__file__).parent / "models" / "mobilenet-v3-large"
WEIGHT_FILE = MODEL_DIR / "mobilenet_v3_large-5c1a4163.pth"
class FeatureExtractor:
    def __init__(self):
        self.model=None
        self.lock=threading.RLock()
        self.transform=WEIGHTS.transforms()
    def load(self):
        with self.lock:
            if self.model is not None:return
            if not WEIGHT_FILE.exists():raise RuntimeError("缺少 MobileNet 权重，请运行 python -m backend.download_training_model。")
            if not hashlib.sha256(WEIGHT_FILE.read_bytes()).hexdigest().startswith("5c1a4163"):raise RuntimeError("MobileNet 权重校验失败，请重新下载。")
            torch.set_num_threads(max(1,min(4,int(os.getenv("VISION_TORCH_THREADS","2")))))
            model=mobilenet_v3_large(weights=None)
            model.load_state_dict(torch.load(WEIGHT_FILE,map_location="cpu",weights_only=True))
            model.classifier=torch.nn.Identity()
            model.eval().requires_grad_(False)
            self.model=model
    def extract(self,image):
        self.load()
        with self.lock,torch.inference_mode():
            return self.model(self.transform(image).unsqueeze(0)).squeeze(0).clone()
    def cached(self,path,fingerprint,cache_dir):
        cache_dir.mkdir(parents=True,exist_ok=True)
        key=hashlib.sha256((BACKBONE_VERSION+fingerprint+"resize232-centercrop224").encode()).hexdigest()
        target=cache_dir/(key+".safetensors")
        if target.exists():return load_file(str(target))["feature"]
        with Image.open(path) as image:feature=self.extract(image.convert("RGB"))
        temp=target.with_suffix(".partial")
        save_file({"feature":feature.contiguous()},str(temp));temp.replace(target)
        return feature

def stratified_split(classes,seed=42):
    generator=torch.Generator().manual_seed(seed)
    train=[];val=[]
    for i,c in enumerate(classes):
        indices=torch.randperm(len(c["samples"]),generator=generator).tolist()
        n=max(1,round(len(indices)*.2))
        val.extend((i,c["samples"][j]) for j in indices[:n])
        train.extend((i,c["samples"][j]) for j in indices[n:])
    return train,val
