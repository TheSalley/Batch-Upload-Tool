#!/bin/zsh
# 获取脚本绝对路径
SCRIPT_PATH=$(realpath "$0")
# 获取脚本所在文件夹
PROJECT_DIR=$(dirname "$SCRIPT_PATH")
# 切入项目目录
cd "$PROJECT_DIR" || exit 1

echo "====================================="
echo "WP素材上传工具启动中"
echo "项目目录: $PROJECT_DIR"
echo "访问地址: http://127.0.0.1:3000"
echo "====================================="

# 判断server.js是否存在
if [ ! -f "server.js" ]; then
  echo "❌ 错误：当前目录找不到 server.js"
  echo "请确认 run.command 和 server.js 在同一个文件夹！"
  echo "按回车退出..."
  read
  exit 1
fi

# 判断依赖是否安装
if [ ! -d "node_modules" ]; then
  echo "❌ 未检测到依赖，请在终端执行 npm install 安装依赖"
  echo "按回车退出..."
  read
  exit 1
fi

node server.js
echo -n "服务停止，按回车关闭窗口..."
read
