# 语音合成体验：Qwen Realtime

入口：应用体验 → 语音合成体验，`/#/tts`。

## 功能

- 古诗词、英语角、小故事、绕口令各三条素材；分类切换不覆盖文字，点击篇目才填入。文本上限 100 个 Unicode 字符。
- 六种音色：明亮女声 · 芊悦（Cherry）、温柔女声 · 苏瑶（Serena）、活力男声 · 晨煦（Ethan）、新闻播报男声 · 阿闻（Neil）、美式英语女声 · 詹妮弗（Jennifer）、美式英语男声 · 艾登（Aiden）。默认 Cherry。
- 语速和音调 0.5–2.0，音量 0–100，分别提交 speech_rate、pitch_rate、volume。调整后需重新合成，不是播放器变速。实际音调调整也可能改变时长，不能承诺两个参数互不影响。
- 合成后试听、暂停、进度拖动、重新播放、WAV 下载。下载与试听使用相同音频；播放器自身音量仅影响本机播放。
- 修改文字、音色或参数后，旧音频不可试听或下载，需重新合成。生成中禁止重复提交；支持取消等待、重置、离页清理、错误提示和服务状态重查。
- 页面刷新或离开会释放音频，平台不保存文字和音频历史。先下载再离开。

## 配置与启用

本机已安装 websockets==15.0.1，已加入 backend/requirements.txt。其他机器需安装项目依赖。

后端使用固定官方中国内地端点：
`wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-tts-flash-realtime`。

复用 backend/.env.agent 的 DASHSCOPE_API_KEY；优先级为 TTS_API_KEY → SPEECH_API_KEY → DASHSCOPE_API_KEY，可在该文件或进程环境配置。密钥不发给浏览器，不打印。不复用文字模型的 HTTP Base URL。

**启用新接口需要重启现有后端**（有训练任务先等待完成），然后刷新 /#/tts。可通过 /api/tts/status 检查是否加载新版本；available 只表示已配置密钥，不代表账户额度和权限经在线认证。当前开发没有启动或重启正式后端，因为其启动过程涉及公司 MySQL。

## 接口

- GET /api/tts/status：available、busy、model、voices、maxCharacters、message。不联网、不返回凭据。
- POST /api/tts/synthesize：JSON {text, voice, speed, pitch, volume}，返回 audio/wav，Cache-Control: no-store。
- 前后端均校验文字和参数。请求体最多 4096 字节，上传超时 10 秒；WebSocket 连接超时 10 秒，完整合成截止 75 秒；前端请求截止 95 秒。
- 使用 session.update 等待确认，发送文本与 session.finish，接收 PCM 片段，确认 response.done completed 及 session.finished 后封装 24kHz、16-bit 单声道 WAV。只有完整成功的音频可以交付，不下载外部 URL、不做本地变速变调。
- 音频内存上限 120 秒 PCM，WebSocket 单消息和事件总数有上限，断连、鉴权、限流、格式异常均显示脱敏提示。不自动重试付费请求。
- 单进程同时一个合成任务、每分钟最多 10 个受理请求。取消等待不保证上游停止或免计费，任务实际完成前保留名额。不使用公司数据库。
- 这是本地开发原型；公开部署前仍需统一用户鉴权、用户额度和多人并发测试，当前限流不是完整的公开服务防护。

## 验证（2026-10-19）

- 默认隔离后端共 140 项通过，其中新增合成测试 36 项；验证参数、六种音色、协议、WAV、错误脱敏、部分音频拒绝、取消后名额保持、限流和输入边界。
- 类型检查、生产构建及 49 项合成页浏览器检查通过。浏览器测试拦截全部 API，不是真实模型测试；涵盖素材、参数提交、音频播放/下载、过期音频、重复点击、取消与重置、URL释放及窄屏布局。
- 真实百炼共 12 次：六种音色各一次，另做语速、音调、音量各两次对照，均返回有效 WAV。输入仅程序内置示例文字，未读取学生数据。
- 默认 Cherry 示例 5.2 秒，调用约 2.42 秒；其余调用约 1.9–2.63 秒。只是本机少量样例，不代表服务延迟承诺。
- 同句中文：语速 .7 / 1.5，音频 8.281 / 3.276 秒；音调 .7 / 1.4，粗略基频中位数 181.8 / 338.0 Hz，同时音频时长也改变；音量 25 / 90，归一化 RMS .01736 / .05328。基频为自相关粗估，单次生成存在随机差异，不是严格音质评分或参数线性校准。
- 没有完成人工听感、多音字/古诗准确性、课堂环境或多人并发验收。真实音频和结果在开发工作区 tts-backend/live-results，未加入仓库。

```powershell
.\backend\.venv\Scripts\python.exe -B scripts/test_backend_isolated.py
.\node_modules\.bin\tsc.cmd --noEmit --incremental false
node scripts/test_tts_frontend.mjs
git diff --check
```

官方接口：https://help.aliyun.com/zh/model-studio/qwen-tts-realtime-client-events
服务端协议：https://help.aliyun.com/zh/model-studio/qwen-tts-realtime-server-events

没有自动提交或推送 Git。
