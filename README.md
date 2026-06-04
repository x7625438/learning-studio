# 智学平台 · AI Learning Studio

面向**小学到高中（K-12）学生**的 AI 智能学习平台。以个人知识库为核心，融合 RAG 语义检索、间隔重复、薄弱点追踪、自适应练习、错题分析、作文批改等能力，为每个学生打造个性化的 AI 学习伴侣。

## 平台定位

- **目标用户**：小学、初中、高中学生，覆盖语数英物化生等学科
- **核心目标**：让 AI 真正"认识"每个学生——记住他们学过什么、哪里薄弱、偏好什么学习方式，并在每一次互动中提供贴合个人情况的指导
- **设计理念**：以「个人学习记忆库」为中心，所有学习行为（问答、练习、费曼、教材阅读）自动沉淀为可检索、可复习的知识卡片

---

## 功能模块（15 个活跃模块）

| 模块 | 路径 | 说明 |
|------|------|------|
| 首页 | `/` | 今日学习概览、连续学习天数、学习时长统计 |
| 学习档案 | `/profile` | 学习目标、当前阶段、薄弱点雷达图、学习偏好编辑 |
| 即时问答 | `/qa` | AI 教师式多轮问答，支持图片提问，自动提取知识点 |
| 教材对话 | `/textbook` | 上传 PDF/DOCX/TXT 课件，AI 分段翻译+对话答疑 |
| 自适应练习 | `/practice` | 基于薄弱点 + Bloom 分类法 + 期望难度自动生成选择题 |
| 错题本 | `/wrong-questions` | 拍照上传错题 → AI 识别分析 → 生成相似题 → 间隔复习 |
| 作文批改 | `/essay-grading` | 按评分标准逐维度批改，支持小学/初中/高中多套预设模板 |
| 知识库 🆕 | `/knowledge-base` | 个人学习记忆库：自动捕获知识点、语义搜索、SM-2 间隔复习、记忆整合 |
| 学习日历 | `/calendar` | 每日学习热力图、每周统计、学习计时器 |
| 费曼学习 | `/feynman` | AI 引导的费曼解释训练，检测理解盲区 |
| 学习路径 | `/learning-path` | AI 根据目标/水平/时间生成阶段性学习计划 |
| 知识图谱 | `/knowledge-graph` | 学科知识拓扑可视化，标记掌握状态 |
| 伴学宠物 | `/`（右下角） | AI 伙伴"小智"，记住用户偏好/习惯/情绪，可搜索和导航 |
| 登录/注册 | `/login`、`/register` | JWT 账号认证 |

---

## 技术架构

### 前端

```
React 18 + TypeScript + Vite 5
├── Tailwind CSS 3          — 样式框架
├── Zustand                 — 状态管理（7 个 store：auth / profile / practice / calendar / learningPath / knowledgeGraph / knowledge）
├── React Query v5          — 服务端状态缓存
├── React Router v6         — 路由
├── Axios                   — HTTP 请求
├── Socket.IO Client        — WebSocket 实时通信
├── Framer Motion           — 动画
└── fetch + ReadableStream  — SSE 流式响应解析
```

### 后端

```
Flask 3.0 + Python 3.9+
├── SQLite (WAL 模式)       — 主数据库，30 张表
├── ChromaDB                — 向量存储（知识记忆 + 交互记录语义检索）
├── Flask-SocketIO          — WebSocket 实时推送（复习提醒、每日任务、档案更新）
├── APScheduler             — 定时任务（复习提醒、每日练习生成、每周知识整合）
├── JWT (PyJWT)             — 无状态认证
├── OpenAI SDK              — AI 调用（兼容阿里云 DashScope / DeepSeek）
├── PyMuPDF + PyPDF2        — PDF 解析
└── python-docx              — DOCX 解析
```

### 前后端通信方式

