from io import BytesIO
from pathlib import Path
import time
import threading
import json
import pytest
import torch
from PIL import Image, ImageDraw
from fastapi.testclient import TestClient
from backend.app import create_app
from backend.training import TrainingService
from backend.training_store import Store, now
from backend.learning import FeatureExtractor, WEIGHT_FILE
from backend.tests.test_api import StubClassifier

def sample(kind,index=0):
    im=Image.new("RGB",(256,256),(235+index%15,235,235))
    draw=ImageDraw.Draw(im)
    if kind==0:draw.ellipse((30+index,35,210,220-index),fill=(220,20+index,20))
    else:draw.rectangle((45,20+index,190-index,235),fill=(20,35+index,220))
    out=BytesIO();im.save(out,"PNG");return out.getvalue()

@pytest.fixture
def service(tmp_path):
    s=TrainingService(Store("sqlite:///"+str(tmp_path/"test.sqlite")),tmp_path/"data")
    return s
@pytest.fixture
def client(service):
    with TestClient(create_app(StubClassifier(),service)) as client:yield client

def create(client):
    result=client.post("/api/v1/projects",json={"name":"形状分类"});assert result.status_code==201,result.text
    return result.json()
def seed(client,p):
    for label,c in enumerate(p["classes"]):
        for i in range(5):
            r=client.post(f"/api/v1/projects/{p['id']}/classes/{c['id']}/samples?name={label}-{i}.png",content=sample(label,i),headers={"content-type":"image/png"})
            assert r.status_code==200,r.text
    return client.get(f"/api/v1/projects/{p['id']}").json()
def await_run(client,pid,timeout=30):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        r=client.get(f"/api/v1/projects/{pid}").json()["runs"][0]
        if r["status"]!="running":return r
        time.sleep(.05)
    pytest.fail("Training did not finish")

def test_project_constraints_and_owner_isolation(client):
    p=create(client);pid=p["id"];c=p["classes"][0];base=f"/api/v1/projects/{pid}"
    assert client.delete(base+f"/classes/{c['id']}").status_code==409
    assert client.patch(base+f"/classes/{c['id']}",json={"name":"类别2"}).status_code==409
    assert client.post(base+"/training-runs").status_code==422
    assert client.put(base+"/params",json={"epochs":0}).status_code==422
    assert client.put(base+"/params",json={"optimizer":"invalid"}).status_code==422
    r=client.post(base+f"/classes/{c['id']}/samples",content=sample(0),headers={"content-type":"image/png"});assert r.json()["added"]==1
    r2=client.post(base+f"/classes/{c['id']}/samples",content=sample(0),headers={"content-type":"image/png"});assert r2.json()["added"]==0
    assert client.post(base+f"/classes/{p['classes'][1]['id']}/samples",content=sample(0),headers={"content-type":"image/png"}).status_code==409
    image_url=r.json()["project"]["classes"][0]["samples"][0]["dataUrl"]
    assert client.get(image_url).status_code==200
    cookie=client.cookies.get("vision_workspace");client.cookies.clear()
    assert client.get(base).status_code==404
    assert client.get(image_url).status_code==404
    client.cookies.set("vision_workspace",cookie)
    assert client.get(base).status_code==200
    assert client.delete(base).status_code==200
    assert client.get(image_url).status_code==404

@pytest.mark.skipif(not WEIGHT_FILE.exists(),reason="Download the official MobileNet weights first")
def test_real_training_prediction_persistence_and_invalidation(client,service,tmp_path):
    p=seed(client,create(client));base=f"/api/v1/projects/{p['id']}"
    assert client.put(base+"/params",json={"epochs":20,"learningRate":.01,"optimizer":"AdamW","batchSize":4}).status_code==200
    started=client.post(base+"/training-runs");assert started.status_code==202,started.text
    run=await_run(client,p["id"])
    assert run["status"]=="completed",run
    assert run["isMock"] is False and len(run["metrics"])==20
    assert len(run["trainSampleIds"])==8 and len(run["validationSampleIds"])==2
    assert not set(run["trainSampleIds"])&set(run["validationSampleIds"])
    assert run["metrics"][-1]["trainLoss"]<run["metrics"][0]["trainLoss"]
    assert all(not param.requires_grad for param in service.extractor.model.parameters())
    for label in [0,1]:
        result=client.post(base+"/predictions",content=sample(label,12),headers={"content-type":"image/png"})
        assert result.status_code==200,result.text
        pred=result.json();assert pred["isMock"] is False
        assert max(pred["scores"],key=lambda s:s["score"])["classId"]==p["classes"][label]["id"]
        assert abs(sum(s["score"] for s in pred["scores"])-1)<1e-5
    stored=client.get(base).json();assert len(stored["predictions"])==2
    # Reload only persisted classifier tensors and a fresh backbone instance.
    service.extractor=FeatureExtractor()
    assert client.post(base+"/predictions?record=false",content=sample(0,15),headers={"content-type":"image/png"}).status_code==200
    assert len(client.get(base).json()["predictions"])==2
    cache=list((service.root/"features").glob("*.safetensors"));assert len(cache)==10
    assert client.patch(base+f"/classes/{p['classes'][0]['id']}",json={"name":"红色圆形"}).status_code==200
    assert client.post(base+"/predictions",content=sample(0),headers={"content-type":"image/png"}).status_code==409

class SlowFeatures:
    def __init__(self):self.entered=threading.Event();self.release=threading.Event()
    def cached(self,*args):
        self.entered.set();self.release.wait(10);return torch.ones(8)

def test_cancellation_edit_lock_and_single_training(client,service):
    p=seed(client,create(client));base=f"/api/v1/projects/{p['id']}"
    slow=SlowFeatures();service.extractor=slow
    assert client.post(base+"/training-runs").status_code==202
    assert slow.entered.wait(5)
    assert client.post(base+"/classes").status_code==409
    assert client.delete(base).status_code==409
    assert client.post(base+"/training-runs").status_code==409
    assert client.post(base+"/training-runs/cancel").json()["requested"]
    slow.release.set();r=await_run(client,p["id"])
    assert r["status"]=="cancelled"
    assert client.post(base+"/predictions",content=sample(0),headers={"content-type":"image/png"}).status_code==409
    assert client.post(base+"/classes").status_code==200

def test_restart_recovers_interrupted_jobs_and_keeps_records(service):
    service.initialize();p=service.create("owner","保存验证")
    service.store.save_run(dict(id="run-test",projectId=p["id"],status="running",startedAt=now(),metrics=[]))
    service.close()
    resumed=TrainingService(Store("sqlite:///"+str(service.root.parent/"test.sqlite")),service.root)
    resumed.initialize()
    try:
        p=resumed.get("owner",p["id"]);assert p["name"]=="保存验证"
        assert p["runs"][0]["status"]=="failed" and "重启" in p["runs"][0]["message"]
    finally:resumed.close()

def test_training_storage_unconfigured_does_not_break_experience(monkeypatch,tmp_path):
    monkeypatch.delenv("MYSQL_DATABASE",raising=False);monkeypatch.delenv("MYSQL_USER",raising=False)
    svc=TrainingService(Store(),tmp_path)
    with TestClient(create_app(StubClassifier(),svc)) as client:
        assert client.get("/api/v1/training/status").json()["status"]=="unavailable"
        assert client.get("/api/v1/projects").status_code==503
        assert client.get("/api/health").json()["modelStatus"]=="ready"
