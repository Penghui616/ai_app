# 图像实验室前端

React + TypeScript + Vite + Ant Design + ECharts。源代码位于本目录。

## 当前范围
- 项目创建、重命名、打开、删除。
- 类别管理、批量图片上传、预览和删除。
- 训练参数、模拟训练进度、曲线、取消、历史记录。
- 上传测试图片与模拟预测结果。
- IndexedDB 保存当前浏览器的项目和图片预览副本。
- 导出 JSON 实验记录，不包含真实模型权重。

**没有后端、没有真实训练、没有真实预测、没有账号或云端同步。**
训练曲线与预测分数明确标为模拟。预测结果与图片语义无关。
刷新页面会停止尚未完成的演示任务，记录恢复为已取消；真实后端接入后需改为查询服务器任务。
图片只在本地解码并保存最长边 1024 像素的 JPEG 预览副本，后端阶段应保留原始训练数据。
清理浏览器站点数据会删除本地项目。不同浏览器、不同域名不共享数据。

## 运行
需要 Node.js 22.12+ 或 24，以及 pnpm。
```sh
pnpm install
pnpm dev
```
浏览器打开终端提示的本地地址。默认 http://127.0.0.1:5173/ 。

```sh
pnpm build
pnpm preview
pnpm test
```

## 结构
- `src/App.tsx`：项目管理和三栏工作台。
- `src/components/TrainingMonitor.tsx`：训练监控弹窗和 ECharts。
- `src/types.ts`：项目、样本、任务与预测类型。
- `src/services/contracts.ts`：前端使用的 API 接口。
- `src/services/api.ts`：实现切换入口。
- `src/services/mockApi.ts`：明确标注的前端模拟实现。
- `src/services/repository.ts`：IndexedDB 本地持久化。
- `src/services/images.ts`：图片校验和本地预览处理。
- `docs/API-CONTRACT.md`：后续 FastAPI 对接建议。

## 后续架构
后端使用 FastAPI + Pydantic；公司 MySQL 配合 SQLAlchemy/Alembic；图片和模型存对象存储；Linux Celery worker + Redis 执行真实长任务；PyTorch + torchvision 完成图像训练。当前前端不包含这些服务，也不使用浏览器中的模拟结果替代真实结果。

## 演示边界
每项目最多 8 类、200 张图片；单次上传 50 张，单张不超过 5 MB。演示只要求每类至少一张，**不意味着该数量足以真实训练**。
一次只运行一个模拟训练。改变样本或标签会使当前预测入口失效，需重新演示训练。
记录只保留最近 12 次模拟任务。

Sites 私有预览仅托管静态前端，不代替未来公司的 FastAPI/MySQL 部署。

## 实验助手面板（v0.2）
- 工作台右下角打开；样本、训练和测试区分别提供情境求助入口。
- 当前为**确定性预设回复演示，没有连接大模型或 LangGraph**，不执行外部请求。
- 读取当前项目类别、样本数量、数据版本和模拟运行状态；不读取图片内容，不根据模拟指标诊断模型效果。
- 对话按项目保存在本机 localStorage，保留最近 20 轮；回答依据保留当时快照。清空辅导记录不影响项目和图片。
- 浏览器存储失败会提示；记录不随 Git 保存，不属于现有实验 JSON 导出内容。清理站点数据会删除记录。
- `src/components/ExperimentAssistant.tsx`：共用面板与对话交互。
- `src/services/assistant.ts`：图像实验摘要、预设演示回复和本地对话存储。
- 后续由 FastAPI 查询有权限的真实实验记录，并由 Agent 按需调用只读工具；不要把前端传来的摘要作为服务端可信事实。真实实现需增加异步流式消息、停止、失败重试以及服务端消息持久化。

## 本次版本保存
- `v0.1-classification-frontend`：添加助手前的稳定前端。
- `codex/experiment-assistant`：实验助手开发分支。
- `v0.2-assistant-panel`：助手面板验证通过后的版本标签。
- 查看旧版本前先保留当前未提交修改；不要使用破坏性重置覆盖工作。浏览器数据不会随代码版本自动恢复。
