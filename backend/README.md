# AI 应用实验平台后端

FastAPI + PyTorch CPU + Transformers + SQLAlchemy / MySQL。提供图像体验推理、分类实验训练、实验辅导助手、语音识别与语音合成。

| 模块 | 实现与说明 |
| --- | --- |
| 果蔬分类体验 | 本地 36 类预训练模型，安装与边界见本文 |
| 分类实验 | MobileNetV3 特征提取与分类层真实训练，见 [TRAINING.md](TRAINING.md) |
| 实验助手 | 百炼文字模型与项目只读工具，见 [AGENT-TUTOR.md](AGENT-TUTOR.md) |
| 语音识别 | 百炼 qwen3-asr-flash，见 [语音识别说明](../docs/SPEECH-EXPERIENCE.md) |
| 语音合成 | 百炼 qwen3-tts-flash-realtime，见 [语音合成说明](../docs/TTS-EXPERIENCE.md) |

语音服务自身不读写数据库，不需要本地语音模型或 GPU；但整个应用启动仍可能初始化配置中的 MySQL，请先确认数据库与授权。

## 首次安装（Windows，项目根目录）
需要 Python 3.12，首次安装依赖和下载权重需要网络。
```powershell
py -3.12 -m venv backend/.venv
./backend/.venv/Scripts/python.exe -m pip install torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cpu
./backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
./backend/.venv/Scripts/python.exe -m backend.download_model
```
上面的下载命令针对果蔬体验模型，约 95 MB，并保存固定版本配置与 SHA256 清单。分类实验还需运行：
```powershell
./backend/.venv/Scripts/python.exe -m backend.download_training_model
```
虚拟环境与模型文件不入 Git；复制项目到其他电脑需重新安装与下载。requirements.txt 已包含 requirements-speech.txt（音频解码）和 websockets（实时合成协议）依赖。

图像实验数据库按 [TRAINING.md](TRAINING.md) 配置；云端助手与语音按各模块文档配置本机 backend/.env.agent。不要提交实际配置文件。

## 日常启动
在项目根目录运行：
```powershell
.\启动后端.cmd
```
或使用等效命令：
```powershell
./backend/.venv/Scripts/python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --no-access-log
```
在另一个终端运行 `pnpm dev`，打开 http://127.0.0.1:5173/#/apps 。Vite 的 /api 代理连接本机 8000 端口。停止后端使用 Ctrl+C。

果蔬模型健康状态：http://127.0.0.1:8000/api/health ，模型正常时 modelStatus 为 ready。此状态不等于所有模块均可用。
语音识别状态：/api/speech/status；语音合成状态：/api/tts/status。语音配置状态不在线认证账号权限和额度，需实际调用成功后确认。
接口文档：http://127.0.0.1:8000/docs 。模型缺失或校验失败时模型状态为 error，重新下载后重启。

## 模型与使用边界
- 来源：https://huggingface.co/jazzmacedo/fruits-and-vegetables-detector-36
- 固定版本：a84824cd6c10eed4defb83d373b4377c85c1cf73。
- 模型仓库标注 Apache-2.0；本地下载保留上游模型卡。
- 启动校验哈希，仅从本地 safetensors 加载，不执行远程模型代码。
- 仅识别其预设 36 类，建议每次将一个果蔬主体置于画面中央。不是目标检测器，不会给多个物体画框。
- 非果蔬也会被分入既有类别；分数不是准确率，低置信度提示不是未知物体检测。
- 每次只执行一个推理，忙时返回 429。当前为本机单进程版本，尚未完成课堂并发容量测试。
- 果蔬体验图片不保存到服务器；体验记录仍在浏览器。分类实验样本和模型由后端保存，详见 TRAINING.md。
- 尚未提供账号鉴权和云端部署。云端部署需要 HTTPS、同源 API 反向代理及相应访问控制。
- 可用 VISION_MODEL_DIR 指定模型目录，VISION_TORCH_THREADS 调节 CPU 线程数（1–4，默认 2）。

## 验证

在项目根目录运行隔离测试入口，禁用 dotenv、外网和非临时 SQLite：
```powershell
./backend/.venv/Scripts/python.exe -B scripts/test_backend_isolated.py
./backend/.venv/Scripts/python.exe -B scripts/test_backend_isolated.py backend/tests -q
pnpm.cmd build
node scripts/test_speech_frontend.mjs
node scripts/test_tts_frontend.mjs
```
默认后端套件覆盖助手、语音识别与合成；完整后端测试中的真实图像模型用例需提前下载权重。模型替身测试不等于真实百炼效果验证。

pnpm.cmd test 使用 playwright.real.config.ts，在 8001 / 5174 启动测试服务；需本机 Edge 与对应权重。它不是对正式 8000 / 5173 服务执行测试。运行前按 [AGENTS.md](../AGENTS.md) 确认配置隔离，避免加载本机实际凭据。摄像头测试使用模拟设备，不能替代真实设备与课堂验收。
