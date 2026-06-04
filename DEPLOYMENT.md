# 部署指南

本文档提供 RW Online 学习平台的完整部署说明。

## 目录

- [系统要求](#系统要求)
- [快速开始](#快速开始)
- [环境配置](#环境配置)
- [部署步骤](#部署步骤)
- [验证部署](#验证部署)
- [常见问题](#常见问题)
- [生产环境建议](#生产环境建议)

## 系统要求

### 硬件要求
- **CPU**: 2 核心或以上
- **内存**: 4GB RAM 最低，推荐 8GB
- **存储**: 20GB 可用空间（用于应用、数据库、上传文件）

### 软件要求
- **Docker**: 20.10+ 
- **Docker Compose**: 2.0+
- **操作系统**: Linux (Ubuntu 20.04+/CentOS 8+), macOS 11+, Windows 10+ with WSL2

验证安装：
```bash
docker --version
docker-compose --version
```

## 快速开始

### 1. 克隆仓库
```bash
git clone <repository-url>
cd rw-online-master
```

### 2. 配置环境变量
```bash
cp .env.example .env
```

编辑 `.env` 文件，**必须修改**以下配置：
```bash
# 生产环境必须使用强密码
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# 从 DeepSeek 获取 API Key: https://platform.deepseek.com
DEEPSEEK_API_KEY=sk-your-deepseek-api-key-here
```

### 3. 启动服务
```bash
docker-compose up -d
```

### 4. 访问应用
- **前端**: http://localhost
- **后端 API**: http://localhost:3000/api/health

## 环境配置

### 必需配置

| 变量名 | 说明 | 示例值 |
|--------|------|--------|
| `JWT_SECRET` | JWT 令牌加密密钥（生产环境必须修改） | `your-secret-key` |
| `DEEPSEEK_API_KEY` | DeepSeek AI API 密钥 | `sk-xxx` |

### 可选配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `DEEPSEEK_BASE_URL` | DeepSeek API 地址 | `https://api.deepseek.com` |
| `TEXT_MODEL` | 文本模型名称 | `deepseek-v4-flash` |
| `VISION_MODEL` | 视觉模型名称 | `deepseek-v4-flash` |
| `CORS_ORIGINS` | 允许的跨域来源（逗号分隔） | `http://localhost:80` |
| `ENABLE_VECTOR_SEARCH` | 启用向量搜索（需要更多内存） | `0` |

## 部署步骤

### 开发环境部署

```bash
# 1. 构建并启动所有服务
docker-compose up -d

# 2. 查看日志
docker-compose logs -f

# 3. 查看服务状态
docker-compose ps
```

### 生产环境部署

#### 1. 准备环境
```bash
# 创建生产环境配置
cp .env.example .env.production

# 编辑配置文件
nano .env.production
```

#### 2. 使用生产配置启动
```bash
# 使用生产环境变量文件
docker-compose --env-file .env.production up -d

# 或者直接设置环境变量
export JWT_SECRET="your-production-secret"
export DEEPSEEK_API_KEY="sk-your-key"
docker-compose up -d
```

#### 3. 配置反向代理（推荐）

使用 Nginx 或 Caddy 作为反向代理：

**Nginx 配置示例**:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 重定向到 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### 4. 配置防火墙
```bash
# Ubuntu/Debian
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# CentOS/RHEL
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

## 验证部署

### 健康检查
```bash
# 检查后端健康状态
curl http://localhost:3000/api/health

# 预期输出
# {"data":{"status":"ok","service":"ai-learning-platform"}}

# 检查前端健康状态
curl http://localhost/health

# 预期输出
# healthy
```

### 查看容器状态
```bash
docker-compose ps

# 预期输出（所有服务状态为 Up 且 healthy）
# NAME                    STATUS
# rw-online-backend       Up (healthy)
# rw-online-frontend      Up (healthy)
```

### 查看日志
```bash
# 查看所有服务日志
docker-compose logs

# 查看特定服务日志
docker-compose logs backend
docker-compose logs frontend

# 实时跟踪日志
docker-compose logs -f backend
```

## 常见问题

### 1. 容器启动失败

**问题**: `docker-compose up` 失败

**解决方案**:
```bash
# 查看详细错误日志
docker-compose logs backend
docker-compose logs frontend

# 重新构建镜像
docker-compose build --no-cache
docker-compose up -d
```

### 2. 后端健康检查失败

**问题**: 后端容器状态显示 `unhealthy`

**解决方案**:
```bash
# 检查后端日志
docker-compose logs backend

# 常见原因：
# - DEEPSEEK_API_KEY 未配置或无效
# - 数据库初始化失败
# - 端口 3000 被占用

# 进入容器调试
docker-compose exec backend bash
curl http://localhost:3000/api/health
```

### 3. 前端无法连接后端

**问题**: 前端页面加载但 API 请求失败

**解决方案**:
```bash
# 1. 确认后端服务正常
docker-compose ps backend

# 2. 检查网络连接
docker-compose exec frontend ping backend

# 3. 检查 nginx 配置
docker-compose exec frontend cat /etc/nginx/conf.d/default.conf

# 4. 重启服务
docker-compose restart frontend
```

### 4. 文件上传失败

**问题**: 上传 PDF/文档时报错

**解决方案**:
```bash
# 检查上传目录权限
docker-compose exec backend ls -la /app/uploads

# 检查磁盘空间
df -h

# 检查文件大小限制（默认 50MB）
# 如需修改，在 docker-compose.yml 中添加：
# environment:
#   - MAX_CONTENT_LENGTH=104857600  # 100MB
```

### 5. 数据持久化问题

**问题**: 重启容器后数据丢失

**解决方案**:
```bash
# 检查 volume 是否正确挂载
docker volume ls | grep rw-online

# 查看 volume 详情
docker volume inspect rw-online-master_backend-db

# 备份数据
docker-compose exec backend cp /app/learning.db /app/uploads/backup.db
docker cp rw-online-backend:/app/uploads/backup.db ./backup.db
```

### 6. 端口冲突

**问题**: 端口 80 或 3000 已被占用

**解决方案**:
```bash
# 查看端口占用
lsof -i :80
lsof -i :3000

# 修改 docker-compose.yml 中的端口映射
# ports:
#   - "8080:80"    # 前端改为 8080
#   - "5001:3000"  # 后端改为 5001
```

## 生产环境建议

### 安全加固

1. **使用强密码**
   ```bash
   # 生成随机 JWT_SECRET
   openssl rand -base64 32
   ```

2. **限制 CORS 来源**
   ```bash
   CORS_ORIGINS=https://your-domain.com
   ```

3. **启用 HTTPS**
   - 使用 Let's Encrypt 免费证书
   - 配置 SSL/TLS

4. **定期更新**
   ```bash
   # 更新镜像
   docker-compose pull
   docker-compose up -d
   ```

### 性能优化

1. **增加后端 worker 数量**
   
   编辑 `backend/Dockerfile`，修改 gunicorn 配置：
   ```dockerfile
   CMD ["python", "-m", "gunicorn", "--bind", "0.0.0.0:3000", "--workers", "8", ...]
   ```

2. **启用 Redis 缓存**（可选）
   
   在 `docker-compose.yml` 中添加 Redis 服务

3. **配置 CDN**
   
   将静态资源托管到 CDN

### 监控和日志

1. **日志管理**
   ```bash
   # 配置日志轮转
   docker-compose logs --tail=1000 > app.log
   
   # 使用 ELK Stack 或 Loki 收集日志
   ```

2. **监控指标**
   - 使用 Prometheus + Grafana
   - 监控容器资源使用
   - 设置告警规则

### 备份策略

```bash
# 1. 备份数据库
docker-compose exec backend sqlite3 /app/learning.db ".backup '/app/uploads/backup-$(date +%Y%m%d).db'"

# 2. 备份上传文件
docker cp rw-online-backend:/app/uploads ./backups/uploads-$(date +%Y%m%d)

# 3. 定期备份脚本（crontab）
0 2 * * * /path/to/backup-script.sh
```

### 扩展部署

对于高流量场景，考虑：
- 使用 Kubernetes 进行容器编排
- 配置负载均衡器
- 使用外部数据库（PostgreSQL/MySQL）
- 配置对象存储（S3/OSS）存储上传文件

## 维护命令

```bash
# 停止所有服务
docker-compose down

# 停止并删除 volumes（会清空数据）
docker-compose down -v

# 重启服务
docker-compose restart

# 查看资源使用
docker stats

# 清理未使用的镜像和容器
docker system prune -a

# 更新服务
docker-compose pull
docker-compose up -d --build
```

## 技术支持

如遇到问题，请：
1. 查看日志：`docker-compose logs`
2. 检查 GitHub Issues
3. 联系技术支持团队

---

**最后更新**: 2026-05-24