| 方式 | 用途 | 技术 |
|------|------|------|
| REST API | 主要数据交互（CRUD、AI 同步调用） | Axios ↔ Flask Blueprint，JSON 格式，Bearer Token 认证 |
| SSE 流式 | AI 实时生成（问答、费曼、作文批改） | `fetch` + `ReadableStream` ↔ Flask `Generator` + `text/event-stream` |
| WebSocket | 实时推送（复习提醒、档案更新、练习任务通知） | Socket.IO ↔ Flask-SocketIO，命名空间 `/ws`，按 `user:<id>` 房间隔离 |

### AI 配置

- **提供商**：阿里云 DashScope（OpenAI 兼容接口），可切换至 DeepSeek
- **文本模型**：`qwen-plus`
- **视觉模型**：`qwen-vl-max`（支持图片识别、错题 OCR）
- **上下文注入**：每次 AI 调用自动注入三层上下文：
  1. **知识库上下文**（`with_knowledge_context`）— 从个人知识库检索相关记忆
  2. **学习画像上下文**（`with_learning_context`）— 学习目标、薄弱点、近期学习历史
  3. **用户档案上下文** — 学习风格、性格特点、偏好

---

## 数据库设计

### 核心原则
- SQLite WAL 模式，支持并发读写
- 所有表使用 `TEXT PRIMARY KEY`（UUID），`user_id` 外键级联删除
- 字段名 `snake_case`，API 响应自动转 `camelCase`
- 迭代式迁移：`database.py` 中按需 `ALTER TABLE ADD COLUMN`

### 表结构总览（30 张表）

**用户与画像**
| 表 | 说明 |
|------|------|
| `users` | 用户账号（email, username, password_hash） |
| `user_profile_document` | 用户档案 Markdown 文档（AI 持续观察更新） |
| `learning_profile` | 学习目标、阶段、偏好、连续学习天数、统计数据 |

**知识记忆系统 🆕**
| 表 | 说明 |
|------|------|
| `knowledge_memories` | 个人知识记忆（标题、内容、SM-2 字段、向量嵌入标记） |
| `knowledge_memory_reviews` | SM-2 复习历史记录 |
| `knowledge_memory_links` | 记忆间关联关系（前驱/相关/派生） |

**学习交互**
| 表 | 说明 |
|------|------|
| `interaction_logs` | 所有 AI 交互记录（来源、输入、输出、知识提取） |
| `study_records` | 每日学习统计（时长、练习题数、学习主题） |
| `emotion_logs` | 情绪状态日志 |

**练习与错题**
| 表 | 说明 |
|------|------|
| `weak_points` | 薄弱点（知识点名、掌握度、复习间隔、来源） |
| `practice_questions` | AI 生成的自适应练习题目 |
| `practice_submissions` | 练习提交记录 |
| `daily_practice_tasks` | 每日练习任务单 |
| `wrong_questions` | 错题本（题目、选项、错误分析、掌握度、复习调度） |
| `similar_questions` | 错题的相似练习题目 |
| `review_plans` | 错题复习计划 |

**作文批改**
| 表 | 说明 |
|------|------|
| `rubric_templates` | 评分标准模板（小学/初中/高中语文+英语预设） |
| `essay_grading_sessions` | 作文批改会话（逐维度评分、总评、优缺点） |

**知识导航**
| 表 | 说明 |
|------|------|
| `knowledge_graphs` | 知识图谱（节点、边、摘要） |
| `knowledge_graph_jobs` | 知识图谱异步构建任务 |
| `learning_paths` | 学习路径计划 |
| `milestone_records` | 学习里程碑 |

**伴学宠物**
| 表 | 说明 |
|------|------|
| `pet_conversations` | 宠物对话记录 |
| `pet_user_actions` | 用户操作追踪 |
| `pet_user_memories` | 宠物记住的用户信息（偏好、习惯、情绪） |

**写作与文档**
| 表 | 说明 |
|------|------|
| `writing_sessions` / `writing_versions` / `writing_feedback` | 写作练习与版本管理 |
| `documents` / `document_versions` | 通用文档版本管理 |
| `textbooks` | 上传的教材课件 |
| `buddy_messages` | 每日陪伴消息 |

