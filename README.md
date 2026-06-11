# 保险智能获客平台

一个完整的保险客户介绍平台，前后端一体化，支持AI智能录单、专家匹配、工单跟踪、团队管理等功能。

## 技术栈

### 前端
- React 19 + TypeScript + Vite
- axios（API 客户端）
- lucide-react（图标）

### 后端
- Node.js + Express + TypeScript
- SQLite（better-sqlite3）
- bcryptjs（密码加密）
- jsonwebtoken（JWT 认证）
- DeepSeek API（AI 智能录单）

## 快速开始

### 开发环境

```bash
# 1. 安装依赖（根目录 + 后端）
npm install
cd backend && npm install && cd ..

# 2. 初始化数据库并插入种子数据
npm run db:seed

# 3. 同时启动前后端开发服务器
npm run dev
```

- 前端：`http://localhost:5173`
- 后端 API：`http://localhost:3001/api`

### 生产构建

```bash
# 构建前后端
npm run build

# 启动生产服务器（后端会 serve 前端静态文件）
npm start
```

访问 `http://localhost:3001`

## 项目结构

```
.
├── src/                    # 前端代码
│   ├── App.tsx             # 主应用（含所有页面组件）
│   ├── LoginPage.tsx       # 登录/注册页面
│   ├── api/                # API 客户端
│   │   ├── client.ts       # axios 实例
│   │   ├── auth.ts
│   │   ├── dashboard.ts
│   │   ├── customers.ts
│   │   ├── orders.ts
│   │   ├── experts.ts
│   │   ├── messages.ts
│   │   ├── notifications.ts
│   │   ├── team.ts
│   │   ├── users.ts
│   │   └── ai.ts
│   └── ...
├── backend/
│   ├── src/
│   │   ├── index.ts        # Express 入口
│   │   ├── db.ts           # SQLite 数据库
│   │   ├── auth.ts         # JWT + bcrypt
│   │   ├── deepseek.ts     # DeepSeek API
│   │   ├── routes/         # API 路由
│   │   │   ├── auth.ts
│   │   │   ├── users.ts
│   │   │   ├── customers.ts
│   │   │   ├── orders.ts
│   │   │   ├── experts.ts
│   │   │   ├── messages.ts
│   │   │   ├── notifications.ts
│   │   │   ├── team.ts
│   │   │   ├── ai.ts
│   │   │   └── dashboard.ts
│   │   └── seed.ts         # 种子数据
│   └── dist/               # 编译后的后端代码
├── data/
│   └── app.db              # SQLite 数据库文件
└── dist/                   # 编译后的前端静态文件
```

## API 端点

### 认证
- `POST /api/auth/register` — 注册
- `POST /api/auth/login` — 登录
- `GET /api/auth/me` — 获取当前用户

### 工作台
- `GET /api/dashboard/overview` — 案件概览
- `GET /api/dashboard/pending-matches` — 待确认匹配

### 客户
- `GET /api/customers` — 客户列表
- `POST /api/customers` — 创建客户
- `GET /api/customers/:id` — 客户详情

### 工单
- `GET /api/orders` — 工单列表
- `POST /api/orders` — 创建工单
- `GET /api/orders/:id` — 工单详情

### 专家
- `GET /api/experts` — 专家列表
- `GET /api/experts/:id` — 专家详情

### 消息
- `GET /api/messages/contacts` — 联系人列表
- `GET /api/messages/:contactId` — 聊天记录
- `POST /api/messages` — 发送消息

### 通知
- `GET /api/notifications` — 通知列表
- `PUT /api/notifications/read-all` — 全部已读

### 团队
- `GET /api/team` — 团队概览
- `GET /api/team/members` — 成员列表
- `GET /api/team/earnings` — 收益明细

### AI
- `POST /api/ai/conversations` — 创建对话
- `POST /api/ai/conversations/:id/messages` — 发送消息
- `POST /api/ai/conversations/:id/complete` — 完成录单

## 部署到服务器

### 1. 服务器准备

需要安装：
- Node.js 20+
- Git（可选）

### 2. 上传代码

```bash
# 在服务器上
git clone <your-repo> /var/www/insurance-platform
cd /var/www/insurance-platform

# 安装依赖
npm install
cd backend && npm install && cd ..

# 构建
npm run build

# 初始化数据库
npm run db:seed
```

### 3. 使用 PM2 启动

```bash
# 全局安装 PM2
npm install -g pm2

# 启动
pm2 start backend/dist/index.js --name insurance-api

# 保存配置
pm2 save
pm2 startup
```

### 4. 使用 Nginx 反向代理（可选）

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 5. 环境变量

生产环境可设置以下环境变量：

```bash
PORT=3001                          # 服务端口号
DB_PATH=./data/app.db              # 数据库文件路径
JWT_SECRET=your-secret-key         # JWT 密钥（生产环境必须修改）
JWT_EXPIRES_IN=7d                  # Token 过期时间
```

## 数据库备份

SQLite 数据库是单文件，直接复制即可备份：

```bash
# 备份
cp data/app.db data/app.db.backup.$(date +%Y%m%d)

# 建议设置定时任务（crontab）
0 2 * * * cp /var/www/insurance-platform/data/app.db /var/www/insurance-platform/backups/app.db.$(date +\%Y\%m\%d)
```

## AI 功能

平台集成 DeepSeek API 实现智能客户信息提取：

- **模型**: `deepseek-chat`
- **功能**: 用户用自然语言描述客户情况，AI 自动提取结构化信息（姓名、年龄、需求、预算等）
- **对话模式**: AI 可引导用户补充缺失信息，完成后一键生成客户档案和工单
