# 果蔬分类体验后端

FastAPI + PyTorch CPU + Transformers。只实现预训练模型推理，分类实验的训练和助手仍为前端演示。

## 首次安装（Windows，项目根目录）
需要 Python 3.12，首次安装依赖和下载权重需要网络。
```powershell
py -3.12 -m venv backend/.venv
./backend/.venv/Scripts/python.exe -m pip install torch==2.7.1 --index-url https://download.pytorch.org/whl/cpu
./backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
./backend/.venv/Scripts/python.exe -m backend.download_model
```
下载约 95 MB 的 safetensors 权重，并保存固定版本的配置和 SHA256 清单。虚拟环境与模型文件不入 Git；复制项目到其他电脑需重新安装与下载。

## 日常启动
在项目根目录运行：
```powershell
./backend/start.ps1
```
或使用等效命令：
```powershell
./backend/.venv/Scripts/python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --no-access-log
```
在另一个终端运行 `pnpm dev`，打开 http://127.0.0.1:5173/#/experience 。Vite 的 /api 代理连接本机 8000 端口。停止后端使用 Ctrl+C。

健康状态：http://127.0.0.1:8000/api/health ，模型正常时 modelStatus 为 ready。
接口文档：http://127.0.0.1:8000/docs 。模型缺失或校验失败时模型状态为 error，重新下载后重启。

## 模型与使用边界
- 来源：https://huggingface.co/jazzmacedo/fruits-and-vegetables-detector-36
- 固定版本：a84824cd6c10eed4defb83d373b4377c85c1cf73。
- 模型仓库标注 Apache-2.0；本地下载保留上游模型卡。
- 启动校验哈希，仅从本地 safetensors 加载，不执行远程模型代码。
- 仅识别其预设 36 类，建议每次将一个果蔬主体置于画面中央。不是目标检测器，不会给多个物体画框。
- 非果蔬也会被分入既有类别；分数不是准确率，低置信度提示不是未知物体检测。
- 每次只执行一个推理，忙时返回 429。当前为本机单进程版本，尚未完成课堂并发容量测试。
- 图片和摄像头帧发送本机后端，后端不保存；记录仍保存在浏览器，未接 MySQL。
- 尚未提供账号鉴权和云端部署。云端部署需要 HTTPS、同源 API 反向代理及相应访问控制。
- 可用 VISION_MODEL_DIR 指定模型目录，VISION_TORCH_THREADS 调节 CPU 线程数（1–4，默认 2）。

## 验证
```powershell
./backend/.venv/Scripts/python.exe -m pytest backend/tests -q
pnpm build
pnpm test
```
前端测试需要前后端都启动，并使用 playwright.config.ts 中配置的 Edge。摄像头测试使用模拟设备，不能代替真实 USB 摄像头验收。
后端测试包括图片格式/体积校验、错误状态及真实模型推理；真实模型测试需要先完成权重下载。
