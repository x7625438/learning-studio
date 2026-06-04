import { useEffect, useState } from 'react'
import { PageShell } from '../components/PageShell'
import apiClient, { API_ENDPOINTS } from '../utils/api-client'
import { useNotificationStore } from '../store'
import MarkdownRenderer from '../components/MarkdownRenderer'

interface WrongQuestion {
  id: string
  questionText: string
  imageUrl?: string
  options: string[]
  subject: string
  difficulty: string
  userAnswer: string
  correctAnswer: string
  errorType: string
  errorAnalysis: string
  knowledgePoints: string[]
  aiExplanation: string
  status: string
  masteryLevel: number
  reviewCount: number
  createdAt: string
  similarQuestions?: SimilarQuestion[]
}

interface SimilarQuestion {
  id: string
  questionText: string
  diagramSvg?: string
  answer: string
  explanation?: string
  knowledgePoints?: string[]
  difficulty: string
  userAnswer: string | null
  isCorrect: number
}

interface SimilarFeedback {
  message: string
  tone: 'success' | 'warning' | 'error'
}

interface PracticeQuestion {
  id: string
  questionText: string
  options: string[]
  knowledgePoints: string[]
  difficulty: string
}

interface PracticeResult {
  questionId: string
  userAnswer: string
  isCorrect: boolean
  correctAnswer: string
  explanation: string
  addedToWrongQuestions: boolean
}

interface PracticeGeneratePayload {
  sessionId: string
  questions: PracticeQuestion[]
}

type MaybeWrapped<T> = T | { data?: T } | { data?: { data?: T } } | [MaybeWrapped<T>, unknown]

function unwrapApiData<T>(response: MaybeWrapped<T>): T | undefined {
  if (Array.isArray(response)) return unwrapApiData(response[0])
  if (!response || typeof response !== 'object') return undefined
  if ('data' in response) {
    const firstLayer = response.data
    if (firstLayer && typeof firstLayer === 'object' && 'data' in firstLayer) {
      return firstLayer.data as T
    }
    return firstLayer as T
  }
  return response as T
}

function renderSuperscriptText(text: string) {
  const parts = text.split(/(\^-?\d+)/g)

  return parts.map((part, index) => {
    if (/^\^-?\d+$/.test(part)) {
      return <sup key={`${part}-${index}`}>{part.slice(1)}</sup>
    }
    return <span key={`${part}-${index}`}>{part}</span>
  })
}

function normalizeTeacherTone(text: string) {
  return text
    .replace(/用户的/g, '你的')
    .replace(/学生的/g, '你的')
    .replace(/用户/g, '你')
    .replace(/学生/g, '你')
}

function shouldRenderCanonicalGeometry(questionText: string) {
  const normalized = questionText.replace(/\s+/g, '')
  return normalized.includes('△ABC') || normalized.includes('三角形ABC')
}

