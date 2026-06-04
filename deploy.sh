#!/bin/bash

# RW Online 一键部署脚本

set -e

echo "========================================="
echo "  RW Online 学习平台部署脚本"
echo "========================================="
echo ""

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo "❌ 错误: 未安装 Docker"
    echo "请访问 https://docs.docker.com/get-docker/ 安装 Docker"
    exit 1
fi

# 检查 Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo "❌ 错误: 未安装 Docker Compose"
    echo "请访问 https://docs.docker.com/compose/install/ 安装 Docker Compose"
    exit 1
fi

echo "✅ Docker 和 Docker Compose 已安装"
echo ""

# 检查 .env 文件
if [ ! -f .env ]; then
    echo "⚠️  未找到 .env 文件，从模板创建..."
    cp .env.example .env
    echo "✅ 已创建 .env 文件"
    echo ""
    echo "⚠️  请编辑 .env 文件，配置以下必需项："
    echo "   - JWT_SECRET (生产环境必须修改)"
    echo "   - DEEPSEEK_API_KEY (从 https://platform.deepseek.com 获取)"
    echo ""
    read -p "是否现在编辑 .env 文件? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ${EDITOR:-nano} .env
    else
        echo "请手动编辑 .env 文件后重新运行此脚本"
        exit 0
    fi
fi

# 验证必需的环境变量
source .env
if [ -z "$DEEPSEEK_API_KEY" ] || [ "$DEEPSEEK_API_KEY" = "sk-your-deepseek-api-key-here" ]; then
    echo "❌ 错误: 请在 .env 文件中配置有效的 DEEPSEEK_API_KEY"
    exit 1
fi

if [ "$JWT_SECRET" = "your-super-secret-jwt-key-change-this-in-production" ]; then
    echo "⚠️  警告: JWT_SECRET 使用默认值，生产环境请修改"
fi

echo "✅ 环境变量配置正确"
echo ""

# 构建并启动服务
echo "🚀 开始构建和启动服务..."
docker-compose down 2>/dev/null || true
docker-compose build --no-cache
docker-compose up -d

echo ""
echo "⏳ 等待服务启动..."
sleep 10

# 健康检查
echo ""
echo "🔍 检查服务健康状态..."

# 检查后端
if curl -f http://localhost:3000/api/health &> /dev/null; then
    echo "✅ 后端服务正常"
else
    echo "❌ 后端服务异常，查看日志："
    docker-compose logs backend
    exit 1
fi

# 检查前端
if curl -f http://localhost/health &> /dev/null; then
    echo "✅ 前端服务正常"
else
    echo "❌ 前端服务异常，查看日志："
    docker-compose logs frontend
    exit 1
fi

echo ""
echo "========================================="
echo "  🎉 部署成功！"
echo "========================================="
echo ""
echo "访问地址："
echo "  前端: http://localhost"
echo "  后端 API: http://localhost:3000/api/health"
echo ""
echo "常用命令："
echo "  查看日志: docker-compose logs -f"
echo "  停止服务: docker-compose down"
echo "  重启服务: docker-compose restart"
echo ""