---

## 核心能力详解

### 1. 个人知识记忆库（Knowledge Memory Library）🆕

每个学生拥有一个持续增长的「第二大脑」：

- **自动捕获**：每次问答、练习、费曼学习后，AI 自动从中提取知识点存入知识库
- **语义检索**：ChromaDB 向量搜索 + SQLite 关键词搜索，用自然语言找到相关知识
- **RAG 上下文注入**：每次 AI 对话自动检索相关知识记忆，让 AI 回答贴合学生已有知识
- **间隔重复（SM-2）**：知识记忆按算法调度复习，到期自动提醒
- **记忆整合**：AI 定期识别重复/相关内容，自动合并去重
- **手动管理**：浏览、搜索、添加、编辑、删除、导出 JSON

### 2. 自适应练习系统

- **Bloom 分类法分层**：记忆→理解→应用→分析→评价→创造，逐级递进
- **期望难度策略**：基础巩固 / 轻微变化 / 交错迁移 / 错因辨析
- **薄弱点驱动**：根据学生掌握度（0-100）优先出薄弱点题目
- **每日自动生成**：凌晨 2 点根据薄弱点变化自动生成当日练习任务

### 3. 错题分析闭环

```
拍照上传 → AI 识别（题目/选项/答案/知识点/错误原因）
    → 生成 3-5 道相似题
    → 间隔重复复习调度
    → 定期复盘总结（错误分布 + 薄弱点 + 改进建议）
```

### 4. 作文批改

- 预设 6 套评分标准（小学/初中/高中 × 语文/英语）
- 流式逐维度评阅：内容立意 → 结构层次 → 语言表达 → 书写规范
- 每个维度提供评分 + 评语 + 原文证据摘录
- 总评包括优点、不足、修改建议

### 5. 个性化 AI 教师

每次 AI 调用自动感知：
- 学生当前年级和学习目标
- 薄弱知识点及掌握度
- 近期学习历史和互动偏好
- 知识库中与当前问题相关的已有知识
- 用户档案中的学习风格和性格特点

---

## 本地运行

### 环境要求
- Python 3.9+
- Node.js 18+
- npm

### 后端

```bash
cd backend
pip install -r requirements.txt
python3 app.py
# 运行在 http://127.0.0.1:5001
# 健康检查: curl http://127.0.0.1:5001/api/health
```

### 前端

```bash
cd frontend
npm install
npm run dev
# 运行在 http://127.0.0.1:5173
# Vite 自动代理 /api 和 /socket.io 到后端 5001 端口
```

### 环境变量

复制根目录或后端目录的 `.env.example`，按需填入本地开发密钥。公开仓库不会内置真实 API Key。

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AI_API_KEY` / `DASHSCOPE_API_KEY` / `DEEPSEEK_API_KEY` | AI 服务 API Key | 无，需本地配置 |
| `AI_BASE_URL` | AI 接口地址 | `dashscope.aliyuncs.com` |
| `TEXT_MODEL` | 文本模型 | `qwen-plus` |
| `VISION_MODEL` | 视觉模型 | `qwen-vl-max` |
| `JWT_SECRET` | JWT 签名密钥 | 开发默认值 |
| `TAVILY_API_KEY` | Tavily 搜索 API Key，可选 | 无 |
| `ENABLE_VECTOR_SEARCH` | 启用向量搜索 | `1`（开启） |
| `CORS_ORIGINS` | 跨域白名单 | `localhost:5173` |

---

## 项目结构

```
backend/
  app.py                   # Flask 入口、蓝图注册、SocketIO、调度器
  auth.py                  # 密码哈希、JWT 签发/校验、@login_required
  config.py                # 数据库路径、AI 配置、上传限制
  database.py              # SQLite WAL 连接、init_db、迁移函数、事务 helper
  schema.sql               # 30 张表 DDL
  requirements.txt         # Python 依赖
  blueprints/              # 15 个功能模块蓝图
    auth_routes.py         # 登录/注册
    profile.py             # 学习档案
    qa.py                  # 即时问答
    textbook.py            # 教材对话
    practice.py            # 自适应练习
    wrong_questions.py     # 错题本
    essay_grading.py       # 作文批改
    knowledge_memories.py  # 知识记忆库 🆕
    feynman.py             # 费曼学习
    calendar.py            # 学习日历
    learning_path.py       # 学习路径
    knowledge_graph.py     # 知识图谱
    interactions.py        # 交互日志
    weak_points.py         # 薄弱点
    user_profile_doc.py    # 用户档案
    pet.py                 # 伴学宠物
  services/                # 业务逻辑服务层
    ai_service.py          # AI 调用（同步/流式/JSON/视觉/PDF）
    learning_service.py    # 学习分析、薄弱点管理、练习生成
    knowledge_memory_service.py  # 知识记忆 CRUD/SM-2/RAG/自动捕获/整合 🆕
    personalization.py     # 学习画像 + 知识上下文构建
    vector_service.py      # ChromaDB 向量存储与检索
    user_profile_service.py
    textbook_service.py
    pet_service.py
    essay_grading_service.py
    geometry_service.py    # 几何题 SVG 图表生成
  scheduler/
    reminder.py            # 定时任务（复习提醒、每日练习、知识整合）
  tests/                   # 后端测试

