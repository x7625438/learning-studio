import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import apiClient, { API_ENDPOINTS } from '../utils/api-client'
import { streamRequest } from '../utils/sse'
import { PageShell, SectionCard } from '../components/PageShell'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { useAuthStore, useNotificationStore } from '../store'
import type {
  ApiResponse,
  EssayGradingSession,
  RubricListData,
  RubricTemplate,
  RubricDimension,
  DimensionScore,
  EssayGradingSSEEvent,
} from '../types/api'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXAM_TYPES = ['全部', '小学', '初中', '高中', '自定义']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreColor(score: number, maxScore: number): string {
  const ratio = score / maxScore
  if (ratio >= 0.85) return 'text-emerald-600'
  if (ratio >= 0.7) return 'text-blue-600'
  if (ratio >= 0.5) return 'text-amber-600'
  return 'text-red-500'
}

function scoreBgColor(score: number, maxScore: number): string {
  const ratio = score / maxScore
  if (ratio >= 0.85) return 'bg-emerald-500'
  if (ratio >= 0.7) return 'bg-blue-500'
  if (ratio >= 0.5) return 'bg-amber-500'
  return 'bg-red-500'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function EssayGrading() {
  // ---- views ----
  const [activeView, setActiveView] = useState<'list' | 'create' | 'grading' | 'detail'>('list')

  // ---- data ----
  const [sessions, setSessions] = useState<EssayGradingSession[]>([])
  const [rubrics, setRubrics] = useState<RubricListData | null>(null)
  const [selectedSession, setSelectedSession] = useState<EssayGradingSession | null>(null)
  const [loading, setLoading] = useState(false)

  // ---- create form ----
  const [title, setTitle] = useState('')
  const [essayText, setEssayText] = useState('')
  const [examTypeFilter, setExamTypeFilter] = useState('全部')
  const [selectedRubric, setSelectedRubric] = useState<RubricTemplate | null>(null)
  const [showCustomRubric, setShowCustomRubric] = useState(false)
  const [customRubric, setCustomRubric] = useState({
    name: '',
    examType: '自定义',
    totalScore: 100,
    dimensions: [
      { name: '内容立意', maxScore: 40, description: '' },
      { name: '语言表达', maxScore: 30, description: '' },
      { name: '结构逻辑', maxScore: 30, description: '' },
    ] as RubricDimension[],
  })
  const [creatingSession, setCreatingSession] = useState(false)

  // ---- grading ----
  const [gradingProgress, setGradingProgress] = useState({ phase: '', message: '', percentage: 0 })
  const [gradingDimensions, setGradingDimensions] = useState<DimensionScore[]>([])
  const [gradingFinal, setGradingFinal] = useState<{
    totalScore: number
    overallFeedback: string
    strengths: string[]
    weaknesses: string[]
    suggestions: string[]
  } | null>(null)
  const [gradingError, setGradingError] = useState<string | null>(null)

  const addNotification = useNotificationStore((s) => s.addNotification)
  const authToken = useAuthStore((s) => s.token)

  // ---- loading state ----
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [rubricsLoading, setRubricsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [rubricsError, setRubricsError] = useState<string | null>(null)

  // ---- load data (silent mode = no toast on failure, inline error instead) ----
  const loadSessions = useCallback(async () => {
    const token = localStorage.getItem('auth_token') || useAuthStore.getState().token
    if (!token) return
    setSessionsLoading(true)
    setSessionsError(null)
    try {
      const res = await apiClient.get<ApiResponse<EssayGradingSession[]>>(
        `${API_ENDPOINTS.ESSAY_GRADING}/sessions`,
        { silent: true, headers: { Authorization: `Bearer ${token}` } },
      )
      setSessions(res.data || [])
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
        || (err as Error)?.message
        || '加载失败'
      setSessionsError(msg)
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  const loadRubrics = useCallback(async () => {
    const token = localStorage.getItem('auth_token') || useAuthStore.getState().token
    if (!token) return
    setRubricsLoading(true)
    setRubricsError(null)
    try {
      const res = await apiClient.get<ApiResponse<RubricListData>>(
        `${API_ENDPOINTS.ESSAY_GRADING}/rubrics`,
        { silent: true, headers: { Authorization: `Bearer ${token}` } },
      )
      setRubrics(res.data)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
        || (err as Error)?.message
        || '加载失败'
      setRubricsError(msg)
    } finally {
      setRubricsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!authToken && !localStorage.getItem('auth_token')) return
    // Small delay to avoid React StrictMode double-mount race conditions
    const t = setTimeout(() => {
      loadSessions()
      loadRubrics()
    }, 50)
    return () => clearTimeout(t)
  }, [authToken, loadSessions, loadRubrics])

  // ---- rubric helpers ----
  const allRubrics: RubricTemplate[] = [
    ...(rubrics?.presets || []),
    ...(rubrics?.custom || []),
  ]

  const filteredRubrics = examTypeFilter === '全部'
    ? allRubrics
    : allRubrics.filter((r) => r.examType === examTypeFilter)

  // ---- create session ----
  const handleCreateSession = async () => {
    if (!title.trim() || essayText.trim().length < 50) return
    setCreatingSession(true)
    try {
      let rubricId: string | undefined
      if (showCustomRubric) {
        // Create the custom rubric first
        const rubricRes = await apiClient.post<ApiResponse<RubricTemplate>>(
          `${API_ENDPOINTS.ESSAY_GRADING}/rubrics`,
          {
            name: customRubric.name || '自定义评分标准',
            examType: customRubric.examType,
            dimensions: customRubric.dimensions,
            totalScore: customRubric.totalScore,
          },
        )
        rubricId = rubricRes.data.id
      } else if (selectedRubric) {
        rubricId = selectedRubric.id
      }

      const res = await apiClient.post<ApiResponse<{ id: string; status: string }>>(
        `${API_ENDPOINTS.ESSAY_GRADING}/start`,
        {
          title: title.trim(),
          essayText: essayText.trim(),
          rubricId,
          examType: showCustomRubric ? '自定义' : (selectedRubric?.examType || '自定义'),
        },
      )

      setActiveView('grading')
      startGrading(res.data.id)
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || '创建批改失败'
      addNotification({ type: 'error', message })
    } finally {
      setCreatingSession(false)
    }
  }

  // ---- SSE grading ----
  const startGrading = async (sessionId: string) => {
    setGradingDimensions([])
    setGradingFinal(null)
    setGradingError(null)
    setGradingProgress({ phase: 'connecting', message: '正在连接...', percentage: 0 })

    try {
      for await (const event of streamRequest(
        `${API_ENDPOINTS.ESSAY_GRADING}/${sessionId}/grade`,
        {},
      )) {
        const payload = event.data as unknown as EssayGradingSSEEvent

        switch (payload.type) {
          case 'progress':
            setGradingProgress({
              phase: payload.phase,
              message: payload.message,
              percentage: payload.percentage,
            })
            break
          case 'dimension':
            setGradingDimensions((prev) => {
              const next = [...prev]
              // place at correct index
              next[payload.index] = payload.data
              return next
            })
            break
          case 'final':
            setGradingFinal({
              totalScore: payload.data.totalScore,
              overallFeedback: payload.data.overallFeedback,
              strengths: payload.data.strengths,
              weaknesses: payload.data.weaknesses,
              suggestions: payload.data.suggestions,
            })
            break
          case 'error':
            setGradingError(payload.message)
            break
          case 'done':
            // refresh session list
            loadSessions()
            break
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '批改过程出错'
      setGradingError(message)
      addNotification({ type: 'error', message })
    }
  }

  const handleViewDetail = async (session: EssayGradingSession) => {
    setLoading(true)
    try {
      const res = await apiClient.get<ApiResponse<EssayGradingSession>>(
        `${API_ENDPOINTS.ESSAY_GRADING}/${session.id}`,
      )
      setSelectedSession(res.data)
      setActiveView('detail')
    } catch {
      // errors handled by interceptor
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteSession = async (id: string) => {
    if (!confirm('确定要删除这条批改记录吗？')) return
    try {
      await apiClient.delete(`${API_ENDPOINTS.ESSAY_GRADING}/${id}`)
      setSessions((prev) => prev.filter((s) => s.id !== id))
      addNotification({ type: 'success', message: '已删除' })
    } catch {
      // errors handled by interceptor
    }
  }

  const handleReset = () => {
    setActiveView('list')
    setTitle('')
    setEssayText('')
    setSelectedRubric(null)
    setShowCustomRubric(false)
    setGradingDimensions([])
    setGradingFinal(null)
    setGradingError(null)
    loadSessions()
  }

  // ---- custom rubric dimension helpers ----
  const addDimension = () => {
    setCustomRubric((prev) => ({
      ...prev,
      dimensions: [...prev.dimensions, { name: '', maxScore: 10, description: '' }],
    }))
  }

  const removeDimension = (index: number) => {
    setCustomRubric((prev) => ({
      ...prev,
      dimensions: prev.dimensions.filter((_, i) => i !== index),
    }))
  }

  const updateDimension = (index: number, field: keyof RubricDimension, value: string | number) => {
    setCustomRubric((prev) => ({
      ...prev,
      dimensions: prev.dimensions.map((d, i) =>
        i === index ? { ...d, [field]: value } : d,
      ),
    }))
  }

  const customDimensionSum = customRubric.dimensions.reduce((sum, d) => sum + (d.maxScore || 0), 0)

  // ===================================================================
  // RENDER: List View
  // ===================================================================
  if (activeView === 'list') {
    return (
      <PageShell
        eyebrow="Writing Grading"
        title="作文批改"
        description="提交你的作文，选择对应学段的评分标准，AI 逐维度打分并提供详细反馈。"
        action={
          <button
            onClick={() => setActiveView('create')}
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-emerald-700 transition-colors"
          >
            + 新建批改
          </button>
        }
      >
        {sessionsLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-stone-400">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-emerald-500" />
            <p className="mt-3 text-sm">加载中...</p>
          </div>
        ) : sessionsError ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-red-200 bg-red-50 py-16 text-red-500">
            <p className="text-sm font-medium">加载失败：{sessionsError}</p>
            <button onClick={loadSessions} className="mt-3 text-sm underline hover:text-red-700">点击重试</button>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-stone-300 py-20 text-stone-400">
            <svg className="mb-4 h-14 w-14 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h6m-3-3v6m-7 4h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <p className="text-lg font-medium">还没有批改记录</p>
            <p className="mt-1 text-sm">点击上方按钮开始第一次作文批改</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sessions.map((s) => (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="group cursor-pointer rounded-xl border border-stone-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
                onClick={() => handleViewDetail(s)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-stone-800 truncate">{s.title}</h3>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="inline-block rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-500">
                        {s.examType}
                      </span>
                      {s.status === 'completed' && s.totalScore != null && (
                        <span className={`text-lg font-bold ${scoreColor(s.totalScore, s.rubricSnapshot?.totalScore || 100)}`}>
                          {s.totalScore}
                          <span className="text-xs font-normal text-stone-400">/{s.rubricSnapshot?.totalScore || 100}</span>
                        </span>
                      )}
                      {s.status !== 'completed' && (
                        <span className="text-xs text-stone-400">
                          {s.status === 'processing' ? '批改中...' : s.status === 'error' ? '批改失败' : '待批改'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-stone-400">
                  <span>{s.createdAt?.slice(0, 10)}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id) }}
                    className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-all"
                  >
                    删除
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </PageShell>
    )
  }

  // ===================================================================
  // RENDER: Create View
  // ===================================================================
  if (activeView === 'create') {
    return (
      <PageShell
        eyebrow="Writing Grading"
        title="新建批改"
        description="输入你的文章，选择或自定义评分标准。"
        action={
          <button
            onClick={() => setActiveView('list')}
            className="rounded-lg border border-stone-300 px-5 py-2.5 text-sm font-medium text-stone-600 hover:bg-stone-50 transition-colors"
          >
            ← 返回列表
          </button>
        }
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          {/* Left: Essay Input */}
          <SectionCard title="文章内容" description="输入你要批改的主观题答案或作文">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">文章标题</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例如：2024年高考语文作文·人工智能与人文关怀"
                  className="w-full rounded-lg border border-stone-300 px-4 py-2.5 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">
                  文章内容
                  <span className="ml-2 text-xs text-stone-400">{essayText.length} 字</span>
                </label>
                <textarea
                  value={essayText}
                  onChange={(e) => setEssayText(e.target.value)}
                  placeholder="在此粘贴或输入你的文章...&#10;&#10;至少需要50个字才能进行有意义的批改。建议包含完整的开头、正文和结尾。"
                  rows={18}
                  className="w-full rounded-lg border border-stone-300 px-4 py-3 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none resize-y min-h-[300px]"
                />
                {essayText.length > 0 && essayText.length < 50 && (
                  <p className="mt-1 text-xs text-amber-500">至少需要 50 个字（当前 {essayText.length} 字）</p>
                )}
              </div>
            </div>
          </SectionCard>

          {/* Right: Rubric Selection */}
          <div className="space-y-5">
            <SectionCard title="评分标准" description="选择评分标准或自定义评分维度">
              {rubricsLoading ? (
                <div className="flex items-center justify-center py-8 text-stone-400">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-emerald-500 mr-2" />
                  <span className="text-sm">加载评分标准...</span>
                </div>
              ) : rubricsError ? (
                <div className="text-center py-6 text-amber-600 text-sm">
                  <p>评分标准加载失败，仅显示内置标准</p>
                  <button onClick={loadRubrics} className="mt-1 underline hover:text-amber-800 text-xs">点击重试</button>
                </div>
              ) : null}
              {/* Exam type filter */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                {EXAM_TYPES.map((et) => (
                  <button
                    key={et}
                    onClick={() => { setExamTypeFilter(et); setSelectedRubric(null) }}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      examTypeFilter === et
                        ? 'bg-emerald-600 text-white'
                        : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                    }`}
                  >
                    {et}
                  </button>
                ))}
              </div>

              {/* Rubric list */}
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {filteredRubrics.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => { setSelectedRubric(r); setShowCustomRubric(false) }}
                    className={`w-full text-left rounded-lg border p-3 transition-colors ${
                      selectedRubric?.id === r.id && !showCustomRubric
                        ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500'
                        : 'border-stone-200 hover:border-stone-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-stone-800">{r.name}</span>
                      <span className="text-xs text-stone-400">{r.totalScore}分</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.dimensions.map((d) => (
                        <span key={d.name} className="inline-block rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500">
                          {d.name}({d.maxScore})
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
                {filteredRubrics.length === 0 && (
                  <p className="text-sm text-stone-400 text-center py-4">暂无该类型的评分标准</p>
                )}
              </div>

              {/* Custom rubric toggle */}
              <button
                onClick={() => { setShowCustomRubric(!showCustomRubric); if (!showCustomRubric) setSelectedRubric(null) }}
                className={`w-full mt-3 rounded-lg border-2 border-dashed p-3 text-sm font-medium transition-colors ${
                  showCustomRubric
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-stone-300 text-stone-500 hover:border-stone-400'
                }`}
              >
                + 自定义评分标准
              </button>
            </SectionCard>

            {/* Custom rubric editor */}
            <AnimatePresence>
              {showCustomRubric && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <SectionCard title="自定义评分标准" className="!border-emerald-300">
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-stone-600 mb-1">评分标准名称</label>
                        <input
                          type="text"
                          value={customRubric.name}
                          onChange={(e) => setCustomRubric((p) => ({ ...p, name: e.target.value }))}
                          placeholder="我的评分标准"
                          className="w-full rounded border border-stone-300 px-3 py-1.5 text-sm focus:border-emerald-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-stone-600 mb-1">
                          总分
                          <span className={`ml-2 ${Math.abs(customDimensionSum - customRubric.totalScore) > 0.01 ? 'text-red-500' : 'text-emerald-600'}`}>
                            维度合计：{customDimensionSum}
                          </span>
                        </label>
                        <input
                          type="number"
                          value={customRubric.totalScore}
                          onChange={(e) => setCustomRubric((p) => ({ ...p, totalScore: Number(e.target.value) || 100 }))}
                          className="w-24 rounded border border-stone-300 px-3 py-1.5 text-sm focus:border-emerald-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-stone-600 mb-2">评分维度</label>
                        {customRubric.dimensions.map((dim, i) => (
                          <div key={i} className="flex items-center gap-2 mb-2">
                            <input
                              type="text"
                              value={dim.name}
                              onChange={(e) => updateDimension(i, 'name', e.target.value)}
                              placeholder="维度名称"
                              className="flex-1 rounded border border-stone-300 px-2 py-1 text-xs focus:border-emerald-500 outline-none"
                            />
                            <input
                              type="number"
                              value={dim.maxScore}
                              onChange={(e) => updateDimension(i, 'maxScore', Number(e.target.value) || 0)}
                              placeholder="满分"
                              className="w-16 rounded border border-stone-300 px-2 py-1 text-xs focus:border-emerald-500 outline-none"
                            />
                            <button
                              onClick={() => removeDimension(i)}
                              disabled={customRubric.dimensions.length <= 2}
                              className="text-red-400 hover:text-red-600 text-xs disabled:opacity-30"
                            >
                              删除
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={addDimension}
                          disabled={customRubric.dimensions.length >= 8}
                          className="text-xs text-emerald-600 hover:text-emerald-700 disabled:opacity-30"
                        >
                          + 添加维度
                        </button>
                      </div>
                    </div>
                  </SectionCard>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Submit */}
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-stone-400">
            {(!showCustomRubric && !selectedRubric) ? '请选择一个评分标准或自定义评分标准' : ''}
          </p>
          <button
            onClick={handleCreateSession}
            disabled={
              creatingSession ||
              !title.trim() ||
              essayText.trim().length < 50 ||
              (!showCustomRubric && !selectedRubric) ||
              (showCustomRubric && (!customRubric.name.trim() || Math.abs(customDimensionSum - customRubric.totalScore) > 0.01))
            }
            className="rounded-lg bg-emerald-600 px-8 py-3 text-sm font-semibold text-white shadow hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {creatingSession ? '正在创建...' : '开始批改'}
          </button>
        </div>
      </PageShell>
    )
  }

  // ===================================================================
  // RENDER: Grading View (SSE streaming)
  // ===================================================================
  if (activeView === 'grading') {
    const totalDimensions = gradingFinal
      ? gradingDimensions.filter(Boolean).length
      : (selectedRubric?.dimensions.length || customRubric.dimensions.length || 0)

    return (
      <PageShell
        eyebrow="Writing Grading"
        title="正在批改"
        description="AI 正在基于评分标准对你的文章进行逐维度评分..."
        action={
          <button
            onClick={handleReset}
            className="rounded-lg border border-stone-300 px-5 py-2.5 text-sm font-medium text-stone-600 hover:bg-stone-50 transition-colors"
          >
            {gradingFinal || gradingError ? '返回列表' : '取消批改'}
          </button>
        }
      >
        {/* Progress bar */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-stone-500">{gradingProgress.message || '准备中...'}</span>
            <span className="text-sm font-medium text-stone-600">{gradingProgress.percentage}%</span>
          </div>
          <div className="h-2 rounded-full bg-stone-200 overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${gradingError ? 'bg-red-500' : 'bg-emerald-500'}`}
              initial={{ width: 0 }}
              animate={{ width: `${gradingProgress.percentage}%` }}
              transition={{ duration: 0.4 }}
            />
          </div>
        </div>

        {/* Error state */}
        {gradingError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
            <p className="text-red-600 font-medium">{gradingError}</p>
            <button
              onClick={handleReset}
              className="mt-3 text-sm text-red-500 underline hover:text-red-700"
            >
              返回重试
            </button>
          </div>
        )}

        {/* Dimension cards (appear progressively) */}
        <div className="grid gap-4">
          <AnimatePresence>
            {gradingDimensions.filter(Boolean).map((dim, i) => (
              <motion.div
                key={dim.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0 }}
                className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-stone-800">
                    维度 {i + 1}/{totalDimensions || gradingDimensions.filter(Boolean).length}：{dim.name}
                  </h3>
                  <span className={`text-lg font-bold ${scoreColor(dim.score, dim.maxScore)}`}>
                    {dim.score}<span className="text-sm font-normal text-stone-400">/{dim.maxScore}</span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-stone-100 mb-3 overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${scoreBgColor(dim.score, dim.maxScore)}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${(dim.score / dim.maxScore) * 100}%` }}
                    transition={{ duration: 0.6, delay: 0.2 }}
                  />
                </div>
                <MarkdownRenderer content={dim.feedback} className="text-sm text-stone-600 leading-relaxed" />
                {dim.evidence && dim.evidence.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {dim.evidence.map((ev, j) => (
                      <p key={j} className="text-xs text-stone-400 italic pl-3 border-l-2 border-amber-300">
                        "{ev}"
                      </p>
                    ))}
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Final summary */}
        <AnimatePresence>
          {gradingFinal && (
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mt-6 space-y-5"
            >
              {/* Total score */}
              <SectionCard>
                <div className="flex items-center gap-6">
                  <div className="relative flex-shrink-0">
                    <svg className="h-24 w-24 -rotate-90" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="42" fill="none" stroke="#e7e5e4" strokeWidth="8" />
                      <motion.circle
                        cx="50" cy="50" r="42" fill="none"
                        stroke="currentColor"
                        strokeWidth="8" strokeLinecap="round"
                        className={scoreColor(gradingFinal.totalScore, selectedRubric?.totalScore || customRubric.totalScore || 100)}
                        strokeDasharray={`${2 * Math.PI * 42}`}
                        initial={{ strokeDashoffset: 2 * Math.PI * 42 }}
                        animate={{
                          strokeDashoffset: 2 * Math.PI * 42 * (1 - gradingFinal.totalScore / (selectedRubric?.totalScore || customRubric.totalScore || 100)),
                        }}
                        transition={{ duration: 1, ease: 'easeOut' }}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className={`text-2xl font-black ${scoreColor(gradingFinal.totalScore, selectedRubric?.totalScore || customRubric.totalScore || 100)}`}>
                        {gradingFinal.totalScore}
                      </span>
                      <span className="text-xs text-stone-400">/{selectedRubric?.totalScore || customRubric.totalScore || 100}</span>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-stone-800">综合评分</h3>
                    <div className="mt-1 text-sm text-stone-600 leading-relaxed">
                      <MarkdownRenderer content={gradingFinal.overallFeedback} />
                    </div>
                  </div>
                </div>
              </SectionCard>

              {/* Strengths / Weaknesses / Suggestions */}
              <div className="grid gap-5 md:grid-cols-3">
                <SectionCard title="✅ 优点" className="!border-emerald-200">
                  <ul className="space-y-2">
                    {gradingFinal.strengths.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-stone-700">
                        <span className="text-emerald-500 mt-0.5">•</span>
                        {s}
                      </li>
                    ))}
                  </ul>
                </SectionCard>

                <SectionCard title="⚠️ 不足" className="!border-amber-200">
                  <ul className="space-y-2">
                    {gradingFinal.weaknesses.map((w, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-stone-700">
                        <span className="text-amber-500 mt-0.5">•</span>
                        {w}
                      </li>
                    ))}
                  </ul>
                </SectionCard>

                <SectionCard title="💡 改进建议" className="!border-blue-200">
                  <ul className="space-y-2">
                    {gradingFinal.suggestions.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-stone-700">
                        <span className="text-blue-500 mt-0.5 font-medium">{i + 1}.</span>
                        {s}
                      </li>
                    ))}
                  </ul>
                </SectionCard>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </PageShell>
    )
  }

  // ===================================================================
  // RENDER: Detail View
  // ===================================================================
  if (activeView === 'detail' && selectedSession) {
    const s = selectedSession
    const rubric = s.rubricSnapshot
    return (
      <PageShell
        eyebrow="Writing Grading"
        title={s.title}
        description={`${s.examType} · ${rubric?.name || '自定义评分标准'} · ${s.createdAt?.slice(0, 10)}`}
        action={
          <div className="flex gap-2">
            <button
              onClick={() => setActiveView('list')}
              className="rounded-lg border border-stone-300 px-5 py-2.5 text-sm font-medium text-stone-600 hover:bg-stone-50 transition-colors"
            >
              ← 返回列表
            </button>
            <button
              onClick={() => handleDeleteSession(s.id)}
              className="rounded-lg border border-red-200 px-5 py-2.5 text-sm font-medium text-red-500 hover:bg-red-50 transition-colors"
            >
              删除
            </button>
          </div>
        }
      >
        {loading ? (
          <div className="text-center py-20 text-stone-400">加载中...</div>
        ) : (
          <div className="space-y-6">
            {/* Essay content */}
            <SectionCard title="文章原文">
              <div className="whitespace-pre-wrap text-sm text-stone-700 leading-relaxed max-h-[400px] overflow-y-auto">
                {s.essayText}
              </div>
            </SectionCard>

            {/* Total score */}
            {s.status === 'completed' && s.totalScore != null && (
              <>
                <div className="flex items-center gap-6 rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
                  <div className="relative flex-shrink-0">
                    <svg className="h-24 w-24 -rotate-90" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="42" fill="none" stroke="#e7e5e4" strokeWidth="8" />
                      <circle
                        cx="50" cy="50" r="42" fill="none"
                        stroke="currentColor"
                        strokeWidth="8" strokeLinecap="round"
                        className={scoreColor(s.totalScore, rubric?.totalScore || 100)}
                        strokeDasharray={`${2 * Math.PI * 42}`}
                        strokeDashoffset={2 * Math.PI * 42 * (1 - s.totalScore / (rubric?.totalScore || 100))}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className={`text-2xl font-black ${scoreColor(s.totalScore, rubric?.totalScore || 100)}`}>
                        {s.totalScore}
                      </span>
                      <span className="text-xs text-stone-400">/{rubric?.totalScore || 100}</span>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-stone-800">综合评分</h3>
                    <div className="mt-1 text-sm text-stone-600 leading-relaxed">
                      <MarkdownRenderer content={s.overallFeedback} />
                    </div>
                  </div>
                </div>

                {/* Dimension scores */}
                <div className="grid gap-4">
                  <h3 className="text-lg font-bold text-stone-800">维度评分</h3>
                  {s.dimensionScores.map((dim) => (
                    <div key={dim.name} className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold text-stone-800">{dim.name}</h4>
                        <span className={`text-lg font-bold ${scoreColor(dim.score, dim.maxScore)}`}>
                          {dim.score}<span className="text-sm font-normal text-stone-400">/{dim.maxScore}</span>
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-stone-100 mb-3 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${scoreBgColor(dim.score, dim.maxScore)}`}
                          style={{ width: `${(dim.score / dim.maxScore) * 100}%` }}
                        />
                      </div>
                      <MarkdownRenderer content={dim.feedback} className="text-sm text-stone-600 leading-relaxed" />
                      {dim.evidence && dim.evidence.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {dim.evidence.map((ev, j) => (
                            <p key={j} className="text-xs text-stone-400 italic pl-3 border-l-2 border-amber-300">
                              "{ev}"
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Strengths / Weaknesses / Suggestions */}
                <div className="grid gap-5 md:grid-cols-3">
                  <SectionCard title="✅ 优点" className="!border-emerald-200">
                    <ul className="space-y-2">
                      {s.strengths.map((str, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-stone-700">
                          <span className="text-emerald-500 mt-0.5">•</span>
                          <MarkdownRenderer content={str} className="text-sm" />
                        </li>
                      ))}
                    </ul>
                  </SectionCard>

                  <SectionCard title="⚠️ 不足" className="!border-amber-200">
                    <ul className="space-y-2">
                      {s.weaknesses.map((w, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-stone-700">
                          <span className="text-amber-500 mt-0.5">•</span>
                          <MarkdownRenderer content={w} className="text-sm" />
                        </li>
                      ))}
                    </ul>
                  </SectionCard>

                  <SectionCard title="💡 改进建议" className="!border-blue-200">
                    <ul className="space-y-2">
                      {s.suggestions.map((sg, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-stone-700">
                          <span className="text-blue-500 mt-0.5 font-medium">{i + 1}.</span>
                          <MarkdownRenderer content={sg} className="text-sm" />
                        </li>
                      ))}
                    </ul>
                  </SectionCard>
                </div>
              </>
            )}

            {s.status === 'error' && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-red-600">
                批改失败，请尝试重新批改
              </div>
            )}
          </div>
        )}
      </PageShell>
    )
  }

  return null
}
