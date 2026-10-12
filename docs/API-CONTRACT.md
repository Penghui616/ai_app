# FastAPI 接口与后续对接约定

分类实验的模拟调用集中在 src/services/contracts.ts 与 api.ts；体验页通过 src/services/experience.ts 调用以下真实接口。

## 已实现：图像分类体验（v0.5）

| 操作 | 接口 |
| --- | --- |
| 健康与模型状态 | GET /api/health |
| 可用模型与 36 个类别 | GET /api/v1/experience/models |
| 真实分类 | POST /api/v1/experience/models/fruit-veg-36/predict |

预测请求体是图片二进制，Content-Type 为 image/jpeg、image/png 或 image/webp，不是 multipart 或 JSON。限制 5 MB、2000 万像素和静态图片，校验实际格式并处理 EXIF 方向。

响应示例（数值仅用于说明结构）：
```json
{"modelId":"fruit-veg-36","modelVersion":"a84824cd6c10eed4defb83d373b4377c85c1cf73","isMock":false,"scores":[{"id":0,"name":"apple","label":"苹果","score":0.95}],"latencyMs":130.0,"uncertain":false,"notice":"仅支持预设的36类果蔬。非果蔬或多物体画面也可能被误分；分数不等于准确率。"}
```
实际 scores 返回前五名，取值 0–1。uncertain 仅表示最高分低于 0.6，不等于可靠的未知类别检测。响应禁止缓存；后端不保存图片和预测记录。

错误：404 模型不存在；413 超限；415 格式不支持或与内容不符；422 损坏或空图片；429 模型忙（Retry-After: 1）；503 模型未就绪。FastAPI 错误信息在 detail 字段。

前端 /api 在 Vite 开发环境代理到 127.0.0.1:8000。体验记录仍在 IndexedDB；历史模拟记录保留 isMock=true，真实记录包含模型版本且 isMock=false。当前没有账号、数据库或云端部署。

## 建议资源与路径

| 操作 | 建议接口 |
| --- | --- |
| 获取项目列表 | GET /api/v1/projects |
| 创建项目 | POST /api/v1/projects |
| 获取项目 | GET /api/v1/projects/{project_id} |
| 重命名 / 删除 | PATCH / DELETE /api/v1/projects/{project_id} |
| 类别增删改 | /api/v1/projects/{project_id}/classes |
| 上传图片 | POST /api/v1/projects/{project_id}/classes/{class_id}/samples |
| 删除图片 | DELETE /api/v1/projects/{project_id}/samples/{sample_id} |
| 创建训练任务 | POST /api/v1/projects/{project_id}/training-runs |
| 查询训练任务 | GET /api/v1/training-runs/{run_id} |
| 请求取消 | POST /api/v1/training-runs/{run_id}/cancel |
| 预测 | POST /api/v1/projects/{project_id}/predictions |
| 获取导出记录 | GET /api/v1/projects/{project_id}/export |

这些路径是待确认约定，当前不提供对应服务器。增加真实实现时由 OpenAPI 生成前端类型，并替换 api.ts 的注入实现。

## 对接必需语义
- 项目、类别、样本、训练任务均使用稳定 ID，显示名不作存储键。
- 后端鉴权并验证每个项目及资源的归属；不能信任浏览器传来的用户 ID。
- 前端照片预览与原始训练数据分开；对象存储负责文件，MySQL 记录元数据。
- 训练请求返回任务 ID，不等待训练完成。任务状态应包含 queued/running/completed/failed/cancelled。
- 当前 mock 没有真实排队状态，接入后应补充 queued 和服务端取消确认的交互。
- 任务固定数据版本、预处理、类别顺序、参数及模型版本。
- 完成任务返回独立训练/验证/测试结果，不把模拟记录上传为真实训练数据。
- 预测返回 model_version、class_id、class_name 和 score；不能将单张预测分数称为整体准确率。
- 参数异常、资源不存在、权限不足、配额不足、任务冲突分别有明确错误码。
- 当前页关闭中断模拟任务；真实任务在服务器执行，刷新后重新查询，不能取消服务器任务。
- 训练、实时推理、远程大模型 API 是不同执行方式，共享项目和运行记录，不强行共用图像训练的数据结构。

## WebMCP
浏览器支持 document.modelContext 时注册两个可选工具：
- list_classification_projects：只读项目摘要。
- create_classification_project：创建并打开本地演示项目。
缺少该浏览器 API 时自动跳过，不影响普通 UI。

## 摄像头接入边界（历史 v0.4；体验页已在 v0.5 改为真实 HTTP 推理）
- CameraPanel 在明确点击开启后获取仅含 video 的 MediaStream。采样通过 canvas 生成 JPEG File，复用 addImages；实时校验读取压缩 JPEG data URL 并复用 predict，目前仍走本机模拟接口。
- 一次只提交一个实时预测，完成后等待 500ms 再取下一帧；暂停、切换或离开时停止取帧并丢弃过期响应。后续 HTTP 实现还应传递 AbortSignal，限制图像尺寸、请求频率和超时。
- 服务端需绑定实际模型版本和类别顺序，校验样本版本。体验应用使用预训练模型，不依赖学生训练项目；训练应用须有当前项目的有效模型。
- 视频帧不会自动写入实验记录或数据集。样本仅在拍摄/连续采集时保存；体验页仅在定格并记录时保存一张快照。
- 当前不提供模型导出、硬件部署或外部实时结果推送，不能将 JSON 演示记录当成模型文件。

## 已实现 分类实验 v0.6
- GET /api/v1/training/status：数据库与权重状态。
- GET / POST /api/v1/projects；GET / PATCH / DELETE /api/v1/projects/{id}。
- POST /api/v1/projects/{id}/classes；PATCH / DELETE /api/v1/projects/{id}/classes/{classId}。
- POST /api/v1/projects/{id}/classes/{classId}/samples?name=文件名：JPEG/PNG/WebP 二进制，5 MB 上限，返回 added 与 project。
- DELETE /api/v1/projects/{id}/classes/{classId}/samples/{sampleId}；GET /api/v1/projects/{id}/samples/{sampleId}/image。
- PUT /api/v1/projects/{id}/params：完整参数，224 尺寸，epochs 1–100，batchSize 4/8/16/32/64，optimizer AdamW/SGD，learningRate 0.00001–1。
- POST /api/v1/projects/{id}/training-runs：202 返回后台任务；GET 项目轮询 stage、featureProgress、metrics 和状态。
- POST /api/v1/projects/{id}/training-runs/cancel：只表示请求取消，需继续查询最终状态。
- POST /api/v1/projects/{id}/predictions?record=true：原始图片，使用当前版本最近完成模型；文件预测保存最近 50 条，实时帧用 record=false。
真实训练包含 isMock=false、backbone、seed、trainSampleIds、validationSampleIds 和 metrics。模型版本为 runId。服务端使用 HttpOnly 工作区 cookie 检查归属。409 为冲突，503 为数据库或模型未就绪。无排队或模型导出接口，旧版建议路径中未列为实现的接口仍为设计。