function renderCanonicalGeometryDiagram(questionText: string, title: string) {
  const normalized = questionText.replace(/\s+/g, '')
  const hasDOnBC = normalized.includes('点D在BC上')
  const hasConnectAD = normalized.includes('连接AD')
  const hasEOnAB = normalized.includes('点E在AB上')
  const hasFOnAC = normalized.includes('点F在AC上')
  const hasExtendToD =
    normalized.includes('延长BC到D') || normalized.includes('延长CB到D') || normalized.includes('点D在BC的延长线')

  return (
    <div className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
      <div className="border-b border-amber-100 bg-amber-50/80 px-4 py-2 text-xs font-medium tracking-[0.18em] text-amber-800">
        GEOMETRY DIAGRAM
      </div>
      <div className="bg-[#fffaf0] p-3">
        <svg viewBox="0 0 320 240" className="h-auto w-full" role="img" aria-label={title}>
          <path d="M35 205 L160 40 L285 205" fill="none" stroke="#3f3f46" strokeWidth="2.8" />
          <path d={hasExtendToD ? 'M35 205 L300 205' : 'M35 205 L285 205'} fill="none" stroke="#3f3f46" strokeWidth="2.8" />
          {hasDOnBC && hasConnectAD && (
            <path d="M160 40 L200 205" fill="none" stroke="#3f3f46" strokeWidth="2.8" />
          )}
          {hasEOnAB && <path d="M35 205 L120 93" fill="none" stroke="#3f3f46" strokeWidth="2.4" />}
          {hasFOnAC && <path d="M285 205 L210 106" fill="none" stroke="#3f3f46" strokeWidth="2.4" />}
          {hasExtendToD && <path d="M285 205 L300 205" fill="none" stroke="#3f3f46" strokeWidth="2.8" strokeDasharray="4 4" />}

          <circle cx="160" cy="40" r="3.5" fill="#3f3f46" />
          <circle cx="35" cy="205" r="3.5" fill="#3f3f46" />
          <circle cx="285" cy="205" r="3.5" fill="#3f3f46" />
          {hasDOnBC && <circle cx="200" cy="205" r="3.5" fill="#3f3f46" />}
          {hasExtendToD && <circle cx="300" cy="205" r="3.5" fill="#3f3f46" />}
          {hasEOnAB && <circle cx="120" cy="93" r="3.5" fill="#3f3f46" />}
          {hasFOnAC && <circle cx="210" cy="106" r="3.5" fill="#3f3f46" />}

          <text x="160" y="28" textAnchor="middle" fontSize="15" fill="#27272a">A</text>
          <text x="24" y="226" textAnchor="middle" fontSize="15" fill="#27272a">B</text>
          <text x="296" y="226" textAnchor="middle" fontSize="15" fill="#27272a">C</text>
          {hasDOnBC && <text x="214" y="198" textAnchor="middle" fontSize="15" fill="#27272a">D</text>}
          {hasExtendToD && <text x="312" y="226" textAnchor="middle" fontSize="15" fill="#27272a">D</text>}
          {hasEOnAB && <text x="120" y="86" textAnchor="middle" fontSize="15" fill="#27272a">E</text>}
          {hasFOnAC && <text x="224" y="106" textAnchor="middle" fontSize="15" fill="#27272a">F</text>}
        </svg>
      </div>
    </div>
  )
}

function GeometryDiagram({ svg, title, questionText }: { svg?: string; title: string; questionText: string }) {
  if (!svg) {
    if (shouldRenderCanonicalGeometry(questionText)) {
      return renderCanonicalGeometryDiagram(questionText, title)
    }
    return null
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
      <div className="border-b border-amber-100 bg-amber-50/80 px-4 py-2 text-xs font-medium tracking-[0.18em] text-amber-800">
        GEOMETRY DIAGRAM
      </div>
      <div
        className="p-3 [&_svg]:h-auto [&_svg]:w-full"
        aria-label={title}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  )
}

function buildAuthedAssetUrl(path?: string) {
  if (!path) return ''

  const token = localStorage.getItem('auth_token')
  const baseUrl = import.meta.env.VITE_API_URL || window.location.origin
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  if (!token) {
    return `${normalizedBaseUrl}${normalizedPath}`
  }

  const separator = normalizedPath.includes('?') ? '&' : '?'
  return `${normalizedBaseUrl}${normalizedPath}${separator}token=${encodeURIComponent(token)}`
}

