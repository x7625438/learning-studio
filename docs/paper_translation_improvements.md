# 论文翻译功能改进文档

## 问题描述

原有的论文翻译功能存在以下问题：
1. **超时问题**：同步翻译所有段落导致请求超时
2. **可读性差**：图表、目录、表格等特殊内容与普通段落混在一起，格式混乱
3. **分段不合理**：简单按字符数切分，破坏了自然段落结构

## 解决方案

参考了市面上主流PDF翻译工具的最佳实践：
- [How to Translate PDF and Keep Original Layout](https://doclingo.ai/en/blog/how-to-translate-pdf-keep-formatting)
- [8 Tools to Translate PDF Without Losing Formatting (2026)](https://blog.laratranslate.com/translate-pdf-without-losing-formatting-2026/)
- [PDF Layout Analysis](https://paddlepaddle.github.io/PaddleOCR/main/en/ppstructure/overview.html)

### 1. 智能文档结构分析

**后端改进** (`backend/blueprints/papers.py`):

#### 新增 `detect_section_type()` 函数
自动识别内容类型：
- **标题 (title)**: 短文本、首字母大写、包含章节关键词
- **表格 (table)**: 包含大量 `|` 或制表符、数字密集
- **图表 (figure)**: 包含 "Figure"、"Fig." 等关键词
- **列表 (list)**: 以项目符号或编号开头
- **段落 (paragraph)**: 默认类型

#### 新增 `smart_sectionize()` 函数
智能分段策略：
- 按自然段落（双换行符）分割
- 特殊类型（标题/表格/图表）独立成段
- 普通段落按 ~1000 字符合并，避免截断句子

### 2. 分类翻译策略

针对不同内容类型使用不同的翻译提示词：

```python
# 标题翻译
'请翻译以下标题，保持简洁专业'

# 表格翻译
'请翻译文字部分，保留数字和符号，尽量保持原有格式（使用空格或制表符对齐）'

# 图表说明翻译
'请翻译描述性文字，保留图表编号'

# 列表翻译
'请翻译每一项，保持列表格式（保留项目符号或编号）'

# 段落翻译
'请将以下英文学术文本翻译成中文，保持专业术语的准确性，必要时在括号中保留英文原文'
```

### 3. 流式翻译

**后端** (`/api/v1/papers/<paper_id>/translate`):
- 使用 Server-Sent Events (SSE) 流式响应
- 每翻译完一个段落立即推送给前端
- 避免超时，提升用户体验

**前端** (`frontend/src/pages/Papers.tsx`):
- 使用 `streamRequest` 接收翻译进度
- 实时更新每个段落的翻译结果
- 显示翻译进度提示

### 4. 差异化显示

**前端渲染逻辑**:

```typescript
// 标题 - 大号粗体
<h3 className="text-lg font-bold text-stone-900 mt-6 mb-3">

// 表格 - 等宽字体 + 边框
<pre className="font-mono text-xs bg-white/50 p-4 rounded-lg border">

// 图表 - 蓝色背景占位符
<div className="bg-blue-50 border border-blue-200 rounded-lg">

// 列表 - 左侧缩进
<div className="pl-4">

// 段落 - 默认样式
<p className="mb-4 leading-relaxed">
```

## 技术实现

### 后端修改

1. **papers.py**:
   - `detect_section_type()`: 内容类型检测
   - `smart_sectionize()`: 智能分段
   - `translate()`: 流式翻译 + 分类策略

### 前端修改

1. **types/api.ts**:
   - `PaperSection` 新增 `type` 字段

2. **pages/Papers.tsx**:
   - `renderSection()`: 根据类型渲染不同样式
   - `translatePaper()`: 流式接收翻译结果

## 效果对比

### 改进前
- ❌ 所有内容混在一起，表格变成纯文本
- ❌ 标题与段落无区分
- ❌ 图表说明丢失格式
- ❌ 翻译超时

### 改进后
- ✅ 标题突出显示（大号粗体）
- ✅ 表格保持对齐（等宽字体）
- ✅ 图表有视觉区分（蓝色背景）
- ✅ 列表保持缩进
- ✅ 流式翻译不超时
- ✅ 实时显示翻译进度

## 未来优化方向

1. **OCR 支持**: 对扫描版PDF使用OCR提取文本
2. **公式识别**: 使用 LaTeX 渲染数学公式
3. **图片提取**: 显示PDF中的实际图片而非占位符
4. **段落对齐滚动**: 左右栏同步滚动到对应段落
5. **缓存优化**: 已翻译段落持久化，避免重复翻译

## 参考资料

- [DocLingo - How to Translate PDF and Keep Original Layout](https://doclingo.ai/en/blog/how-to-translate-pdf-keep-formatting)
- [Lara Translate - 8 Tools to Translate PDF Without Losing Formatting](https://blog.laratranslate.com/translate-pdf-without-losing-formatting-2026/)
- [PaddleOCR - Layout Analysis](https://paddlepaddle.github.io/PaddleOCR/main/en/ppstructure/overview.html)
- [Hugging Face - Translate Big PDFs Without Breaking Layout](https://huggingface.co/blog/Tomedes/translate-big-pdfs-without-breaking-your-layout)
