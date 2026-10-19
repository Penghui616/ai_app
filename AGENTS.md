# AI 应用实验平台：项目开发约定

本文件适用于整个仓库。当前采用 ECC 轻量流程：理解改动 → 实现 → 针对性审查与验证 → 报告结果。不是每次都运行全套流程。

## 当前实现与目录

- 前端：React、TypeScript、Vite、Ant Design、ECharts。`src/App.tsx` 是实验工作台；`src/components/` 包含应用目录、分类体验、摄像头、训练监控和助手面板。
- `src/services/httpApi.ts`、`agentApi.ts` 对接真实后端；`contracts.ts`、`src/types.ts` 定义前端契约。`mockApi.ts` 是历史演示实现，不是后端故障回退。
- 后端：FastAPI、Pydantic、SQLAlchemy、MySQL；`backend/app.py` 组装服务；`training.py` 管理训练与预测；`training_store.py` 持久化；`learning.py` 提取特征与划分样本。
- 图像体验：本地 36 类果蔬预训练模型。图像实验：冻结 MobileNetV3 Large，缓存特征，仅训练分类层；固定种子 42。单进程原型，尚无课堂并发验证。
- 实验助手：`agent.py` 编排；`agent_context.py` 解析实验编号；`agent_tools.py` 提供六个只读工具；`agent_provider.py` 对接百炼文字模型；`agent_store.py` 保存项目对话和笔记。无 LangChain/LangGraph。
- `backend/tests/` 是 pytest；`tests/` 是 Playwright。`docs/API-CONTRACT.md`、`backend/AGENT-TUTOR.md` 是接口与助手说明。旧文档中的历史交付状态可能过期，以代码和实际验证为准。
- 图片、特征、分类层模型位于 `backend/data/`，预训练权重位于 `backend/models/`，均不进 Git。语音识别体验已接入百炼 qwen3-asr-flash，入口 /#/speech；翻译等应用尚未交付。

## 开工与 ECC 使用

1. 先检查 `git status --short --branch` 和相关代码、测试；保留用户未提交修改，不碰无关文件。
2. 只为当前任务读取相关技能：Python 使用 `python-patterns` / `python-testing`，前端使用 `coding-standards` / `react-patterns`，API 使用 `fastapi-patterns` / `api-design`。按需审查，不批量加载技能。
3. 修改前说明范围和验收条件；复杂改动先列简短步骤，简单文案修改直接执行。
4. 保留现有风格；Python 新增代码采用明确类型、明确异常边界；TypeScript 保持类型约束，不用 `any` 掩盖接口差异。不要为遵守通用风格大面积重写旧代码。
5. 审查改动的行为、边界与调用方，重点检查 API 字段、项目归属、异步过期响应、资源释放、模型与数据版本一致性。
6. 不自动启动多代理、不自动提交或推送、不新增 MCP、不信任或启用 Hooks。需要这些动作时遵循用户后续明确指令。
7. ECC 已作为 Codex 原生插件安装；不要再复制插件组件或运行旧版同步安装。此文件是项目工作约定，不是假定存在的 ECC“轻量模式”开关。

## 数据与真实行为边界

- 不读取、输出或提交 `backend/.env`、`backend/.env.agent` 及其他实际密钥文件，不打印环境变量或包含凭据的连接串。
- 不连接、建表、迁移或清理公司数据库。普通后端启动会读取配置并可能初始化数据库；除非用户明确授权，不把启动正式服务当作测试步骤。
- 助手只能查询当前授权项目，不生成 SQL、不执行代码、不自动修改参数或发起训练。前端操作状态是辅助信息，不替代后端事实。
- 大模型只接收必要文字摘要，不发送照片、Base64 或整个数据集。
- 第 1 次实验是最早的训练；失败/取消同样占编号。页面倒序显示不改变编号。训练轮数 epoch 与实验次数不同。
- 分析曲线必须获取对应记录的曲线；比较实验必须检查完整参数、数据版本、样本划分、种子和可用的模型信息，不凭历史笔记推断。
- `sameSplit` / `comparable` 等字段不是“所有条件一致”的证明；缺失信息须明确说明。预测分数不是实际准确率；没有正确标签不能声称测试正确。
- 小样本验证集 100% 不代表泛化达标，不能仅凭一两次训练或 3–5 张测试图宣称“显著优于”。
- 保留真实模式的错误提示，不静默回退为模拟指标。修改数据或标签后旧模型失效的规则不能丢失。