export default function WrongQuestions() {
  const [questions, setQuestions] = useState<WrongQuestion[]>([])
  const [selectedQuestion, setSelectedQuestion] = useState<WrongQuestion | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [similarAnswers, setSimilarAnswers] = useState<Record<string, string>>({})
  const [similarFeedbacks, setSimilarFeedbacks] = useState<Record<string, SimilarFeedback>>({})
  const [reviewPlan, setReviewPlan] = useState<{ reviewCount: number; questions: WrongQuestion[] } | null>(null)
  const [activeTab, setActiveTab] = useState<'list' | 'detail' | 'review' | 'practice'>('list')
  const [expandedSections, setExpandedSections] = useState<{
    errorAnalysis: boolean
    aiExplanation: boolean
    similarQuestions: boolean
  }>({
    errorAnalysis: false,
    aiExplanation: false,
    similarQuestions: false,
  })

  // 专项练习相关状态
  const [showCountModal, setShowCountModal] = useState(false)
  const [practiceCount, setPracticeCount] = useState(5)
  const [isGeneratingPractice, setIsGeneratingPractice] = useState(false)
  const [practiceQuestions, setPracticeQuestions] = useState<PracticeQuestion[]>([])
  const [practiceAnswers, setPracticeAnswers] = useState<Record<string, string>>({})
  const [practiceResults, setPracticeResults] = useState<Record<string, PracticeResult>>({})
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false)

  const addNotification = useNotificationStore((s) => s.addNotification)

  const toggleSection = (section: 'errorAnalysis' | 'aiExplanation' | 'similarQuestions') => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }))
  }

  useEffect(() => {
    loadQuestions()
    loadReviewPlan()
  }, [])

  async function loadQuestions() {
    try {
      const response = await apiClient.get<{ data: WrongQuestion[] }>(API_ENDPOINTS.WRONG_QUESTIONS)
      setQuestions(response.data)
    } catch (error) {
      console.error('加载错题失败:', error)
    }
  }

  async function loadReviewPlan() {
    try {
      const response = await apiClient.get<{ data: { reviewCount: number; questions: WrongQuestion[] } }>(
        `${API_ENDPOINTS.WRONG_QUESTIONS}/review/plan`
      )
      setReviewPlan(response.data)
    } catch (error) {
      console.error('加载复习计划失败:', error)
    }
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    const formData = new FormData()
    formData.append('image', file)

    try {
      await apiClient.post<{ data: { id: string } }>(
        `${API_ENDPOINTS.WRONG_QUESTIONS}/upload`,
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 120000,
        }
      )
      addNotification({ type: 'success', message: '错题上传成功' })
      await loadQuestions()
      await loadReviewPlan()
    } catch (error: unknown) {
      console.error('上传失败:', error)
    } finally {
      setIsUploading(false)
      event.target.value = ''
    }
  }

  async function viewDetail(questionId: string) {
    try {
      const response = await apiClient.get<{ data: WrongQuestion }>(
        `${API_ENDPOINTS.WRONG_QUESTIONS}/${questionId}`,
        { timeout: 60000 }
      )
      setSelectedQuestion(response.data)
      setActiveTab('detail')
    } catch (error) {
      console.error('加载详情失败:', error)
    }
  }

  async function generateSimilar(questionId: string) {
    setIsGenerating(true)
    try {
      await apiClient.post(
        `${API_ENDPOINTS.WRONG_QUESTIONS}/${questionId}/generate-similar`,
        { count: 3 },
        { timeout: 120000 }
      )
      addNotification({ type: 'success', message: '已生成相似题目' })
      await viewDetail(questionId)
    } catch (error) {
      console.error('生成失败:', error)
      addNotification({ type: 'error', message: '生成失败' })
    } finally {
      setIsGenerating(false)
    }
  }

  async function submitSimilarAnswer(questionId: string, similarId: string) {
    const answer = similarAnswers[similarId]?.trim() || ''
    if (!answer) {
      setSimilarFeedbacks((prev) => ({
        ...prev,
        [similarId]: { tone: 'warning', message: '请先输入答案，再提交。' },
      }))
      return
    }

    try {
      const response = await apiClient.post<{ data: { isCorrect: boolean; feedback: string } }>(
        `${API_ENDPOINTS.WRONG_QUESTIONS}/${questionId}/similar/${similarId}/submit`,
        { answer }
      )
      setSimilarFeedbacks((prev) => ({
        ...prev,
        [similarId]: {
          tone: response.data.isCorrect ? 'success' : 'warning',
          message: response.data.feedback,
        },
      }))
      setSimilarAnswers((prev) => {
        const next = { ...prev }
        delete next[similarId]
        return next
      })
      await viewDetail(questionId)
    } catch (error) {
      console.error('提交失败:', error)
      setSimilarFeedbacks((prev) => ({
        ...prev,
        [similarId]: { tone: 'error', message: '提交失败，请稍后重试。' },
      }))
    }
  }

  async function deleteQuestion(questionId: string) {
    if (!confirm('确定要删除这道错题吗？')) return

    try {
      await apiClient.delete(`${API_ENDPOINTS.WRONG_QUESTIONS}/${questionId}`)
      addNotification({ type: 'success', message: '删除成功' })
      await loadQuestions()
      if (selectedQuestion?.id === questionId) {
        setSelectedQuestion(null)
        setActiveTab('list')
      }
    } catch (error) {
      console.error('删除失败:', error)
    }
  }

  async function handleGeneratePractice() {
    setIsGeneratingPractice(true)
    setShowCountModal(false)
    try {
      const response = await apiClient.post<MaybeWrapped<PracticeGeneratePayload>>(
        `${API_ENDPOINTS.WRONG_QUESTIONS}/practice/generate`,
        { count: practiceCount },
        { timeout: 120000 }
      )
      const questions = unwrapApiData(response)?.questions ?? []
      if (questions.length === 0) {
        addNotification({ type: 'warning', message: '暂未生成练习题，请稍后重试' })
        return
      }
      setPracticeQuestions(questions)
      setPracticeAnswers({})
      setPracticeResults({})
      setActiveTab('practice')
    } catch (error) {
      console.error('生成练习失败:', error)
      addNotification({ type: 'error', message: '生成练习失败，请稍后重试' })
    } finally {
      setIsGeneratingPractice(false)
    }
  }

  async function submitPracticeAnswer(questionId: string, answer: string) {
    if (!answer) return
    setIsSubmittingAnswer(true)
    try {
      const response = await apiClient.post<MaybeWrapped<PracticeResult>>(
        `${API_ENDPOINTS.WRONG_QUESTIONS}/practice/submit`,
        { questionId, answer }
      )
      const responseData = unwrapApiData(response)
      if (!responseData) return
      const result = { ...responseData, questionId, userAnswer: answer } as PracticeResult
      setPracticeResults((prev) => ({ ...prev, [questionId]: result }))
      if (result.addedToWrongQuestions) {
        addNotification({ type: 'warning', message: '答错了，已自动加入错题本' })
        await loadQuestions()
      }
    } catch (error) {
      console.error('提交答案失败:', error)
    } finally {
      setIsSubmittingAnswer(false)
    }
  }

  return (
    <PageShell
      eyebrow="Wrong Questions"
      title="错题本"
      description="上传错题照片，自动识别题目、错因和复习重点。"
    >
      {/* 顶部导航栏 - 简洁的标签页切换 */}
      <div className="mb-8 flex items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('list')}
            className={`px-6 py-2.5 rounded-full font-medium transition-all ${
              activeTab === 'list'
                ? 'bg-gray-900 text-white shadow-lg'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            错题列表
            {questions.length > 0 && (
              <span className="ml-2 text-sm opacity-75">({questions.length})</span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('review')}
            className={`px-6 py-2.5 rounded-full font-medium transition-all ${
              activeTab === 'review'
                ? 'bg-gray-900 text-white shadow-lg'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            复习计划
            {reviewPlan && reviewPlan.reviewCount > 0 && (
              <span className="ml-2 text-sm opacity-75">({reviewPlan.reviewCount})</span>
            )}
          </button>
        </div>

        {/* 上传按钮 - 右上角固定位置 */}
        <label className="cursor-pointer">
          <input
            type="file"
            accept="image/*"
            onChange={handleUpload}
            disabled={isUploading}
            className="hidden"
          />
          <div className="px-6 py-2.5 rounded-full bg-gray-900 text-white font-medium hover:bg-gray-800 transition-all shadow-lg hover:shadow-xl">
            {isUploading ? '上传中...' : '+ 上传错题'}
          </div>
        </label>
      </div>

      {/* 主内容区 */}
      {activeTab === 'list' && (
        <div className="space-y-4">
          {questions.length === 0 ? (
            <div className="text-center py-24">
              <div className="text-6xl mb-4">📚</div>
              <p className="text-gray-400 text-lg">还没有错题记录</p>
              <p className="text-gray-300 text-sm mt-2">点击右上角"上传错题"开始使用</p>
            </div>
          ) : (
            questions.map((q) => (
              <div
                key={q.id}
                onClick={() => viewDetail(q.id)}
                className="group p-6 bg-white rounded-2xl hover:shadow-lg transition-all cursor-pointer border border-gray-100"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    {/* 标签 */}
                    <div className="flex items-center gap-2 mb-3">
                      <span className="px-3 py-1 bg-gray-100 text-gray-700 text-xs rounded-full font-medium">
                        {q.subject}
                      </span>
                      <span className="px-3 py-1 bg-gray-100 text-gray-500 text-xs rounded-full">
                        {q.difficulty}
                      </span>
                      <span className="text-gray-300 text-xs">
                        {new Date(q.createdAt).toLocaleDateString('zh-CN')}
                      </span>
                    </div>

                    {/* 题目预览 */}
                    <div className="mb-3 line-clamp-2">
                      <MarkdownRenderer content={q.questionText} className="text-gray-800" />
                    </div>

                    {/* 底部信息 */}
                    <div className="flex items-center gap-4 text-sm text-gray-400">
                      <span>掌握度 {q.masteryLevel}%</span>
                      <span>·</span>
                      <span>复习 {q.reviewCount} 次</span>
                    </div>
                  </div>

                  {/* 删除按钮 */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteQuestion(q.id)
                    }}
                    className="opacity-0 group-hover:opacity-100 ml-4 p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'detail' && selectedQuestion && (
        <div className="max-w-4xl mx-auto space-y-6">
          {/* 返回按钮 */}
          <button
            onClick={() => setActiveTab('list')}
            className="flex items-center gap-2 text-gray-500 hover:text-gray-700 transition-colors mb-6"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            返回列表
          </button>

          {/* 题目卡片 */}
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100">
            {/* 标签 */}
            <div className="flex items-center gap-2 mb-6">
              <span className="px-3 py-1 bg-gray-100 text-gray-700 text-sm rounded-full font-medium">
                {selectedQuestion.subject}
              </span>
              <span className="px-3 py-1 bg-gray-100 text-gray-500 text-sm rounded-full">
                {selectedQuestion.difficulty}
              </span>
            </div>

            {/* 题目 */}
            <div className="mb-6">
              {selectedQuestion.imageUrl && (
                <div className="mb-6 overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
                  <img
                    src={buildAuthedAssetUrl(selectedQuestion.imageUrl)}
                    alt="错题原图"
                    className="max-h-[32rem] w-full object-contain"
                  />
                </div>
              )}

              <MarkdownRenderer content={selectedQuestion.questionText} className="text-lg text-gray-800 mb-4" />

              {/* 选项 */}
              {selectedQuestion.options && selectedQuestion.options.length > 0 && (
                <div className="space-y-2 mt-4">
                  {selectedQuestion.options.map((option, index) => {
                    const optionLetter = option.charAt(0)
                    const isUserAnswer = selectedQuestion.userAnswer === optionLetter
                    const isCorrectAnswer = selectedQuestion.correctAnswer === optionLetter

                    return (
                      <div
                        key={index}
                        className={`p-3 rounded-lg border-2 ${
                          isCorrectAnswer
                            ? 'border-green-500 bg-green-50'
                            : isUserAnswer
                            ? 'border-red-500 bg-red-50'
                            : 'border-gray-200 bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`font-medium ${
                            isCorrectAnswer ? 'text-green-700' : isUserAnswer ? 'text-red-700' : 'text-gray-700'
                          }`}>
                            {renderSuperscriptText(option)}
                          </span>
                          {isCorrectAnswer && (
                            <span className="ml-auto text-green-600 text-sm">✓ 正确答案</span>
                          )}
                          {isUserAnswer && !isCorrectAnswer && (
                            <span className="ml-auto text-red-600 text-sm">✗ 你的答案</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 答案对比 */}
            <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-xl">
              <div>
                <div className="text-xs text-gray-500 mb-1">你的答案</div>
                <div className="text-red-600 font-medium">{selectedQuestion.userAnswer}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">正确答案</div>
                <div className="text-green-600 font-medium">{selectedQuestion.correctAnswer}</div>
              </div>
            </div>
          </div>

          {/* 错误分析 - 可折叠 */}
          <button
            onClick={() => toggleSection('errorAnalysis')}
            className="w-full bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:border-gray-200 transition-all text-left"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-1 h-6 bg-orange-500 rounded-full"></div>
                <h3 className="text-lg font-semibold text-gray-800">错误分析</h3>
                <span className="px-3 py-1 bg-orange-50 text-orange-600 text-xs rounded-full">
                  {selectedQuestion.errorType}
                </span>
              </div>
              <svg
                className={`w-5 h-5 text-gray-400 transition-transform ${expandedSections.errorAnalysis ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>
          {expandedSections.errorAnalysis && (
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 -mt-4 pt-6">
              <MarkdownRenderer content={normalizeTeacherTone(selectedQuestion.errorAnalysis)} className="text-gray-600" />
            </div>
          )}

          {/* AI 讲解 - 可折叠 */}
          <button
            onClick={() => toggleSection('aiExplanation')}
            className="w-full bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:border-gray-200 transition-all text-left"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-1 h-6 bg-blue-500 rounded-full"></div>
                <h3 className="text-lg font-semibold text-gray-800">AI 讲解</h3>
              </div>
              <svg
                className={`w-5 h-5 text-gray-400 transition-transform ${expandedSections.aiExplanation ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>
          {expandedSections.aiExplanation && (
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 -mt-4 pt-6">
              <MarkdownRenderer content={selectedQuestion.aiExplanation} className="text-gray-600" />
            </div>
          )}

          {/* 知识点 */}
          {selectedQuestion.knowledgePoints.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedQuestion.knowledgePoints.map((kp, idx) => (
                <span key={idx} className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded-full">
                  {kp}
                </span>
              ))}
            </div>
          )}

          {/* 相似题目练习 - 可折叠 */}
          <button
            onClick={() => toggleSection('similarQuestions')}
            className="w-full bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:border-gray-200 transition-all text-left"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-1 h-6 bg-green-500 rounded-full"></div>
                <h3 className="text-lg font-semibold text-gray-800">相似题目练习</h3>
              </div>
              <svg
                className={`w-5 h-5 text-gray-400 transition-transform ${expandedSections.similarQuestions ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>
          {expandedSections.similarQuestions && (
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 -mt-4 pt-6">
              <div className="flex items-center justify-end mb-6">
                <button
                  onClick={() => generateSimilar(selectedQuestion.id)}
                  disabled={isGenerating}
                  className="px-6 py-2.5 rounded-full bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:bg-gray-300 transition-all"
                >
                  {isGenerating ? '生成中...' : '生成题目'}
                </button>
              </div>

              {selectedQuestion.similarQuestions && selectedQuestion.similarQuestions.length > 0 ? (
                <div className="space-y-6">
                  {selectedQuestion.similarQuestions.map((sq, idx) => (
                    <div key={sq.id} className="p-6 bg-gray-50 rounded-xl">
                      <div className={`mb-4 grid gap-5 ${sq.diagramSvg ? 'lg:grid-cols-[minmax(0,1.5fr)_320px]' : ''}`}>
                        <div>
                          <div className="text-sm text-gray-500 mb-2">题目 {idx + 1}</div>
                          <MarkdownRenderer content={sq.questionText} className="text-gray-800" />
                          {sq.knowledgePoints && sq.knowledgePoints.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {sq.knowledgePoints.map((point) => (
                                <span
                                  key={point}
                                  className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"
                                >
                                  {point}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <GeometryDiagram
                          svg={sq.diagramSvg}
                          questionText={sq.questionText}
                          title={`题目 ${idx + 1} 几何图`}
                        />
                      </div>

                      {sq.userAnswer ? (
                        <div className="space-y-3">
                          <div className={`p-4 rounded-lg ${sq.isCorrect ? 'bg-green-50' : 'bg-red-50'}`}>
                            <div className="text-sm text-gray-600 mb-1">
                              你的答案：<span className="font-medium text-gray-800">{sq.userAnswer}</span>
                            </div>
                            <div className="text-sm text-gray-600 mb-2">
                              参考答案：<span className="font-medium text-gray-800">{sq.answer}</span>
                            </div>
                            <div className={`text-sm font-medium ${sq.isCorrect ? 'text-green-600' : 'text-red-600'}`}>
                              {sq.isCorrect ? '✓ 回答正确' : '✗ 回答错误'}
                            </div>
                          </div>
                          {similarFeedbacks[sq.id] && (
                            <div
                              className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${
                                similarFeedbacks[sq.id].tone === 'success'
                                  ? 'border-green-200 bg-green-50 text-green-800'
                                  : similarFeedbacks[sq.id].tone === 'error'
                                    ? 'border-red-200 bg-red-50 text-red-700'
                                    : 'border-amber-200 bg-amber-50 text-amber-800'
                              }`}
                            >
                              <MarkdownRenderer content={similarFeedbacks[sq.id].message} className="text-sm" />
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="text-sm text-gray-600 mb-1">
                            参考答案会在你提交后显示
                          </div>
                          <textarea
                            value={similarAnswers[sq.id] || ''}
                            onChange={(e) =>
                              setSimilarAnswers((prev) => ({ ...prev, [sq.id]: e.target.value }))
                            }
                            placeholder="输入你的答案..."
                            className="w-full p-4 border border-gray-200 rounded-xl focus:border-gray-400 focus:outline-none resize-none text-gray-800"
                            rows={3}
                          />
                          <button
                            onClick={() => submitSimilarAnswer(selectedQuestion.id, sq.id)}
                            className="px-6 py-2.5 rounded-full bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 transition-all"
                          >
                            提交答案
                          </button>
                          {similarFeedbacks[sq.id] && (
                            <div
                              className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${
                                similarFeedbacks[sq.id].tone === 'success'
                                  ? 'border-green-200 bg-green-50 text-green-800'
                                  : similarFeedbacks[sq.id].tone === 'error'
                                    ? 'border-red-200 bg-red-50 text-red-700'
                                    : 'border-amber-200 bg-amber-50 text-amber-800'
                              }`}
                            >
                              <MarkdownRenderer content={similarFeedbacks[sq.id].message} className="text-sm" />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-gray-400">
                  点击"生成题目"开始练习
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'review' && (
        <div className="space-y-4">
          {/* 生成专项练习按钮 */}
          <div className="p-6 bg-white rounded-2xl border border-gray-100 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-gray-800">专项练习</h3>
                <p className="text-sm text-gray-400 mt-1">基于你的错题，AI 生成针对性练习题</p>
              </div>
              <button
                onClick={() => setShowCountModal(true)}
                disabled={isGeneratingPractice || questions.length === 0}
                className="px-6 py-2.5 rounded-full bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all"
              >
                {isGeneratingPractice ? '生成中...' : '生成专项练习'}
              </button>
            </div>
            {questions.length === 0 && (
              <p className="text-xs text-gray-400 mt-3">请先上传错题，才能生成专项练习</p>
            )}
          </div>

          {!reviewPlan || reviewPlan.reviewCount === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-4">✨</div>
              <p className="text-gray-400 text-lg">暂无需要复习的错题</p>
              <p className="text-gray-300 text-sm mt-2">继续加油！</p>
            </div>
          ) : (
            <>
              <div className="p-6 bg-blue-50 rounded-2xl border border-blue-100">
                <p className="text-blue-900 font-medium text-center">
                  今日需要复习 {reviewPlan.reviewCount} 道错题
                </p>
              </div>
              {reviewPlan.questions.map((q) => (
                <div
                  key={q.id}
                  onClick={() => viewDetail(q.id)}
                  className="p-6 bg-white rounded-2xl hover:shadow-lg transition-all cursor-pointer border border-gray-100"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span className="px-3 py-1 bg-gray-100 text-gray-700 text-xs rounded-full font-medium">
                      {q.subject}
                    </span>
                    <span className="px-3 py-1 bg-gray-100 text-gray-500 text-xs rounded-full">
                      {q.errorType}
                    </span>
                  </div>
                  <div className="text-sm line-clamp-2 mb-2">
                    <MarkdownRenderer content={q.questionText} className="text-gray-800" />
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* 专项练习答题界面 */}
      {activeTab === 'practice' && practiceQuestions.length > 0 && (
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={() => setActiveTab('review')}
              className="flex items-center gap-2 text-gray-500 hover:text-gray-700 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              退出练习
            </button>
            <div className="text-sm text-gray-500">
              {Object.keys(practiceResults).length} / {practiceQuestions.length} 已完成
            </div>
          </div>

          {/* 进度条 */}
          <div className="w-full h-1.5 bg-gray-100 rounded-full mb-8">
            <div
              className="h-full bg-gray-900 rounded-full transition-all duration-500"
              style={{ width: `${(Object.keys(practiceResults).length / practiceQuestions.length) * 100}%` }}
            />
          </div>

          {/* 所有题目 */}
          <div className="space-y-6">
            {practiceQuestions.map((q, idx) => {
              const result = practiceResults[q.id]
              const selectedAnswer = practiceAnswers[q.id]

              return (
                <div key={q.id} className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100">
                  <div className="flex items-center gap-3 mb-6">
                    <span className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-600 text-sm font-medium shrink-0">
                      {idx + 1}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {q.knowledgePoints.map((kp) => (
                        <span key={kp} className="px-3 py-1 bg-gray-50 text-gray-500 text-xs rounded-full">
                          {kp}
                        </span>
                      ))}
                    </div>
                  </div>

                  <MarkdownRenderer content={q.questionText} className="text-gray-800 mb-6 text-base" />

                  {/* 选项 */}
                  <div className="space-y-3">
                    {q.options.map((option) => {
                      const optionLetter = option.charAt(0)
                      const isSelected = selectedAnswer === optionLetter || result?.userAnswer === optionLetter
                      const isCorrect = result?.correctAnswer === optionLetter
                      const isWrong = result && result.userAnswer === optionLetter && !result.isCorrect

                      let optionStyle = 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-gray-100 cursor-pointer'
                      if (result) {
                        if (isCorrect) optionStyle = 'border-green-500 bg-green-50 cursor-default'
                        else if (isWrong) optionStyle = 'border-red-500 bg-red-50 cursor-default'
                        else optionStyle = 'border-gray-200 bg-gray-50 cursor-default opacity-60'
                      } else if (isSelected) {
                        optionStyle = 'border-gray-900 bg-gray-900/5 cursor-pointer'
                      }

                      return (
                        <button
                          key={optionLetter}
                          onClick={() => {
                            if (!result) {
                              setPracticeAnswers((prev) => ({ ...prev, [q.id]: optionLetter }))
                            }
                          }}
                          className={`w-full p-4 rounded-xl border-2 text-left transition-all ${optionStyle}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className={`${result && isCorrect ? 'text-green-800' : result && isWrong ? 'text-red-800' : 'text-gray-800'}`}>
                              <MarkdownRenderer content={option} className="inline" />
                            </span>
                            {result && isCorrect && <span className="text-green-600 text-sm ml-2 shrink-0">✓ 正确</span>}
                            {result && isWrong && <span className="text-red-600 text-sm ml-2 shrink-0">✗ 错误</span>}
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  {/* 提交 / 解析 */}
                  {!result ? (
                    <div className="mt-6 flex justify-end">
                      <button
                        onClick={() => submitPracticeAnswer(q.id, practiceAnswers[q.id] || '')}
                        disabled={!practiceAnswers[q.id] || isSubmittingAnswer}
                        className="px-8 py-2.5 rounded-full bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all"
                      >
                        {isSubmittingAnswer ? '提交中...' : '提交答案'}
                      </button>
                    </div>
                  ) : (
                    <div className={`mt-6 p-5 rounded-xl ${result.isCorrect ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                      <div className={`font-medium mb-3 ${result.isCorrect ? 'text-green-800' : 'text-red-800'}`}>
                        {result.isCorrect ? '✓ 回答正确！' : '✗ 回答错误，已加入错题本'}
                      </div>
                      <MarkdownRenderer content={result.explanation} className="text-gray-700 text-sm" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* 完成提示 */}
          {Object.keys(practiceResults).length === practiceQuestions.length && (
            <div className="mt-8 p-8 bg-white rounded-2xl border border-gray-100 shadow-sm text-center">
              <div className="text-4xl mb-3">🎉</div>
              <p className="text-xl font-semibold text-gray-800 mb-2">练习完成！</p>
              <p className="text-gray-500 mb-2">
                答对 {Object.values(practiceResults).filter((r) => r.isCorrect).length} / {practiceQuestions.length} 题
              </p>
              {Object.values(practiceResults).some((r) => !r.isCorrect) && (
                <p className="text-sm text-amber-600 mb-6">错误的题目已自动加入错题本</p>
              )}
              <button
                onClick={() => setActiveTab('review')}
                className="px-8 py-2.5 rounded-full bg-gray-900 text-white font-medium hover:bg-gray-800 transition-all"
              >
                返回复习计划
              </button>
            </div>
          )}
        </div>
      )}
      {/* 题目数量选择弹窗 */}
      {showCountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl p-8 shadow-2xl w-full max-w-sm mx-4">
            <h3 className="text-xl font-semibold text-gray-800 mb-2">生成专项练习</h3>
            <p className="text-sm text-gray-400 mb-6">选择本次练习的题目数量（1-20题）</p>

            {/* 快选 */}
            <div className="flex gap-3 mb-6">
              {[5, 10, 15, 20].map((n) => (
                <button
                  key={n}
                  onClick={() => setPracticeCount(n)}
                  className={`flex-1 py-2.5 rounded-full text-sm font-medium transition-all ${
                    practiceCount === n
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {n}题
                </button>
              ))}
            </div>

            {/* 自定义输入 */}
            <div className="flex items-center gap-3 mb-8">
              <span className="text-sm text-gray-500 shrink-0">自定义：</span>
              <input
                type="number"
                min={1}
                max={20}
                value={practiceCount}
                onChange={(e) => {
                  const v = parseInt(e.target.value)
                  if (!isNaN(v) && v >= 1 && v <= 20) setPracticeCount(v)
                }}
                className="w-20 text-center border border-gray-200 rounded-xl py-2 text-gray-800 focus:border-gray-400 focus:outline-none"
              />
              <span className="text-sm text-gray-400">题</span>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowCountModal(false)}
                className="flex-1 py-2.5 rounded-full border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-all"
              >
                取消
              </button>
              <button
                onClick={handleGeneratePractice}
                className="flex-1 py-2.5 rounded-full bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 transition-all"
              >
                开始生成
              </button>
            </div>
          </div>
        </div>
      )}

    </PageShell>
  )
}
