# FastAPI 对接约定草案

当前全部调用集中在 src/services/contracts.ts 与 api.ts。UI 不直接访问 IndexedDB，也不自己生成模拟训练指标。

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
