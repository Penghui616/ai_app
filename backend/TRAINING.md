# 图像分类实验后端

## 当前交付与接入状态
已实现项目与样本接口、后台真实训练、模型保存与重载、图片和摄像头校验、训练取消及重启恢复。前端默认调用真实接口，不回退模拟结果。
公司 MySQL 连接尚未配置，也没有在公司服务器上执行建库或建表。自动化验证使用临时 SQLite 测试库；这只是测试替身，不是运行时数据库回退方案。MySQL 5.7 的实际连通性、权限和建表仍需在公司授权后验收。

## 公司数据库接入
1. 请公司确认本项目独立库的名称，示例为 vision_lab_dev，可位于公司现有 MySQL 服务器。
2. 授权管理员参考 backend/mysql-create.example.sql 建库，并创建仅访问该库的专用账号。示例不自动执行。权限为 SELECT、INSERT、UPDATE、DELETE、CREATE、INDEX，不需要全局管理员权限。
3. 双击根目录 配置数据库.cmd，输入主机、端口、已确认的库名、项目账号和密码。密码只在本机终端输入，不显示。本工具仅生成 backend/.env，不连接或建库。
4. 后端启动时在指定库内创建缺失的 vl_projects、vl_training_runs 两张表，不修改其他库。项目及样本元数据、参数和最近 50 条文件预测保存在项目 JSON 中；训练任务为独立记录。当前没有自动结构迁移。
5. MYSQL_SSL_CA 可指定 CA 文件，启用远程连接的证书与主机名校验。正式部署前确认网络权限、TLS 和备份。
配置示例见 backend/.env.example；真实 .env 已被 Git 忽略。未配置或连接失败时，训练状态返回 unavailable，项目接口返回 503，果蔬体验继续可用。

## 安装与启动
在项目根目录执行：
```powershell
.\backend\.venv\Scripts\python.exe -m pip install torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cpu
.\backend\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\backend\.venv\Scripts\python.exe -m backend.download_training_model
.\backend\.venv\Scripts\python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --no-access-log
```
也可双击 启动后端.cmd，不依赖 PowerShell 执行策略。另一个终端运行 pnpm.cmd dev，打开 http://127.0.0.1:5173/#/training 。
首次从 PyTorch 官方下载 MobileNetV3-Large ImageNet1K V2 权重（约 21 MB），验证 SHA256 前缀；运行时只读取本机权重，使用 weights_only 加载。

## 训练方式
- 2–8 类，每类至少 5 张不同图片，每项目最多 200 张、50 次训练。最低数量是流程门槛，不是效果保证。
- 固定随机种子 42，按类别留出约 20% 图片作验证，其余训练；记录两组样本 ID。标准化 JPEG 哈希用于去重，跨类别重复拒绝。连拍近重复不能自动识别，需另拍独立测试图片。
- 骨干网络为 eval 模式，冻结参数；官方 Resize 232 / CenterCrop 224 提取 1280 维特征。缓存键包括骨干版本、预处理版本和图片哈希。
- 学习率、AdamW/SGD、批大小和轮数真实作用于分类层。训练损失、验证损失、验证准确率和混淆矩阵来自真实计算。
- 保存类别 ID 和顺序、样本版本、参数、划分信息、分类层 safetensors 与哈希清单。图片或类别变化后，旧模型不可用于当前项目预测。
- 单进程 CPU，一次只运行一个训练任务，忙时返回 409。取消在下个样本/批次检查；刷新网页不取消任务；重启将中断任务标记 failed。
- 模型保存供后端校验，不提供独立部署包。助手仍为预设回复，不是大模型 Agent。

## 数据与工作区
backend/data/samples 保存最长边 1024 像素的 JPEG，features 为特征缓存，models 保存分类层和清单。数据库与目录应一起备份。删除项目删除其样本、模型和数据库记录，衍生特征缓存暂不自动清理。
HttpOnly cookie 用于浏览器工作区隔离，服务端检查归属。没有学生账号和找回功能，清除 cookie 后无法自动找回工作区。当前为本地开发版，不直接公开互联网，不多实例共用同一数据库；进程锁仅约束同一数据目录。
旧版 IndexedDB 演示项目不删除、不自动上传，模拟指标不转换成真实记录。查看旧版可在根目录 .env.local 设置 VITE_API_MODE=mock 并重启前端；正常模式为 real。旧样本自动迁移尚未实现。

## 验证
```powershell
.\backend\.venv\Scripts\python.exe -m pytest backend/tests -q
pnpm.cmd build
```
测试显式隔离数据库，不使用公司连接；真实模型测试需下载权重。tests/training-real.spec.ts 覆盖真实训练、刷新恢复、预测、导出和旧模型失效，需使用隔离测试后端。历史演示测试有旧文案断言，不代表真实模式验收结果。

默认 pnpm.cmd test 使用 playwright.real.config.ts，自动在 8001 / 5174 启动隔离前后端，覆盖当前真实模式的 8 项流程测试。需先安装依赖和下载两种模型；测试不连接公司库，数据库位于系统临时目录，样本为自带合成图形。
旧版模拟训练与助手用例保留供历史参考，未纳入真实模式默认套件。
