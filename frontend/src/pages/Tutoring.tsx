import { FormEvent, useEffect, useRef, useState } from 'react'
import { PageShell, SectionCard } from '../components/PageShell'
import apiClient, { API_ENDPOINTS } from '../utils/api-client'
import { streamRequest } from '../utils/sse'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { formatAiAnswer } from '../utils/textbook-format'
import type { TutoringSessionListItem, TutoringStartResponse } from '../types/api'

type DialogueMessage = {
  role: 'student' | 'tutor' | 'system' | 'error'
  content: string
}

type ProblemInfo = {
  subject: string
  knowledgePoints: string[]
  difficulty: string
  gradeLevel: string
}

const DIFFICULTY_COLORS: Record<string, string> = {
  '简单': 'bg-emerald-100 text-emerald-700',
  '中等': 'bg-amber-100 text-amber-700',
  '困难': 'bg-red-100 text-red-700',
}

export default function Tutoring() {
  // Problem input state
  const [problemText, setProblemText] = useState('')
  const [imageBase64, setImageBase64] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)

  // Session state
  const [sessionId, setSessionId] = useState('')
  const [problemInfo, setProblemInfo] = useState<ProblemInfo | null>(null)
  const [dialogue, setDialogue] = useState<DialogueMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [solved, setSolved] = useState(false)

  // History
  const [history, setHistory] = useState<TutoringSessionListItem[]>([])
  const [activeTab, setActiveTab] = useState<'input' | 'chat'>('input')

  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadHistory()
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [dialogue])

  async function loadHistory() {
    try {
      const response = await apiClient.get<{ data: TutoringSessionListItem[] }>(
        `${API_ENDPOINTS.TUTORING}/?limit=50`
      )
      setHistory(response.data)
    } catch (error) {
      console.error('加载历史失败:', error)
    }
  }

  function handleImageSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      alert('图片不能超过 10MB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      setImageBase64(result)
      setImagePreview(result)
    }
    reader.readAsDataURL(file)
    // Reset input so the same file can be re-selected
    event.target.value = ''
  }

  function removeImage() {
    setImageBase64(null)
    setImagePreview(null)
  }

  async function handleStart(event?: FormEvent) {
    if (event) event.preventDefault()
    if (!problemText.trim() && !imageBase64) return

    try {
      const response = await apiClient.post<{ data: TutoringStartResponse }>(
        `${API_ENDPOINTS.TUTORING}/start`,
        { problemText: problemText.trim(), imageBase64 }
      )
      const { sessionId: id, problemAnalysis, greeting } = response.data
      setSessionId(id)
      setProblemInfo(problemAnalysis)
      setDialogue([{ role: 'tutor', content: greeting }])
      setSolved(false)
      setActiveTab('chat')
      await loadHistory()
    } catch (error) {
      console.error('开始讲题失败:', error)
    }
  }

  async function handleRespond() {
    const text = inputText.trim()
    if (!sessionId || !text || isStreaming) return
    setIsStreaming(true)
    setDialogue((prev) => [...prev, { role: 'student', content: text }, { role: 'tutor', content: '' }])
    setInputText('')
    try {
      for await (const event of streamRequest(`${API_ENDPOINTS.TUTORING}/${sessionId}/respond`, { message: text })) {
        if (event.event === 'stream') {
          appendToLastTutorMessage(String(event.data.content || ''))
        }
        if (event.event === 'final') {
          const data = event.data as Record<string, unknown>
          if (data.solved) {
            setSolved(true)
            setProblemInfo((prev) => prev ? { ...prev } : prev)
          }
          if (data.summary) {
            setDialogue((prev) => [...prev, { role: 'system', content: String(data.summary) }])
          }
          await loadHistory()
        }
        if (event.event === 'error') {
          setDialogue((prev) => [...prev, { role: 'error', content: String(event.data.message || 'AI 服务暂时不可用') }])
        }
      }
    } finally {
      setIsStreaming(false)
    }
  }

  function appendToLastTutorMessage(content: string) {
    if (!content) return
    setDialogue((prev) => {
      const next = [...prev]
      const lastIndex = next.length - 1
      if (lastIndex < 0 || next[lastIndex].role !== 'tutor') return [...next, { role: 'tutor', content }]
      next[lastIndex] = { ...next[lastIndex], content: next[lastIndex].content + content }
      return next
    })
  }

  async function loadSession(session: TutoringSessionListItem) {
    try {
      const response = await apiClient.get<{ data: { dialogue: DialogueMessage[]; problemInfo?: ProblemInfo; solved: boolean } }>(
        `${API_ENDPOINTS.TUTORING}/${session.id}`
      )
      setSessionId(session.id)
      setDialogue(response.data.dialogue || [])
      setSolved(response.data.solved || session.solved)
      if (response.data.problemInfo) setProblemInfo(response.data.problemInfo)
      setActiveTab('chat')
    } catch (error) {
      console.error('加载会话失败:', error)
    }
  }

  function newSession() {
    setSessionId('')
    setProblemInfo(null)
    setDialogue([])
    setInputText('')
    setImageBase64(null)
    setImagePreview(null)
    setSolved(false)
    setActiveTab('input')
  }

  async function deleteSession(sessionIdToDelete: string, event: React.MouseEvent) {
    event.stopPropagation()
    if (!confirm('确定要删除这条讲题记录吗？')) return
    try {
      await apiClient.delete(`${API_ENDPOINTS.TUTORING}/${sessionIdToDelete}`)
      if (sessionIdToDelete === sessionId) newSession()
      await loadHistory()
    } catch (error) {
      console.error('删除失败:', error)
    }
  }

  return (
    <PageShell eyebrow="苏格拉底式教学" title="启发讲题" description="AI 通过提问引导你自己发现答案，不给直接解答。">
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        {/* Sidebar */}
        <div className="space-y-5">
          <SectionCard title="开始讲题">
            <button
              onClick={newSession}
              className="w-full rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-700 px-6 py-3 font-semibold text-white shadow-md hover:from-indigo-700 hover:to-purple-800 transition-all duration-200 hover:shadow-lg"
            >
              + 新题目
            </button>
            {sessionId && activeTab === 'chat' && (
              <p className="mt-3 rounded-xl bg-indigo-50 border border-indigo-200 p-3 text-xs text-indigo-700 text-center">
                当前会话进行中
              </p>
            )}
          </SectionCard>

          <SectionCard title="讲题记录">
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {history.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">暂无讲题记录</p>
              ) : (
                history.map((session) => (
                  <div
                    key={session.id}
                    className={`group relative p-3 rounded-xl border transition-all duration-200 cursor-pointer ${
                      sessionId === session.id
                        ? 'bg-indigo-50 border-indigo-300'
                        : 'bg-white border-stone-200 hover:border-indigo-200 hover:bg-indigo-50/50'
                    }`}
                    onClick={() => loadSession(session)}
                  >
                    <div className="font-medium text-stone-800 text-sm truncate pr-8">
                      {session.problemText || '(图片题目)'}
                    </div>
                    <div className="flex items-center justify-between mt-1 text-xs text-stone-500">
                      <span>{session.subject || '未知学科'}</span>
                      <span className={session.solved ? 'text-emerald-600' : session.status === 'active' ? 'text-blue-600' : 'text-stone-400'}>
                        {session.solved ? '已解出' : session.status === 'active' ? '进行中' : '已结束'}
                      </span>
                    </div>
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

        {/* Main Area */}
        <SectionCard title={activeTab === 'input' ? '输入题目' : '讲题对话'}>
          {activeTab === 'input' ? (
            /* ---- Problem Input ---- */
            <form onSubmit={handleStart} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-2">
                  题目描述 <span className="text-stone-400">(可文字描述或拍照上传，也可同时提供)</span>
                </label>
                <textarea
                  className="field min-h-[180px] resize-y"
                  value={problemText}
                  onChange={(e) => setProblemText(e.target.value)}
                  placeholder="把题目输入在这里...&#10;&#10;例如：已知函数 f(x) = x² + 2x - 3，求 f(x) 在区间 [-2, 1] 上的最大值和最小值。"
                />
              </div>

              {/* Image upload */}
              <div>
                {imagePreview ? (
                  <div className="relative inline-block">
                    <img src={imagePreview} alt="题目图片预览" className="max-h-48 rounded-xl border border-stone-200 object-contain" />
                    <button
                      type="button"
                      onClick={removeImage}
                      className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 text-white text-xs flex items-center justify-center hover:bg-red-600 shadow"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-stone-300 text-sm text-stone-500 hover:border-indigo-400 hover:text-indigo-600 cursor-pointer transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    拍照上传题目
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleImageSelect}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              <button
                type="submit"
                disabled={!problemText.trim() && !imageBase64}
                className="w-full rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-700 px-6 py-3 font-semibold text-white shadow-md hover:from-indigo-700 hover:to-purple-800 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed transition-all duration-200 hover:shadow-lg"
              >
                开始启发讲题
              </button>
            </form>
          ) : (
            /* ---- Chat Dialogue ---- */
            <div className="space-y-4">
              {/* Problem info card */}
              {problemInfo && (
                <div className="rounded-2xl bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {problemInfo.subject && (
                      <span className="px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-700 font-medium">
                        {problemInfo.subject}
                      </span>
                    )}
                    {problemInfo.difficulty && (
                      <span className={`px-2.5 py-1 rounded-full font-medium ${DIFFICULTY_COLORS[problemInfo.difficulty] || 'bg-gray-100 text-gray-600'}`}>
                        {problemInfo.difficulty}
                      </span>
                    )}
                    {problemInfo.gradeLevel && (
                      <span className="px-2.5 py-1 rounded-full bg-purple-100 text-purple-700 font-medium">
                        {problemInfo.gradeLevel}
                      </span>
                    )}
                    {solved && (
                      <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                        ✓ 已解出
                      </span>
                    )}
                  </div>
                  {problemInfo.knowledgePoints.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {problemInfo.knowledgePoints.map((kp, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-lg bg-white/70 text-xs text-stone-600 border border-stone-200">
                          {kp}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Dialogue messages */}
              <div className="min-h-[280px] max-h-[460px] overflow-y-auto space-y-3 pr-1">
                {dialogue.map((item, index) => {
                  const roleLabel =
                    item.role === 'student' ? '我' :
                    item.role === 'tutor' ? '导师' :
                    item.role === 'system' ? '总结' : '错误'
                  const isRichContent = item.role === 'tutor' || item.role === 'system'

                  return (
                    <div
                      key={index}
                      className={`rounded-2xl p-4 leading-relaxed ${
                        item.role === 'student'
                          ? 'bg-indigo-900 text-white ml-8'
                          : item.role === 'error'
                            ? 'bg-red-50 text-red-700 border border-red-200'
                            : item.role === 'system'
                              ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                              : 'bg-stone-50 border border-stone-200 mr-8'
                      }`}
                    >
                      <div className="font-semibold text-xs mb-1 opacity-70">{roleLabel}</div>
                      {isRichContent && item.content ? (
                        <MarkdownRenderer
                          content={formatAiAnswer(item.content)}
                          className="text-sm"
                        />
                      ) : (
                        <div className="text-sm whitespace-pre-wrap">
                          {item.content || (item.role === 'tutor' ? '思考中...' : '')}
                        </div>
                      )}
                    </div>
                  )
                })}
                <div ref={chatEndRef} />
              </div>

              {/* Input area */}
              <div className="relative mt-5">
                <textarea
                  className="field min-h-[100px] resize-none pr-16"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleRespond()
                    }
                  }}
                  placeholder={solved ? '这道题已经解出来了！可以开始新的题目。' : '输入你的思路或答案...\n\n按 Enter 发送，Shift+Enter 换行'}
                  disabled={isStreaming || !sessionId || solved}
                />
                <button
                  className="absolute bottom-3 right-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-700 p-2.5 text-white shadow-md hover:from-indigo-700 hover:to-purple-800 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed transition-all duration-200 hover:shadow-lg"
                  disabled={isStreaming || !inputText.trim() || !sessionId || solved}
                  onClick={handleRespond}
                  title={isStreaming ? '思考中...' : solved ? '已解出' : '发送'}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </PageShell>
  )
}