## 启动命令（供人工开发，当前配置任务不执行）

以下在项目根目录的 PowerShell 中运行；依赖已安装时：

```powershell
# 终端一：会使用本机数据库和助手配置，需获得相应授权
.\启动后端.cmd
# 终端二
pnpm.cmd dev
```

页面：`http://127.0.0.1:5173/#/apps`，实验页 `/#/training`。后端端口 8000。
首次环境安装见 `backend/README.md` / `backend/TRAINING.md`；不要在普通改动中自动安装依赖或下载模型。

## 验证选择

| 修改范围 | 最小验证 |
| --- | --- |
| 文档、开发约定 | 链接、命令与代码对应关系，`git diff --check` |
| 简单文案/样式 | `pnpm.cmd build`，查看受影响页面；不为纯样式机械添加测试 |
| Agent 编号、工具、对话 | 下方隔离助手测试，加 `docs/AGENT-REGRESSION.md` 对应用例 |
| 训练、存储、API | 隔离训练/API 测试；涉及持久化、取消、模型失效时保留对应覆盖 |
| 前后端契约/多页面交互 | 构建和相关 Playwright；先确认测试进程不会读取真实配置 |

```powershell
# 推荐：禁止 dotenv、外部网络和非临时 SQLite 的测试入口
.\backend\.venv\Scripts\python.exe scripts/test_backend_isolated.py
# 训练与 API：需本机已有权重，不自动下载
.\backend\.venv\Scripts\python.exe scripts/test_backend_isolated.py backend/tests/test_training.py backend/tests/test_api.py -q
# 所有后端测试
.\backend\.venv\Scripts\python.exe scripts/test_backend_isolated.py backend/tests -q
pnpm.cmd build
git diff --check
```

`pnpm.cmd test` 对应 `playwright.real.config.ts`，会启动 8001 / 5174 隔离服务，使用 SQLite、模拟摄像头和助手替身；“real”不代表真实 Qwen。现有子进程仍会导入 dotenv 模块，**未确认配置隔离前不要在禁止读取密钥的任务中运行**。本次不改变其实现。不要对运行在 8000 / 5173 的公司库实例执行自动化写入测试。

## 交付与版本

- 报告改动文件、测试命令、通过/失败/跳过数和未验证事项。缺权重导致跳过不能写成训练已验证。
- 模拟模型测试、真实模型推理/训练、真实 Qwen 回答质量、真实摄像头、课堂试用是不同证据，分别报告。
- 真实 Qwen 验收按 `docs/AGENT-REGRESSION.md` 执行；本次不读取密钥、不发起付费调用。
- 不自动提交或 push；用户要求保存版本时检查差异和敏感文件，再按授权范围执行。代码回退不等于数据库、图片或浏览器记录回退。

## 语音识别体验

- backend/speech.py 提供独立语音接口，speech_audio.py 有界解码，speech_provider.py 调用官方百炼；不读写项目数据库。
- 音频通过后端上传百炼，参考朗读材料不作为模型输入；不保存录音或转写历史。不能将助手文字请求与音频数据混用。
- 仅运行隔离测试和合成音频验证；真实百炼调用需用户授权程序加载配置，禁止打印密钥。
- 默认隔离后端测试已包含语音用例；前端回归运行 node scripts/test_speech_frontend.mjs，仅启动隔离预览并拦截 API。详见 docs/SPEECH-EXPERIENCE.md。

## 语音合成体验

- 入口 /#/tts；backend/tts.py 与 tts_provider.py 独立于数据库，使用官方中国内地 qwen3-tts-flash-realtime。仅接收文字与六种白名单音色、语速/音调/音量，不保存历史。
- 返回完整 WAV；必须等待成功完成事件，不把半段音频当成功。取消等待后保持服务名额至上游结束；不自动重试付费调用。
- 复用 .env.agent 的百炼密钥，TTS_API_KEY 可覆盖。真实合成测试只允许程序加载配置，必须遵循用户授权；不得输出密钥或连接公司数据库。
- 默认隔离测试含 test_tts.py；node scripts/test_tts_frontend.mjs 为模拟接口的浏览器检查。真实声音生成与参数效果验证另行记录，不能互相替代。详见 docs/TTS-EXPERIENCE.md。
