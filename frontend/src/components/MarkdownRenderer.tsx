import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import 'katex/dist/katex.min.css'

interface MarkdownRendererProps {
  content: string
  className?: string
}

/**
 * 将文本中的 x^2 / x^(n+1) 风格上标转为 HTML <sup> 标签
 * 仅在纯文本（非数学公式块）中应用，避免破坏 LaTeX 语法
 */
function replaceCaretExponents(text: string): string {
  return text.replace(
    /(\([^)]+\)|[A-Za-z0-9]+)\^(\([^)]+\)|-?\d+|[A-Za-z][A-Za-z0-9]*)/g,
    (_match, base: string, exponent: string) => {
      const normalizedExponent =
        exponent.startsWith('(') && exponent.endsWith(')')
          ? exponent.slice(1, -1)
          : exponent
      return `${base}<sup>${normalizedExponent}</sup>`
    }
  )
}

/**
 * 使用占位符保护所有 $...$ 和 $$...$$ 数学块，
 * 对剩余的纯文本部分应用 ^ → <sup> 转换，最后还原数学块
 */
function normalizePlainTextMath(text: string): string {
  const mathBlocks: string[] = []
  const PLACEHOLDER = '\x00MB\x00'

  // 提取所有数学公式块并用占位符替换
  const protectedText = text.replace(
    /(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g,
    (match) => {
      const idx = mathBlocks.length
      mathBlocks.push(match)
      return `${PLACEHOLDER}${idx}${PLACEHOLDER}`
    }
  )

  // 对非数学部分进行 ^ 指数转换
  const processed = replaceCaretExponents(protectedText)

  // 还原数学公式块
  return processed.replace(
    new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'),
    (_, idx) => mathBlocks[parseInt(idx, 10)]
  )
}

/**
 * 将各种 LaTeX 语法转换为 Markdown 数学语法 $...$ 和 $$...$$
 * 支持跨行内容，处理常见的 AI 输出格式问题
 *
 * 处理的格式：
 * - \(...\)   → $...$     （标准 LaTeX 行内公式）
 * - \[...\]   → $$...$$   （标准 LaTeX 块级公式）
 * - $...$ / $$...$$      （直接透传，由 remark-math 处理）
 */
function convertLatexToMarkdown(text: string): string {
  return text
    // 清理 AI 偶发的错误输出
    .replace(/\$\$\$1\$\$/g, '')
    // \(...\) → $...$（使用 [\s\S]*? 以支持跨行）
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, expr: string) => `$${expr.trim()}$`)
    // \[...\] → $$...$$（支持跨行的块级公式）
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, expr: string) => `$$\n${expr.trim()}\n$$`)
}

export default function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  const processedContent = normalizePlainTextMath(convertLatexToMarkdown(content))

  return (
    <div className={`prose prose-slate max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        components={{
          // 自定义标题样式
          h1: ({ children }) => <h1 className="text-2xl font-bold mt-6 mb-4">{children}</h1>,
          h2: ({ children }) => <h2 className="text-xl font-bold mt-5 mb-3">{children}</h2>,
          h3: ({ children }) => <h3 className="text-lg font-semibold mt-4 mb-2">{children}</h3>,

          // 自定义段落样式
          p: ({ children }) => <p className="mb-3 leading-relaxed">{children}</p>,
          sup: ({ children }) => <sup className="text-[0.7em] align-super">{children}</sup>,

          // 自定义列表样式
          ul: ({ children }) => <ul className="list-disc list-inside mb-3 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-inside mb-3 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="ml-4">{children}</li>,

          // 自定义代码块样式
          code: ({ inline, children, ...props }: any) => {
            return inline ? (
              <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono text-red-600" {...props}>
                {children}
              </code>
            ) : (
              <code className="block bg-gray-100 p-3 rounded-lg text-sm font-mono overflow-x-auto" {...props}>
                {children}
              </code>
            )
          },

          // 自定义引用样式
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-blue-500 pl-4 py-2 my-3 bg-blue-50 italic">
              {children}
            </blockquote>
          ),

          // 自定义表格样式
          table: ({ children }) => (
            <div className="overflow-x-auto my-4">
              <table className="min-w-full border-collapse border border-gray-300">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-gray-300 bg-gray-100 px-4 py-2 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="border border-gray-300 px-4 py-2">{children}</td>,

          // 自定义分隔线样式
          hr: () => <hr className="my-6 border-t-2 border-gray-200" />,

          // 自定义链接样式
          a: ({ children, href }) => (
            <a href={href} className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  )
}
