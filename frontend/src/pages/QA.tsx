import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react'
import apiClient, { API_ENDPOINTS } from '../utils/api-client'
import { streamRequest } from '../utils/sse'
import { formatAiAnswer } from '../utils/textbook-format'
import MarkdownRenderer from '../components/MarkdownRenderer'

interface Message {
  role: 'user' | 'ai' | 'assistant'
  content: string
}

interface HistoryItem {
  id: string
  question: string
  finalAnswer?: string | null
  messages?: Message[]
  createdAt: string
  updatedAt?: string
  favorited: boolean
}

interface Attachment {
  name: string
  type: string
  text?: string
  imageBase64?: string
}

export default function QA() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [input, setInput] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)

  useEffect(() => {
    loadHistory().catch(() => undefined)
  }, [])

  async function loadHistory() {
    const response = await apiClient.get<{ data: HistoryItem[] }>(`${API_ENDPOINTS.QA}/history`)
    setHistory(response.data)
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.type.startsWith('image/')) {
      const imageBase64 = await readAsDataUrl(file)
      setAttachment({ name: file.name, type: file.type, imageBase64 })
      return
    }
    if (file.type.includes('text') || file.name.toLowerCase().endsWith('.txt')) {
      const text = await file.text()
      setAttachment({ name: file.name, type: file.type || 'text/plain', text: text.slice(0, 6000) })
      return
    }
    setAttachment({ name: file.name, type: file.type || 'file' })
  }

  async function send(event?: FormEvent) {
    event?.preventDefault()
    const question = input.trim()
    if ((!question && !attachment) || isStreaming) return

    const composedQuestion = [
      attachment ? `附件：${attachment.name}` : '',
      attachment?.text ? `附件文本：\n${attachment.text}` : '',
      question,
    ]
      .filter(Boolean)
      .join('\n\n')

    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: question || `请分析附件：${attachment?.name}` }])
    setIsStreaming(true)

    let aiText = ''
    const cleaner = createThinkStreamCleaner()
    setMessages((prev) => [...prev, { role: 'ai', content: '' }])

    try {
      for await (const chunk of streamRequest(`${API_ENDPOINTS.QA}/ask`, {
      question: composedQuestion,
      imageBase64: attachment?.imageBase64,
      sessionId: sessionId || undefined,
    })) {
      if (chunk.data.sessionId) setSessionId(String(chunk.data.sessionId))
      if (chunk.event === 'stream') aiText += cleaner.feed(String(chunk.data.content || ''))
      if (chunk.event === 'error') aiText = String(chunk.data.message || 'AI 服务暂时不可用')
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { role: 'ai', content: formatAiAnswer(aiText) || '正在思考...' }
        return next
      })
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }

      const finalText = formatAiAnswer(aiText + cleaner.flush())
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { role: 'ai', content: finalText || next[next.length - 1].content }
        return next
      })
      setAttachment(null)
      loadHistory().catch(() => undefined)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI service unavailable'
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { role: 'ai', content: message }
        return next
      })
    } finally {
      setIsStreaming(false)
    }
  }

  async function finalAnswer() {
    if (!sessionId || isStreaming) return
    setIsStreaming(true)
    let aiText = ''
    const cleaner = createThinkStreamCleaner()
    setMessages((prev) => [...prev, { role: 'ai', content: '' }])
    for await (const chunk of streamRequest(`${API_ENDPOINTS.QA}/${sessionId}/final`, {})) {
      if (chunk.event === 'stream') aiText += cleaner.feed(String(chunk.data.content || ''))
      if (chunk.event === 'error') aiText = String(chunk.data.message || 'AI 服务暂时不可用')
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { role: 'ai', content: formatAiAnswer(aiText) || '正在整理...' }
        return next
      })
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
    setIsStreaming(false)
  }

  async function deleteHistory(id: string) {
    await apiClient.delete(`${API_ENDPOINTS.QA}/${id}`)
    if (sessionId === id) {
      setSessionId('')
      setMessages([])
    }
    await loadHistory()
  }

  function openHistory(item: HistoryItem) {
    setSessionId(item.id)
    console.log('Opening history item:', item)
    console.log('Messages:', item.messages)

    const savedMessages = (item.messages || [])
      .filter((message) => message.content?.trim())
      .map((message) => ({
        role: (message.role === 'assistant' || message.role === 'ai' ? 'ai' : 'user') as 'user' | 'ai',
        content: formatAiAnswer(message.content),
      }))

    console.log('Saved messages after processing:', savedMessages)

    setMessages(
      savedMessages.length
        ? savedMessages
        : [
            { role: 'user', content: formatAiAnswer(item.question) },
            { role: 'ai', content: formatAiAnswer(item.finalAnswer || '这条历史记录还没有完整回答。') },
          ]
    )
  }

  function startNewChat() {
    setSessionId('')
    setMessages([])
    setAttachment(null)
  }

  return (
    <div className="grid h-[calc(100vh-3rem)] gap-0 overflow-hidden rounded-[2rem] bg-white shadow-sm lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="hidden min-h-0 border-r border-stone-200 bg-stone-50/80 p-4 lg:flex lg:flex-col">
        <button
          className="mb-4 w-full rounded-2xl bg-stone-950 px-4 py-3 text-sm font-semibold text-white"
          onClick={startNewChat}
        >
          新聊天
        </button>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-stone-400">History</p>
          <button className="text-xs text-stone-500 underline" onClick={loadHistory}>
            刷新
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {history.map((item) => (
            <div key={item.id} className="group rounded-2xl bg-white p-3 shadow-sm">
              <button className="block w-full text-left text-sm font-medium text-stone-800" onClick={() => openHistory(item)}>
                {formatAiAnswer(item.question).slice(0, 46)}
              </button>
              <div className="mt-2 flex items-center justify-between text-[11px] text-stone-400">
                <span>{(item.updatedAt || item.createdAt).slice(0, 10)}</span>
                <button className="opacity-0 underline transition group-hover:opacity-100" onClick={() => deleteHistory(item.id)}>
                  删除
                </button>
              </div>
            </div>
          ))}
          {!history.length && <p className="rounded-2xl bg-white p-4 text-sm text-stone-500">还没有历史聊天。</p>}
        </div>
      </aside>

      <section className="relative flex min-h-0 flex-col bg-white">
        <header className="shrink-0 border-b border-stone-100 px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-stone-950">即时问答</h1>
              <p className="text-sm text-stone-500">像普通 AI 助手一样提问，当前聊天会保留上下文。</p>
            </div>
            <button className="ghost-button" onClick={finalAnswer} disabled={!sessionId || isStreaming}>
              整理答案
            </button>
          </div>
        </header>

        <main className="mx-auto min-h-0 w-full max-w-4xl flex-1 overflow-y-auto px-5 pb-36 pt-6">
          {messages.length === 0 ? (
            <div className="grid min-h-full place-items-center text-center">
              <h2 className="text-3xl font-semibold text-stone-900">Hi，需要我帮你做什么？</h2>
            </div>
          ) : (
            <div className="space-y-8">
              {messages.map((message, index) => {
                const isUser = message.role === 'user'
                return (
                  <article key={index} className={isUser ? 'flex justify-end' : 'flex justify-start'}>
                    <div
                      className={
                        isUser
                          ? 'max-w-[76%] rounded-[2rem] bg-[#efe6ff] px-5 py-3 text-stone-900'
                          : 'max-w-[82%] rounded-[2rem] bg-stone-50 px-5 py-4 text-stone-800'
                      }
                    >
                      {isUser ? (
                        <div className="whitespace-pre-wrap leading-8">{message.content}</div>
                      ) : (
                        <MarkdownRenderer content={message.content || '正在思考...'} />
                      )}
                    </div>
                  </article>
                )
              })}
              <div ref={bottomRef} />
            </div>
          )}
        </main>

        <form onSubmit={send} className="absolute bottom-6 left-5 right-5">
          {attachment && (
            <div className="mx-auto mb-3 flex max-w-4xl items-center justify-between rounded-xl bg-blue-50 px-4 py-2.5 text-sm text-blue-700 border border-blue-200">
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
                {attachment.name}
              </span>
              <button type="button" className="text-blue-600 hover:text-blue-800 font-medium" onClick={() => setAttachment(null)}>
                移除
              </button>
            </div>
          )}
          <div className="mx-auto flex max-w-4xl items-end gap-2 rounded-3xl border-2 border-gray-200 bg-white p-2 shadow-lg hover:border-blue-300 focus-within:border-blue-400 transition-all duration-200">
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
            <button
              type="button"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-gray-600 hover:bg-gray-100 hover:text-gray-800 transition-colors duration-200"
              onClick={() => fileInputRef.current?.click()}
              aria-label="上传文件"
              title="上传文件"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
            <textarea
              className="min-h-[40px] max-h-[200px] flex-1 resize-none bg-transparent px-3 py-2.5 text-gray-800 placeholder-gray-400 outline-none text-[15px] leading-relaxed"
              placeholder="有问题，尽管问..."
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  send()
                }
              }}
              rows={1}
            />
            <button
              disabled={isStreaming || (!input.trim() && !attachment)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed transition-all duration-200 shadow-md hover:shadow-lg"
              title={isStreaming ? "发送中..." : "发送"}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            </button>
          </div>
          <p className="mt-3 text-center text-xs text-gray-400">AI 可能会出错，请核查重要信息</p>
        </form>
      </section>
    </div>
  )
}

