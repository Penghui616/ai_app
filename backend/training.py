import hashlib
import json
import logging
import re
import secrets
import threading
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
from io import BytesIO
from fastapi import APIRouter, Request, Response, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool
from filelock import FileLock, Timeout
import torch
from safetensors.torch import save_file, load_file
from backend.training_store import Store, DATA_DIR, COLORS, DEFAULT_PARAMS, now, uid
from backend.learning import FeatureExtractor, BACKBONE_VERSION, WEIGHT_FILE, stratified_split
from backend.image_io import request_image

class NameBody(BaseModel):
    model_config=ConfigDict(extra="forbid")
    name:str=Field(min_length=1,max_length=40)
class ParamsBody(BaseModel):
    model_config=ConfigDict(extra="forbid", strict=True)
    imageSize:int=224
    batchSize:int=16
    epochs:int=Field(default=30,ge=1,le=100)
    optimizer:str="AdamW"
    learningRate:float=Field(default=.001,ge=.00001,le=1,allow_inf_nan=False)

def clean_name(name):
    name=name.strip()
    if not name:raise HTTPException(422,"名称不能为空。")
    return name

class TrainingService:
    def __init__(self,store=None,data_dir=None,extractor=None):
        self.store=store if store is not None else Store()
        self.root=Path(data_dir or DATA_DIR)
        self.extractor=extractor or FeatureExtractor()
        self.lock=threading.RLock()
        self.pool=ThreadPoolExecutor(max_workers=1,thread_name_prefix="classification")
        self.active=None
        self.cancel_event=threading.Event()
        self.prediction_lock=threading.Lock()
        self.status="unavailable";self.error=None
        self.process_lock=None
    def initialize(self):
        try:
            if self.store.engine is None:raise RuntimeError("请先在 backend/.env 配置独立开发库的 MySQL 连接信息。")
            self.root.mkdir(parents=True,exist_ok=True)
            self.process_lock=FileLock(self.root/"training-service.lock")
            self.process_lock.acquire(timeout=0)
            self.store.initialize()
            self.status="ready"
        except Exception as error:
            if self.process_lock and self.process_lock.is_locked:self.process_lock.release()
            self.error=str(error) if isinstance(error,RuntimeError) else "训练数据库连接失败或已有实例运行，请检查本地配置和后端日志。"
            logging.warning("Training storage initialization failed: %s",type(error).__name__)
    def close(self):
        self.cancel_event.set();self.pool.shutdown(wait=True,cancel_futures=True)
        if self.process_lock and self.process_lock.is_locked:self.process_lock.release()
        if self.store.engine:self.store.engine.dispose()
    def check(self):
        if self.status!="ready":raise HTTPException(503,self.error or "训练服务尚未配置。")
    def get(self,owner,id):
        self.check();p=self.store.get(owner,id)
        if p is None:raise HTTPException(404,"项目不存在。")
        return p
    def editable(self,p):
        if any(r["status"]=="running" for r in p["runs"]):raise HTTPException(409,"请先完成或取消训练，再修改项目。")
    def save(self,owner,p,rev=False):
        p["updatedAt"]=now()
        if rev:p["revision"]+=1
        self.store.save(owner,p)
        return p
    def create(self,owner,name):
        self.check()
        if len(self.store.list(owner))>=50:raise HTTPException(409,"当前工作区最多保存 50 个项目。")
        stamp=now();p=dict(id=uid(),name=clean_name(name),createdAt=stamp,updatedAt=stamp,revision=0,params=deepcopy(DEFAULT_PARAMS),runs=[],predictions=[],classes=[dict(id=uid(),name=f"类别{i+1}",color=COLORS[i],samples=[]) for i in range(2)])
        self.store.save(owner,p);return p
    def category(self,p,id):
        c=next((x for x in p["classes"] if x["id"]==id),None)
        if c is None:raise HTTPException(404,"类别不存在。")
        return c
    def image_path(self,pid,sid):return self.root/"samples"/pid/(sid+".jpg")
    def add_image(self,owner,pid,cid,image,name):
        with self.lock:
            p=self.get(owner,pid);self.editable(p);c=self.category(p,cid)
            image.thumbnail((1024,1024))
            buffer=BytesIO();image.save(buffer,format="JPEG",quality=92)
            data=buffer.getvalue();fingerprint=hashlib.sha256(data).hexdigest()
            for group in p["classes"]:
                for sample in group["samples"]:
                    if sample["fingerprint"]==fingerprint:
                        if group["id"]==cid:return {"added":0,"project":p}
                        raise HTTPException(409,"同一张图片已在其他类别中，请检查标注。")
            if sum(len(x["samples"]) for x in p["classes"])>=200:raise HTTPException(409,"每个项目最多 200 张图片。")
            sid=uid();path=self.image_path(pid,sid);path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
            sample=dict(id=sid,name=name[:120] or "图片.jpg",size=len(data),fingerprint=fingerprint,createdAt=now(),dataUrl=f"/api/v1/projects/{pid}/samples/{sid}/image")
            c["samples"].append(sample)
            try:self.save(owner,p,True)
            except Exception:path.unlink(missing_ok=True);raise
            return {"added":1,"project":p}
    def start(self,owner,pid):
        with self.lock:
            p=self.get(owner,pid);self.editable(p)
            if self.active:raise HTTPException(409,"另一个训练任务正在运行，请稍后再试。")
            if any(len(c["samples"])<5 for c in p["classes"]):raise HTTPException(422,"每类至少需要 5 张不同图片，才能划分训练集和验证集。建议采集更多独立样本。")
            if len(p["runs"])>=50:raise HTTPException(409,"项目已达 50 次训练记录，请新建项目。")
            if not WEIGHT_FILE.exists() and isinstance(self.extractor,FeatureExtractor):raise HTTPException(503,"请先下载 MobileNetV3 训练权重。")
            train,val=stratified_split(p["classes"])
            run=dict(id=uid(),projectId=pid,revision=p["revision"],status="running",stage="extracting",params=deepcopy(p["params"]),metrics=[],startedAt=now(),message="准备提取图像特征。",sampleCount=sum(len(c["samples"]) for c in p["classes"]),isMock=False,backbone=BACKBONE_VERSION,seed=42,trainSampleIds=[s["id"] for _,s in train],validationSampleIds=[s["id"] for _,s in val],classes=[{k:c[k] for k in ("id","name","color")} for c in p["classes"]],featureProgress=0)
            self.store.save_run(run);self.active=run["id"];self.cancel_event.clear()
            self.pool.submit(self._train,deepcopy(p),deepcopy(run),train,val)
            return run
    def _train(self,p,run,train,val):
        def stop():
            if self.cancel_event.is_set():raise InterruptedError()
        try:
            features={};items=train+val
            for i,(_,sample) in enumerate(items):
                stop();features[sample["id"]]=self.extractor.cached(self.image_path(p["id"],sample["id"]),sample["fingerprint"],self.root/"features")
                run.update(featureProgress=round((i+1)/len(items)*100),message=f"提取特征 {i+1}/{len(items)}")
                self.store.save_run(run)
            x=torch.stack([features[s["id"]] for _,s in train]);y=torch.tensor([label for label,_ in train])
            vx=torch.stack([features[s["id"]] for _,s in val]);vy=torch.tensor([label for label,_ in val])
            # No backbone updates, dropout, or batchnorm statistics changes.
            generator=torch.Generator().manual_seed(run["seed"])
            head=torch.nn.Linear(x.shape[1],len(p["classes"]))
            with torch.no_grad():
                head.weight.copy_(torch.randn(head.weight.shape,generator=generator)*.01);head.bias.zero_()
            params=run["params"]
            optim=(torch.optim.AdamW if params["optimizer"]=="AdamW" else torch.optim.SGD)(head.parameters(),lr=params["learningRate"])
            criterion=torch.nn.CrossEntropyLoss()
            for epoch in range(1,params["epochs"]+1):
                stop();head.train();indices=torch.randperm(len(x),generator=generator)
                for offset in range(0,len(x),params["batchSize"]):
                    stop();batch=indices[offset:offset+params["batchSize"]]
                    optim.zero_grad();loss=criterion(head(x[batch]),y[batch])
                    if not torch.isfinite(loss):raise RuntimeError("训练数值异常，请降低学习率后重试。")
                    loss.backward();optim.step()
                head.eval()
                with torch.no_grad():
                    tl=criterion(head(x),y).item();vl=criterion(head(vx),vy).item();pred=head(vx).argmax(1);accuracy=(pred==vy).float().mean().item()
                if not all(torch.isfinite(torch.tensor(v)) for v in (tl,vl)):raise RuntimeError("训练数值异常，请降低学习率。")
                run["metrics"].append(dict(epoch=epoch,trainLoss=tl,valLoss=vl,accuracy=accuracy))
                run.update(stage="training",message=f"训练分类层 {epoch}/{params['epochs']}，特征提取网络保持冻结。")
                self.store.save_run(run)
            stop()
            target=self.root/"models"/run["id"];target.mkdir(parents=True,exist_ok=True)
            save_file({k:v.detach().contiguous() for k,v in head.state_dict().items()},str(target/"classifier.safetensors"))
            manifest={k:run[k] for k in ("id","projectId","revision","backbone","classes","params","seed","trainSampleIds","validationSampleIds")}
            manifest["weightsSha256"]=hashlib.sha256((target/"classifier.safetensors").read_bytes()).hexdigest()
            (target/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
            confusion=torch.zeros((len(p["classes"]),len(p["classes"])),dtype=torch.int64)
            for actual,guess in zip(vy,pred):confusion[actual,guess]+=1
            with self.lock:
                stop();run.update(status="completed",stage="completed",finishedAt=now(),message="真实训练完成，分类层与类别映射已保存。验证集结果不等于独立测试准确率。",confusionMatrix=confusion.tolist(),modelVersion=run["id"])
                self.store.save_run(run)
        except InterruptedError:
            run.update(status="cancelled",stage="cancelled",finishedAt=now(),message="训练已取消，本次模型不可用于预测。")
            self.store.save_run(run)
        except Exception:
            logging.exception("Classification training failed")
            run.update(status="failed",stage="failed",finishedAt=now(),message="训练失败，请检查图片、模型文件或数据库连接；详情见后端日志。")
            try:self.store.save_run(run)
            except Exception:logging.exception("Could not persist failed training")
        finally:
            with self.lock:self.active=None
    def predict(self,owner,pid,image,record=True):
        if not self.prediction_lock.acquire(blocking=False):raise HTTPException(429,"模型正在处理其他画面，请稍后重试。",headers={"Retry-After":"1"})
        try:return self._predict(owner,pid,image,record)
        finally:self.prediction_lock.release()
    def _predict(self,owner,pid,image,record=True):
        with self.lock:
            p=self.get(owner,pid)
            run=next((r for r in p["runs"] if r["status"]=="completed" and r["revision"]==p["revision"]),None)
            if run is None:raise HTTPException(409,"请先针对当前样本完成真实训练。")
        features=self.extractor.extract(image)
        target=self.root/"models"/run["id"]
        try:
            manifest=json.loads((target/"manifest.json").read_text(encoding="utf-8"))
            if manifest["backbone"]!=BACKBONE_VERSION or hashlib.sha256((target/"classifier.safetensors").read_bytes()).hexdigest()!=manifest["weightsSha256"]:raise ValueError("Model mismatch")
            weights=load_file(str(target/"classifier.safetensors"))
        except (OSError,ValueError,KeyError):raise HTTPException(503,"项目模型文件缺失或损坏，请重新训练。")
        with torch.inference_mode():scores=torch.nn.functional.linear(features,weights["weight"],weights["bias"]).softmax(0).tolist()
        result=dict(isMock=False,runId=run["id"],modelVersion=run["id"],createdAt=now(),scores=[dict(classId=c["id"],name=c["name"],color=c["color"],score=scores[i]) for i,c in enumerate(run["classes"])])
        with self.lock:
            current=self.get(owner,pid)
            latest=next((r for r in current["runs"] if r["status"]=="completed" and r["revision"]==current["revision"]),None)
            if current["revision"]!=p["revision"] or not latest or latest["id"]!=run["id"]:raise HTTPException(409,"模型或样本已更新，请重新校验。")
            if record:
                current["predictions"]=[result,*current.get("predictions",[])][:50]
                self.save(owner,current)
        return result

def training_router(service):
    router=APIRouter(prefix="/api/v1")
    def owner(request):
        value=getattr(request.state,"workspace_owner",None)
        if not value:raise HTTPException(401,"请刷新页面建立工作区。")
        return value
    @router.get("/training/status")
    def status():return dict(status=service.status,error=service.error,modelReady=WEIGHT_FILE.exists(),backbone=BACKBONE_VERSION)
    @router.get("/projects")
    def projects(request:Request):
        with service.lock:
            service.check();return service.store.list(owner(request))
    @router.post("/projects",status_code=201)
    def create(body:NameBody,request:Request):
        with service.lock:return service.create(owner(request),body.name)
    @router.get("/projects/{pid}")
    def get(pid:str,request:Request):
        with service.lock:return service.get(owner(request),pid)
    @router.patch("/projects/{pid}")
    def rename(pid:str,body:NameBody,request:Request):
        with service.lock:
            p=service.get(owner(request),pid);p["name"]=clean_name(body.name);return service.save(owner(request),p)
    @router.delete("/projects/{pid}")
    def delete(pid:str,request:Request):
        with service.lock:
            p=service.get(owner(request),pid);service.editable(p);service.store.delete(owner(request),pid)
            # Remove only generated files belonging to the verified project; no recursive filesystem deletion.
            for c in p["classes"]:
                for sample in c["samples"]:service.image_path(pid,sample["id"]).unlink(missing_ok=True)
            for run in p["runs"]:
                for name in ("classifier.safetensors","manifest.json"):(service.root/"models"/run["id"]/name).unlink(missing_ok=True)
            return {"deleted":True}
    @router.post("/projects/{pid}/classes")
    def add_class(pid:str,request:Request):
        with service.lock:
            p=service.get(owner(request),pid);service.editable(p)
            if len(p["classes"])>=8:raise HTTPException(409,"最多 8 个类别。")
            i=1
            while any(c["name"]==f"类别{i}" for c in p["classes"]):i+=1
            p["classes"].append(dict(id=uid(),name=f"类别{i}",color=COLORS[len(p["classes"])],samples=[]))
            return service.save(owner(request),p,True)
    @router.patch("/projects/{pid}/classes/{cid}")
    def rename_class(pid:str,cid:str,body:NameBody,request:Request):
        with service.lock:
            p=service.get(owner(request),pid);service.editable(p);c=service.category(p,cid);name=clean_name(body.name)
            if any(x["id"]!=cid and x["name"].casefold()==name.casefold() for x in p["classes"]):raise HTTPException(409,"类别名称已存在。")
            if c["name"]==name:return p
            c["name"]=name;return service.save(owner(request),p,True)
    @router.delete("/projects/{pid}/classes/{cid}")
    def delete_class(pid:str,cid:str,request:Request):
        with service.lock:
            p=service.get(owner(request),pid);service.editable(p);c=service.category(p,cid)
            if len(p["classes"])<=2:raise HTTPException(409,"至少保留两个类别。")
            p["classes"].remove(c);service.save(owner(request),p,True)
            for sample in c["samples"]:service.image_path(pid,sample["id"]).unlink(missing_ok=True)
            return p
    @router.post("/projects/{pid}/classes/{cid}/samples")
    async def upload(pid:str,cid:str,request:Request,name:str="图片.jpg"):
        with service.lock:service.get(owner(request),pid)
        image=await request_image(request)
        try:return await run_in_threadpool(service.add_image,owner(request),pid,cid,image,name)
        finally:image.close()
    @router.delete("/projects/{pid}/classes/{cid}/samples/{sid}")
    def delete_sample(pid:str,cid:str,sid:str,request:Request):
        with service.lock:
            p=service.get(owner(request),pid);service.editable(p);c=service.category(p,cid)
            sample=next((x for x in c["samples"] if x["id"]==sid),None)
            if not sample:raise HTTPException(404,"图片不存在。")
            c["samples"].remove(sample);service.save(owner(request),p,True);service.image_path(pid,sid).unlink(missing_ok=True);return p
    @router.get("/projects/{pid}/samples/{sid}/image")
    def image(pid:str,sid:str,request:Request):
        with service.lock:
            p=service.get(owner(request),pid)
            if not any(s["id"]==sid for c in p["classes"] for s in c["samples"]):raise HTTPException(404,"图片不存在。")
            path=service.image_path(pid,sid)
            if not path.exists():raise HTTPException(404,"图片文件缺失。")
            return FileResponse(path,media_type="image/jpeg",headers={"Cache-Control":"private, no-store"})
    @router.put("/projects/{pid}/params")
    def params(pid:str,body:ParamsBody,request:Request):
        if body.imageSize!=224 or body.batchSize not in [4,8,16,32,64] or body.optimizer not in ["AdamW","SGD"]:raise HTTPException(422,"训练参数无效。")
        with service.lock:
            p=service.get(owner(request),pid);service.editable(p);p["params"]=body.model_dump();return service.save(owner(request),p)
    @router.post("/projects/{pid}/training-runs",status_code=202)
    def start(pid:str,request:Request):return service.start(owner(request),pid)
    @router.post("/projects/{pid}/training-runs/cancel")
    def cancel(pid:str,request:Request):
        with service.lock:
            p=service.get(owner(request),pid)
            run=next((r for r in p["runs"] if r["status"]=="running"),None)
            if run and service.active==run["id"]:service.cancel_event.set()
            return {"requested":bool(run)}
    @router.post("/projects/{pid}/predictions")
    async def predict(pid:str,request:Request,record:bool=True):
        with service.lock:service.get(owner(request),pid)
        image=await request_image(request)
        try:return await run_in_threadpool(service.predict,owner(request),pid,image,record)
        finally:image.close()
    return router

def install_training(app,service):
    app.include_router(training_router(service))
    @app.middleware("http")
    async def workspace_cookie(request:Request,call_next):
        if not request.url.path.startswith("/api/v1/projects"):return await call_next(request)
        value=request.cookies.get("vision_workspace","")
        valid=bool(re.fullmatch(r"[0-9a-f]{64}",value))
        if not valid:value=secrets.token_hex(32)
        request.state.workspace_owner=hashlib.sha256(value.encode()).hexdigest()
        response=await call_next(request)
        if not valid:response.set_cookie("vision_workspace",value,max_age=31536000,httponly=True,samesite="lax",secure=request.url.scheme=="https",path="/api")
        response.headers["Cache-Control"]="no-store"
        return response
