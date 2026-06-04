import { FormEvent, useEffect, useState } from 'react'
import { PageShell, SectionCard } from '../components/PageShell'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { formatAiAnswer } from '../utils/textbook-format'
import apiClient, { API_ENDPOINTS } from '../utils/api-client'
import { streamRequest } from '../utils/sse'

type DialogueMessage = {
  role: 'user' | 'ai' | 'report' | 'error'
  content: string
}

type HistorySession = {
  id: string
  concept: string
  status: 'active' | 'completed'
  roundCount: number
  understandingScore: number
  createdAt: string
  updatedAt: string
}

export default function Feynman() {
  const [concept, setConcept] = useState('梯度下降')
  const [sessionId, setSessionId] = useState('')
  const [intro, setIntro] = useState('')
  const [explanation, setExplanation] = useState('')
  const [dialogue, setDialogue] = useState<DialogueMessage[]>([])
  const [history, setHistory] = useState<HistorySession[]>([])
  const [isStreaming, setIsStreaming] = useState(false)

  useEffect(() => {
    loadHistory()
  }, [])

  async function loadHistory() {
    try {
      const response = await apiClient.get<{ data: HistorySession[] }>(`${API_ENDPOINTS.FEYNMAN}/history`)
      setHistory(response.data)
    } catch (error) {
      console.error('加载历史失败:', error)
    }
  }

  async function start(event: FormEvent) {
    event.preventDefault()
    const response = await apiClient.post<{ data: { id: string; conceptIntro: string } }>(
      `${API_ENDPOINTS.FEYNMAN}/start`,
      { concept }
    )
    setSessionId(response.data.id)
    setIntro(response.data.conceptIntro)
    setDialogue([])
    await loadHistory()
  }

  async function loadSession(session: HistorySession) {
    setSessionId(session.id)
    setConcept(session.concept)
    setDialogue([])
    setIntro(`继续讲解「${session.concept}」`)
  }

  async function deleteSession(sessionId: string, event: React.MouseEvent) {
    event.stopPropagation()
    if (!confirm('确定要删除这条历史记录吗？')) return
    try {
      await apiClient.delete(`${API_ENDPOINTS.FEYNMAN}/${sessionId}`)
      if (sessionId === sessionId) {
        setSessionId('')
        setDialogue([])
        setIntro('')
      }
      await loadHistory()
    } catch (error) {
      console.error('删除失败:', error)
    }
  }

  async function explain() {
    const text = explanation.trim()
    if (!sessionId || !text || isStreaming) return
    setIsStreaming(true)
    setDialogue((prev) => [...prev, { role: 'user', content: text }, { role: 'ai', content: '' }])
    setExplanation('')
    try {
      for await (const event of streamRequest(`${API_ENDPOINTS.FEYNMAN}/${sessionId}/explain`, { text })) {
        if (event.event === 'stream') {
          appendToLastAiMessage(String(event.data.content || ''))
        }
        if (event.event === 'question') {
          appendToLastAiMessage(String(event.data.question || ''))
        }
        if (event.event === 'final') {
          setDialogue((prev) => [...prev, { role: 'report', content: JSON.stringify(event.data.report) }])
          await loadHistory()
        }
        if (event.event === 'error') {
          setDialogue((prev) => [...prev, { role: 'error', content: String(event.data.message || 'AI 暂时不可用') }])
        }
      }
    } finally {
      setIsStreaming(false)
    }
  }

  function appendToLastAiMessage(content: string) {
    if (!content) return
    setDialogue((prev) => {
      const next = [...prev]
      const lastIndex = next.length - 1
      if (lastIndex < 0 || next[lastIndex].role !== 'ai') return [...next, { role: 'ai', content }]
      next[lastIndex] = { ...next[lastIndex], content: next[lastIndex].content + content }
      return next
    })
  }

  return (
    <PageShell eyebrow="P2-1 Feynman" title="费曼学习法" description="用自己的话讲清楚，AI 只追问一个不清楚的点。">
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <div className="space-y-5">
          <SectionCard title="选择概念">
            <form onSubmit={start} className="space-y-4">
              <input
                className="field"
                value={concept}
                onChange={(event) => setConcept(event.target.value)}
                placeholder="输入要学习的概念..."
              />
              <button className="w-full rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-700 px-6 py-3 font-semibold text-white shadow-md hover:from-emerald-700 hover:to-emerald-800 transition-all duration-200 hover:shadow-lg">
                开始讲解
              </button>
            </form>
            {intro && <p className="mt-5 rounded-2xl bg-amber-50 border border-amber-200 p-4 text-sm text-stone-700 leading-relaxed">{intro}</p>}
          </SectionCard>

          <SectionCard title="历史对话">
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {history.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">暂无历史记录</p>
              ) : (
                history.map((session) => (
                  <div
                    key={session.id}
                    className={`group relative p-3 rounded-xl border transition-all duration-200 ${
                      sessionId === session.id
                        ? 'bg-emerald-50 border-emerald-300'
                        : 'bg-white border-stone-200 hover:border-emerald-200 hover:bg-emerald-50/50'
                    }`}
                  >
                    <button
                      onClick={() => loadSession(session)}
                      className="w-full text-left"
                    >
                      <div className="font-medium text-stone-800 text-sm truncate pr-8">{session.concept}</div>
                      <div className="flex items-center justify-between mt-1 text-xs text-stone-500">
                        <span>轮次: {session.roundCount}</span>
                        <span className={session.status === 'completed' ? 'text-emerald-600' : 'text-blue-600'}>
                          {session.status === 'completed' ? '已完成' : '进行中'}
                        </span>
                      </div>
                    </button>
                    <button
                      onClick={(e) => deleteSession(session.id, e)}
                      className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-100 rounded-lg"
                      title="删除"
                    >
                      <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          </SectionCard>
        </div>

        <SectionCard title="讲解区">
          <div className="min-h-[280px] space-y-3">
            {dialogue.map((item, index) => {
              const roleLabel =
                item.role === 'user' ? '我：' :
                item.role === 'ai' ? 'AI：' :
                item.role === 'report' ? '报告：' :
                '错误：'

              const containerClass =
                item.role === 'user'
                  ? 'bg-emerald-900 text-white'
                  : item.role === 'error'
                    ? 'bg-red-50 text-red-700 border border-red-200'
                    : item.role === 'report'
                      ? 'bg-amber-50 border border-amber-200'
                      : 'bg-stone-50 border border-stone-200'

              const isAiOrReport = item.role === 'ai' || item.role === 'report'

              return (
                <div key={index} className={`rounded-2xl p-4 leading-relaxed ${containerClass}`}>
                  <span className="font-semibold">{roleLabel}</span>
                  {isAiOrReport && item.content ? (
                    <MarkdownRenderer
                      content={formatAiAnswer(item.content)}
                      className={item.role === 'ai' ? 'text-stone-700' : ''}
                    />
                  ) : (
                    <span className={item.role === 'user' ? '' : 'text-stone-700'}>
                      {item.content || (item.role === 'ai' ? '思考中...' : '')}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          <div className="mt-5 relative">
            <textarea
              className="field min-h-[120px] resize-none pr-16"
              value={explanation}
              onChange={(event) => setExplanation(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  explain()
                }
              }}
              placeholder="像教小朋友一样解释这个概念...&#10;&#10;按 Enter 发送，Shift+Enter 换行"
              disabled={isStreaming || !sessionId}
            />
            <button
              className="absolute bottom-3 right-3 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 p-2.5 text-white shadow-md hover:from-emerald-700 hover:to-emerald-800 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed transition-all duration-200 hover:shadow-lg"
              disabled={isStreaming || !explanation.trim() || !sessionId}
              onClick={explain}
              title={isStreaming ? '对话中...' : '发送'}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            </button>
          </div>
        </SectionCard>
      </div>
    </PageShell>
  )
}
