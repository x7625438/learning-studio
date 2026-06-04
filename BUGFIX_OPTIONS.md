# 错题本选项显示修复

## 问题描述
错题本页面只显示题干，没有显示选项（A、B、C、D等），导致用户无法看到完整的题目内容。

## 修复内容

### 1. 数据库修改
- 在 `wrong_questions` 表中添加 `options` 字段（TEXT 类型，默认值 '[]'）
- 创建迁移脚本：`backend/migrations/add_options_to_wrong_questions.sql`
- 已执行迁移，数据库结构已更新

### 2. 后端修改 (`backend/blueprints/wrong_questions.py`)
- 更新 AI 识别 prompt，要求提取选项信息：
  - `questionText`: 只包含题干，不包含选项
  - `options`: 数组格式，每个选项格式为 "字母. 内容"（如 "A. 3"）
  - 如果是填空题/解答题，options 为空数组
- 在数据库插入时保存 `options` 字段（JSON 格式）
- 在 `get_wrong_questions()` 和 `get_wrong_question()` 接口中返回 `options` 字段

### 3. 前端修改 (`frontend/src/pages/WrongQuestions.tsx`)
- 在 `WrongQuestion` 接口中添加 `options: string[]` 字段
- 在题目详情页面添加选项显示：
  - 正确答案：绿色边框 + 绿色背景 + ✓ 标记
  - 错误答案（用户选择）：红色边框 + 红色背景 + ✗ 标记
  - 其他选项：灰色边框 + 灰色背景
- 修复 lint 错误（移除未使用的变量和导入）

## 测试步骤

1. 启动后端服务：
   ```bash
   cd backend
   python3 app.py
   ```

2. 启动前端服务：
   ```bash
   cd frontend
   npm run dev
   ```

3. 上传一道新的错题图片（包含选项的题目）

4. 查看错题详情，验证：
   - 题干正确显示
   - 所有选项正确显示
   - 正确答案标记为绿色
   - 用户错误答案标记为红色
   - 其他选项显示为灰色

## 注意事项

- 旧数据（已上传的错题）的 `options` 字段为空数组 `[]`，不会显示选项
- 新上传的错题会自动识别并保存选项
- 如果题目没有选项（填空题、解答题），AI 会返回空数组，前端不会显示选项区域
