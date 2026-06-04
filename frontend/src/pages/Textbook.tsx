import { DragEvent, FormEvent, useMemo, useRef, useState } from 'react'
import { useAuthStore } from '../store'
import apiClient, { API_ENDPOINTS } from '../utils/api-client'
import { streamRequest } from '../utils/sse'
import { formatTextbookAnswer } from '../utils/textbook-format'
import MarkdownRenderer from '../components/MarkdownRenderer'

interface Section {
  pageNum: number
  paragraphIndex: number
  text: string
}

interface UploadResponse {
  id: string
  sections: Section[]
  fileName?: string
  fileType?: string
  fileUrl?: string | null
  totalPages?: number
}

interface ChatMessage {
  role: 'user' | 'ai'
  content: string
}

function buildPageImageUrl(textbookId: string, pageNum: number, token: string) {
  const base = `${API_ENDPOINTS.TEXTBOOK}/${textbookId}/pages/${pageNum}/image`
  return `${base}?token=${encodeURIComponent(token)}`
}

export default function Textbook() {
  const inputRef = useRef<HTMLInputElement>(null)
  const token = useAuthStore((state) => state.token) || localStorage.getItem('auth_token') || ''
  const [textbookId, setTextbookId] = useState('')
  const [fileName, setFileName] = useState('')
  const [fileType, setFileType] = useState('')
  const [fileUrl, setFileUrl] = useState('')
  const [totalPages, setTotalPages] = useState(0)
  const [sections, setSections] = useState<Section[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [selectedText, setSelectedText] = useState('')
  const [selectedPages, setSelectedPages] = useState<number[]>([])
  const [isPageSelectionMode, setIsPageSelectionMode] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)

  const previewUrl = fileUrl
    ? `${fileUrl}${fileUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
    : ''

  const pageNumbers = useMemo(() => {
    if (fileType === 'pdf' && totalPages > 0) {
      return Array.from({ length: totalPages }, (_, index) => index + 1)
    }
    return []
  }, [fileType, totalPages])

  async function uploadFile(file: File) {
    setIsUploading(true)
    const form = new FormData()
    form.append('title', file.name.replace(/\.[^.]+$/, ''))
    form.append('file', file)

    try {
      const response = await apiClient.post<{ data: UploadResponse }>(
        `${API_ENDPOINTS.TEXTBOOK}/upload`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      setTextbookId(response.data.id)
      setFileName(response.data.fileName || file.name)
      setFileType((response.data.fileType || file.name.split('.').pop() || '').toLowerCase())
      setFileUrl(response.data.fileUrl || '')
      setTotalPages(response.data.totalPages || Math.max(...response.data.sections.map((section) => section.pageNum), 1))
      setSections(response.data.sections)
      setSelectedText('')
      setSelectedPages([])
      setIsPageSelectionMode(false)
      setMessages([
        {
          role: 'ai',
          content: '教材已经放到右侧阅读区了。你可以直接提问，也可以开启选页模式后点选页面再让我聚焦讲解。',
        },
      ])
    } finally {
      setIsUploading(false)
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const file = event.dataTransfer.files?.[0]
    if (file) {
      uploadFile(file).catch(() => undefined)
    }
  }

  function captureSelection() {
    const text = window.getSelection()?.toString().trim() || ''
    if (text) {
      setSelectedText(text.slice(0, 3000))
    }
  }

  function togglePageSelection(pageNum: number) {
    if (!isPageSelectionMode) {
      return
    }
    setSelectedPages((prev) =>
      prev.includes(pageNum) ? prev.filter((page) => page !== pageNum) : [...prev, pageNum].sort((a, b) => a - b)
    )
  }

  async function send(event?: FormEvent) {
    event?.preventDefault()
    const question = input.trim()
    if (!question || !textbookId || isStreaming) {
      return
    }

    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: question }])
    setIsStreaming(true)
    let aiText = ''
    setMessages((prev) => [...prev, { role: 'ai', content: '' }])

    try {
      for await (const eventChunk of streamRequest(`${API_ENDPOINTS.TEXTBOOK}/${textbookId}/query`, {
        question,
        selectedText,
        paragraph: selectedText,
        selectedPages,
      })) {
        if (eventChunk.event === 'stream') {
          aiText += String(eventChunk.data.content || '')
        }
        if (eventChunk.event === 'error') {
          aiText = String(eventChunk.data.message || '教材问答暂时失败，请稍后重试。')
        }

        setMessages((prev) => {
          const next = [...prev]
          next[next.length - 1] = {
            role: 'ai',
            content: formatTextbookAnswer(aiText) || '正在阅读教材内容...',
          }
          return next
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '教材问答暂时失败，请稍后重试。'
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = {
          role: 'ai',
          content: message,
        }
        return next
      })
    } finally {
      setIsStreaming(false)
    }
  }

  if (!textbookId) {
    return (
      <main className="mx-auto max-w-3xl">
        <p className="mb-3 text-sm font-bold uppercase tracking-[0.28em] text-emerald-800">P1-1 Textbook</p>
        <h1 className="ink-heading text-5xl">教材对话</h1>
        <section className="mt-8 rounded-[2rem] bg-white/75 p-6 shadow-sm">
          <h2 className="text-xl font-bold text-stone-900">上传教材</h2>
          <div
            onDrop={handleDrop}
            onDragOver={(event) => event.preventDefault()}
            onClick={() => inputRef.current?.click()}
            className="mt-5 grid min-h-[360px] cursor-pointer place-items-center rounded-[2rem] border-2 border-dashed border-emerald-900/25 bg-white/75 p-8 text-center transition hover:border-emerald-800 hover:bg-white"
          >
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.txt"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) {
                  uploadFile(file).catch(() => undefined)
                }
              }}
            />
            <div>
              <p className="text-2xl font-semibold text-stone-900">拖拽 PDF / DOCX / TXT 到这里</p>
              <p className="mt-3 text-sm text-stone-500">
                {isUploading ? '正在上传并处理教材...' : '上传后进入左侧对话、右侧阅读的双栏模式。'}
              </p>
            </div>
          </div>
        </section>
      </main>
    )
  }

  return (
    <div className="grid h-[calc(100vh-6rem)] min-h-[620px] overflow-hidden rounded-[2rem] bg-white shadow-sm lg:grid-cols-[360px_minmax(0,1fr)]">
      <section className="relative flex min-h-0 flex-col border-r border-stone-200 bg-stone-50/70">
        <header className="shrink-0 border-b border-stone-200 p-4">
          <button
            className="rounded-2xl border border-dashed border-stone-300 bg-white px-4 py-3 text-left text-sm text-stone-600"
            onClick={() => inputRef.current?.click()}
          >
            <span className="block font-semibold text-stone-900">重新上传教材</span>
            <span className="block max-w-[260px] truncate">{fileName}</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".pdf,.doc,.docx,.txt"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) {
                uploadFile(file).catch(() => undefined)
              }
            }}
          />
          {selectedText ? (
            <p className="mt-3 rounded-2xl bg-amber-100/70 p-3 text-xs text-stone-600">
              已聚焦文本：{selectedText.slice(0, 90)}
              {selectedText.length > 90 ? '...' : ''}
            </p>
          ) : null}
          {selectedPages.length > 0 ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-emerald-100/70 px-3 py-2 text-xs text-emerald-950">
              <span>已选 {selectedPages.length} 页：{selectedPages.join(', ')}</span>
              <button className="font-semibold" type="button" onClick={() => setSelectedPages([])}>
                清空
              </button>
            </div>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 pb-36">
          {messages.map((message, index) => (
            <article key={index} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={`max-w-[90%] rounded-[1.6rem] px-4 py-3 leading-7 ${
                  message.role === 'user' ? 'bg-[#efe6ff]' : 'bg-white shadow-sm'
                }`}
              >
                {message.role === 'ai' ? (
                  <MarkdownRenderer
                    content={formatTextbookAnswer(message.content) || '正在阅读...'}
                  />
                ) : (
                  <span className="whitespace-pre-wrap">{message.content || '正在阅读...'}</span>
                )}
              </div>
            </article>
          ))}
        </div>

        <form onSubmit={send} className="absolute bottom-4 left-4 right-4">
          <div className="flex items-end gap-2 rounded-[1.8rem] border border-stone-200 bg-white p-2 shadow-xl">
            <textarea
              className="min-h-[42px] flex-1 resize-none bg-transparent px-3 py-3 outline-none"
              placeholder="基于教材内容提问"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  send()
                }
              }}
            />
            <button
              type="submit"
              className="grid h-11 w-11 place-items-center rounded-full bg-stone-950 text-white disabled:opacity-40"
              disabled={!input.trim() || isStreaming}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </form>
      </section>

      <section className="flex min-h-0 flex-col overflow-hidden bg-white">
        <header className="shrink-0 border-b border-stone-200 px-5 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-stone-950 md:text-xl">
                {fileName.replace(/\.[^.]+$/, '')}
              </h1>
              <p className="mt-1 text-xs text-stone-500">
                阅读区独立滚动。开启选页模式后，点击页面可作为附件发送给 AI。
              </p>
            </div>
            <div className="flex items-center gap-2">
              {fileType === 'pdf' ? (
                <button
                  type="button"
                  className={`rounded-full px-3 py-1 text-sm ${
                    isPageSelectionMode
                      ? 'bg-emerald-900 text-white'
                      : 'border border-stone-200 text-stone-600'
                  }`}
                  onClick={() => setIsPageSelectionMode((value) => !value)}
                >
                  {isPageSelectionMode ? '退出选页' : '选页模式'}
                </button>
              ) : null}
              <button
                className="shrink-0 rounded-full border border-stone-200 px-3 py-1 text-sm text-stone-500"
                onClick={() => {
                  setSelectedText('')
                  setSelectedPages([])
                }}
              >
                清除选区
              </button>
            </div>
          </div>
        </header>

        {fileType === 'pdf' && pageNumbers.length > 0 ? (
          <article className="min-h-0 flex-1 overflow-y-auto bg-stone-100 px-4 py-6 md:px-6">
            <div className="mx-auto flex max-w-4xl flex-col gap-6">
              {pageNumbers.map((pageNum) => {
                const isSelected = selectedPages.includes(pageNum)
                return (
                  <button
                    key={pageNum}
                    type="button"
                    data-page-button={pageNum}
                    onClick={() => togglePageSelection(pageNum)}
                    className={`overflow-hidden rounded-[1.5rem] border bg-white text-left shadow-sm transition ${
                      isPageSelectionMode ? 'cursor-pointer hover:border-emerald-400 hover:shadow-md' : 'cursor-default'
                    } ${isSelected ? 'border-emerald-600 ring-4 ring-emerald-200' : 'border-stone-200'}`}
                  >
                    <div className="flex items-center justify-between border-b border-stone-100 px-4 py-2 text-xs text-stone-500">
                      <span>第 {pageNum} 页</span>
                      {isSelected ? <span className="font-semibold text-emerald-700">已选中</span> : null}
                    </div>
                    <img
                      alt={`${fileName} 第 ${pageNum} 页`}
                      className={`w-full ${isSelected ? 'bg-emerald-50' : ''}`}
                      src={buildPageImageUrl(textbookId, pageNum, token)}
                    />
                  </button>
                )
              })}
            </div>
          </article>
        ) : fileType === 'pdf' && previewUrl ? (
          <article className="min-h-0 flex-1 overflow-hidden bg-stone-100">
            <iframe title={fileName} src={previewUrl} className="h-full w-full border-0" />
          </article>
        ) : (
          <article onMouseUp={captureSelection} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-8 md:px-8">
            <div className="mx-auto max-w-4xl space-y-6 text-lg leading-9 text-stone-800">
              {sections.map((section) => (
                <p key={section.paragraphIndex} data-page={section.pageNum}>
                  {section.text}
                </p>
              ))}
            </div>
          </article>
        )}
      </section>
    </div>
  )
}
