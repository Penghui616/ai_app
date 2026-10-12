from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from backend.inference import FruitClassifier, ModelBusy, ModelUnavailable
from backend.model_spec import MODEL_ID

from backend.image_io import MAX_BYTES, MAX_PIXELS, TYPES, decode_image

def create_app(classifier=None, training_service=None):
    from backend.training import TrainingService, install_training
    training = training_service or TrainingService()
    engine=classifier if classifier is not None else FruitClassifier()
    @asynccontextmanager
    async def lifespan(app):
        await run_in_threadpool(engine.load)
        await run_in_threadpool(training.initialize)
        try:
            yield
        finally:
            await run_in_threadpool(training.close)
    app=FastAPI(title="AI实验室 · 图像分类体验",version="0.6.0",lifespan=lifespan)
    app.state.classifier=engine
    app.state.training=training
    install_training(app,training)

    @app.get("/api/health")
    async def health(): return {"status":"ok","modelStatus":engine.status}

    @app.get("/api/v1/experience/models")
    async def models(): return {"models":[engine.metadata()]}

    @app.post("/api/v1/experience/models/{model_id}/predict")
    async def predict(model_id:str, request:Request):
        if model_id!=MODEL_ID: raise HTTPException(404,"模型不存在。")
        media_type=request.headers.get("content-type","").split(";")[0].strip().lower()
        if media_type not in TYPES: raise HTTPException(415,"请上传 JPG、PNG 或 WebP 格式的图片。")
        length=request.headers.get("content-length")
        if length:
            try: size=int(length)
            except ValueError: raise HTTPException(400,"请求长度无效。")
            if size>MAX_BYTES: raise HTTPException(413,"单张图片不能超过 5 MB。")
        content=bytearray()
        async for chunk in request.stream():
            if len(content)+len(chunk)>MAX_BYTES: raise HTTPException(413,"单张图片不能超过 5 MB。")
            content.extend(chunk)
        if not content: raise HTTPException(422,"请提供图片内容。")
        image=await run_in_threadpool(decode_image,bytes(content),media_type)
        try:
            result=await run_in_threadpool(engine.predict,image)
            return JSONResponse(result,headers={"Cache-Control":"no-store"})
        except ModelUnavailable: raise HTTPException(503,"分类模型未就绪，请稍后重试或检查后端。")
        except ModelBusy: raise HTTPException(429,"模型正在处理其他画面，请稍后重试。",headers={"Retry-After":"1"})
        finally: image.close()
    return app

app=create_app()