function createThinkStreamCleaner() {
  let buffer = ''
  let insideThink = false

  return {
    feed(token: string) {
      buffer += token
      let output = ''

      while (buffer) {
        const lower = buffer.toLowerCase()
        if (insideThink) {
          const closeIndex = lower.indexOf('</think>')
          if (closeIndex === -1) {
            buffer = buffer.slice(-7)
            return output
          }
          buffer = buffer.slice(closeIndex + '</think>'.length)
          insideThink = false
          continue
        }

        const openIndex = lower.indexOf('<think>')
        const partialIndex = findPartialTagPrefix(lower, '<think>')
        if (openIndex === -1) {
          if (partialIndex >= 0) {
            output += buffer.slice(0, partialIndex)
            buffer = buffer.slice(partialIndex)
            return output
          }
          output += buffer
          buffer = ''
          return output
        }

        output += buffer.slice(0, openIndex)
        buffer = buffer.slice(openIndex + '<think>'.length)
        insideThink = true
      }

      return output
    },
    flush() {
      if (insideThink) {
        buffer = ''
        insideThink = false
        return ''
      }
      const output = formatAiAnswer(buffer)
      buffer = ''
      return output
    },
  }
}

function findPartialTagPrefix(text: string, tag: string) {
  const maxLength = Math.min(text.length, tag.length - 1)
  for (let length = maxLength; length > 0; length -= 1) {
    if (tag.startsWith(text.slice(-length))) {
      return text.length - length
    }
  }
  return -1
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