frontend/
  src/
    pages/                 # 15 个路由页面
    components/            # 通用组件（Layout、KnowledgeCard、KnowledgeReview 等）
    store/                 # Zustand 状态管理（7 个 store）
    hooks/                 # useSocket（WebSocket）
    utils/                 # api-client（Axios）、sse（流式解析）、textbook-format
    types/                 # TypeScript 类型定义
    test/                  # 前端测试
```

---

## 验证流程

```bash
# 前端
cd frontend
npm run lint && npm run test && npm run build

# 后端
cd backend
python3 -m pytest
curl http://127.0.0.1:5001/api/health
```

---

## 更新日志

### v2.0 — 2026-06-03

**新增：个人知识记忆库（Knowledge Memory Library）**
- 新增 `knowledge_memories` / `knowledge_memory_reviews` / `knowledge_memory_links` 三张表
- ChromaDB 向量语义搜索 + SQLite 关键词混合搜索
- AI 自动从学习交互中捕获知识点（问答、练习、费曼、教材对话）
- SM-2 间隔重复算法驱动复习调度（EF 因子、掌握度 0-100、自动计算下次复习时间）
- RAG 上下文注入：所有 AI 调用自动检索相关知识作为参考
- 记忆整合：AI 识别重复内容，建议合并去重，每周自动运行
- 前端知识库页面：浏览、搜索、复习队列、整合建议、JSON 导出
- WebSocket 复习提醒：每 3 小时检查到期知识并推送

**目标用户调整**
- 从"自用 + 大学生"重新定位为面向**小学到高中（K-12）学生**
- 新增作文批改模块，支持小学/初中/高中语文+英语 6 套预设评分标准

**其他增强**
- 前端新增 Zustand knowledgeStore 状态管理
- 后端新增 `knowledge_memories` 蓝图（16 个 REST 接口）
- `personalization.py` 新增 `with_knowledge_context()` 三层上下文注入
- `learning_service.py` 新增自动捕获钩子，薄弱点攻克后自动同步到知识库
- 调度器新增知识记忆复习提醒 + 每周自动整合任务
- 向量服务启用 ChromaDB `knowledge_memories` 集合

### v1.8 — 2026-05
- 作文批改模块上线（流式逐维度评阅 + 多套评分标准）
- 错题本完善（上传识别、相似题生成、间隔复习、AI 复盘总结）

### v1.5 — 2026-04
- 学习档案与薄弱点追踪
- 自适应练习系统（Bloom 分类法 + 期望难度 + 每日自动出题）
- 费曼学习模块

### v1.0 — 2026-03
- 初始版本：即时问答、教材对话、学习日历、学习路径、知识图谱、伴学宠物
