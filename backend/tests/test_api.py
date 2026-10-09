from io import BytesIO
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from backend.app import create_app, MAX_BYTES, decode_image
from backend.inference import FruitClassifier, ModelBusy, ModelUnavailable
from backend.model_spec import LABELS_ZH, MODEL_ID, REVISION

class StubClassifier:
    status="ready"
    def load(self): pass
    def metadata(self): return {"id":MODEL_ID,"status":self.status}
    def predict(self,image): return {"size":image.size,"mode":image.mode}

def png(color="red",size=(40,30)):
    output=BytesIO();Image.new("RGB",size,color).save(output,format="PNG");return output.getvalue()

@pytest.fixture
def client():
    with TestClient(create_app(StubClassifier())) as client: yield client

def test_health_and_model_listing(client):
    assert client.get("/api/health").json()["modelStatus"]=="ready"
    assert client.get("/api/v1/experience/models").json()["models"][0]["id"]==MODEL_ID

def test_valid_image_decoding(client):
    result=client.post(f"/api/v1/experience/models/{MODEL_ID}/predict",content=png(),headers={"content-type":"image/png"})
    assert result.status_code==200
    assert result.json()=={"size":[40,30],"mode":"RGB"}
    assert result.headers["cache-control"]=="no-store"

@pytest.mark.parametrize("body,mime,code",[(b"","image/png",422),(b"broken","image/jpeg",422),(b"text","text/plain",415),(png(),"image/jpeg",415),(b"a"*(MAX_BYTES+1),"image/png",413)],ids=["empty","corrupt","unsupported-type","mismatched-format","oversized"])
def test_rejects_bad_uploads(client,body,mime,code):
    assert client.post(f"/api/v1/experience/models/{MODEL_ID}/predict",content=body,headers={"content-type":mime}).status_code==code

def test_unknown_model(client):
    assert client.post("/api/v1/experience/models/missing/predict",content=png(),headers={"content-type":"image/png"}).status_code==404

@pytest.mark.parametrize("exception,code",[(ModelBusy,429),(ModelUnavailable,503)])
def test_service_failures(exception,code):
    class Failed(StubClassifier):
        def predict(self,image): raise exception()
    with TestClient(create_app(Failed())) as client:
        result=client.post(f"/api/v1/experience/models/{MODEL_ID}/predict",content=png(),headers={"content-type":"image/png"})
        assert result.status_code==code
        if code==429: assert result.headers["retry-after"]=="1"

def test_exif_orientation():
    output=BytesIO();source=Image.new("RGB",(20,40));exif=source.getexif();exif[274]=6
    source.save(output,format="JPEG",exif=exif)
    assert decode_image(output.getvalue(),"image/jpeg").size==(40,20)

def test_pixel_limit(monkeypatch,client):
    monkeypatch.setattr("backend.app.MAX_PIXELS",100)
    assert client.post(f"/api/v1/experience/models/{MODEL_ID}/predict",content=png(),headers={"content-type":"image/png"}).status_code==413

def test_real_model_inference_and_concurrency_gate():
    engine=FruitClassifier();engine.load()
    assert engine.status=="ready",engine.error
    assert len(engine.labels)==36
    first=engine.predict(Image.new("RGB",(224,224),"red"))
    second=engine.predict(Image.new("RGB",(224,224),"green"))
    assert first["isMock"] is False and first["modelVersion"]==REVISION
    assert len(first["scores"])==5 and first["scores"]!=second["scores"]
    assert all(item["name"] in LABELS_ZH and 0<=item["score"]<=1 for item in first["scores"])
    assert first["scores"]==sorted(first["scores"],key=lambda item:item["score"],reverse=True)
    assert sum(item["score"] for item in first["scores"])<=1.00001
    with engine._gate:
        with pytest.raises(ModelBusy): engine.predict(Image.new("RGB",(224,224)))
