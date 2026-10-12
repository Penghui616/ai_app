from io import BytesIO
import warnings
from fastapi import HTTPException, Request
from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool
MAX_BYTES=5*1024*1024
MAX_PIXELS=20_000_000
Image.MAX_IMAGE_PIXELS=MAX_PIXELS
TYPES={"image/jpeg":"JPEG","image/png":"PNG","image/webp":"WEBP"}

def decode_image(data:bytes,media_type:str):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error",Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as source:
                if source.format!=TYPES[media_type]: raise HTTPException(415,"图片内容与文件格式不一致。")
                if source.width*source.height>MAX_PIXELS: raise HTTPException(413,"图片尺寸过大，请缩小后重试。")
                if getattr(source,"n_frames",1)>1: raise HTTPException(415,"请上传静态图片。")
                source.load()
                image=ImageOps.exif_transpose(source).convert("RGB")
        return image
    except HTTPException: raise
    except (Image.DecompressionBombError,Image.DecompressionBombWarning): raise HTTPException(413,"图片尺寸过大，请缩小后重试。")
    except (UnidentifiedImageError,OSError,ValueError): raise HTTPException(422,"图片损坏或无法读取，请更换图片。")


async def request_image(request:Request):
    mime=request.headers.get("content-type","").split(";")[0].strip().lower()
    if mime not in TYPES:raise HTTPException(415,"请上传 JPG、PNG 或 WebP 图片。")
    data=bytearray()
    async for chunk in request.stream():
        if len(data)+len(chunk)>MAX_BYTES:raise HTTPException(413,"单张图片不能超过 5 MB。")
        data.extend(chunk)
    if not data:raise HTTPException(422,"图片为空。")
    return await run_in_threadpool(decode_image,bytes(data),mime)
