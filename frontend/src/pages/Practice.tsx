import { useEffect, useState } from 'react'
import MarkdownRenderer from '../components/MarkdownRenderer'
import 'katex/dist/katex.min.css'
import { EmptyState, PageShell, ProgressBar, SectionCard } from '../components/PageShell'
import { useNotificationStore, usePracticeStore } from '../store'
import type { DailyPracticeTask, PracticeQuestion } from '../types/api'
import apiClient, { API_ENDPOINTS } from '../utils/api-client'

export default function Practice() {
  const { task, fetchToday, submit } = usePracticeStore()
  const { addNotification } = useNotificationStore()
  const [localTask, setLocalTask] = useState<DailyPracticeTask | null>(null)
  const [index, setIndex] = useState(0)
  const [targetCount, setTargetCount] = useState(8)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [extraCount, setExtraCount] = useState(4)
  const [isGeneratingExtra, setIsGeneratingExtra] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)

  useEffect(() => {
    fetchToday().catch(() => undefined)
  }, [fetchToday])

  const activeTask = localTask || task
  const question = activeTask?.questions[index]
  const percent = activeTask
    ? Math.round((activeTask.completedCount / Math.max(1, activeTask.targetCount || 1)) * 100)
    : 0
  const isTaskCompleted = activeTask && activeTask.questions.length === 0 && activeTask.completedCount > 0

  async function generatePractice() {
    setIsGenerating(true)
    try {
      const response = await apiClient.post<{ data: DailyPracticeTask }>(
        `${API_ENDPOINTS.PRACTICE}/generate`,
        { targetCount: Number.isFinite(targetCount) ? targetCount : 5 },
        { timeout: 120000 }
      )
      setLocalTask(response.data)
      setIndex(0)
      setSelectedAnswer(null)
      setShowResult(false)
      if ((response.data.questions || []).length > 0) {
        addNotification({
          type: 'success',
          message: `已生成 ${response.data.questions.length} 道自适应试题`,
        })
      } else {
        addNotification({
          type: 'info',
          message: response.data.emptyReason || '当前还没有可生成的试题',
        })
      }
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } } }
      const errorMessage = err?.response?.data?.message || '生成训练失败，请稍后重试'
      addNotification({
        type: 'error',
        message: errorMessage,
      })
    } finally {
      setIsGenerating(false)
    }
  }

  async function answer(key: string) {
    if (!question || isSubmitting || showResult) return
    setSelectedAnswer(key)
    setShowResult(true)
  }

  async function nextQuestion() {
    if (!question || !selectedAnswer) return
    setIsSubmitting(true)
    try {
      const feeling = selectedAnswer === question.correctAnswer ? 'remember' : 'fuzzy'
      await submit(question.id, selectedAnswer, feeling)
      setLocalTask((current) =>
        current
          ? {
              ...current,
              completedCount: Math.min(current.targetCount, current.completedCount + 1),
            }
          : current
      )

      const nextIndex = index + 1
      if (nextIndex < (activeTask?.questions.length || 0)) {
        setIndex(nextIndex)
        setSelectedAnswer(null)
        setShowResult(false)
      } else {
        // 完成所有题目
        setShowCompleted(true)
        setLocalTask(null)
        await fetchToday()
        setIndex(0)
        setSelectedAnswer(null)
        setShowResult(false)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  async function generateExtra() {
    setIsGeneratingExtra(true)
    setShowCompleted(false)
    try {
      const response = await apiClient.post<{ data: { questions: PracticeQuestion[] } }>(
        `${API_ENDPOINTS.PRACTICE}/extra`,
        { count: extraCount },
        { timeout: 120000 }
      )
      const extraQuestions = response.data.questions || []
      if (extraQuestions.length > 0) {
        setLocalTask({
          date: new Date().toISOString().split('T')[0],
          targetCount: extraQuestions.length,
          completedCount: 0,
          questions: extraQuestions,
        })
        setIndex(0)
        setSelectedAnswer(null)
        setShowResult(false)
        addNotification({
          type: 'success',
          message: `已生成 ${extraQuestions.length} 道加练试题`,
        })
      } else {
        addNotification({
          type: 'info',
          message: '暂无可用的薄弱点生成额外练习',
        })
      }
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } } }
      addNotification({
        type: 'error',
        message: err?.response?.data?.message || '生成额外练习失败',
      })
    } finally {
      setIsGeneratingExtra(false)
    }
  }

  return (
    <PageShell
      eyebrow="Adaptive Exam"
      title="自适应试卷"
      description="结合薄弱点、错题本、间隔重复和适度困难，生成一套针对性的练习卷。"
    >
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <SectionCard title="试卷作答">
          {showCompleted && (
            <div className="mb-6 rounded-3xl border border-emerald-100 bg-emerald-50 p-6 text-center">
              <h3 className="text-xl font-bold text-emerald-900 mb-2">本套试卷完成</h3>
              <p className="text-sm text-emerald-700 mb-4">
                系统会根据本次正误更新薄弱点和下一次复习窗口。
              </p>
              <div className="flex items-center justify-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={extraCount}
                  onChange={(e) => setExtraCount(Number(e.target.value))}
                  className="w-20 rounded-2xl border border-emerald-200 bg-white px-3 py-2 text-center text-sm"
                />
                <button
                  className="warm-button"
                  onClick={generateExtra}
                  disabled={isGeneratingExtra}
                >
                  {isGeneratingExtra ? '生成中...' : '补强加练'}
                </button>
              </div>
            </div>
          )}
          {question ? (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-stone-700">
                  {question.knowledgeName}
                </span>
                {question.bloomLevel && (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                    布鲁姆：{question.bloomLevel}
                  </span>
                )}
                {question.desirableDifficulty && (
                  <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800">
                    {question.desirableDifficulty}
                  </span>
                )}
              </div>
              {question.adaptiveReason && (
                <p className="mt-4 rounded-2xl bg-stone-50 p-3 text-sm text-stone-600">
                  {question.adaptiveReason}
                </p>
              )}
              <h2 className="mt-5 text-2xl font-bold text-stone-900">
                <MarkdownRenderer content={question.questionText} />
              </h2>
              {question.diagramSvg && (
                <div className="mt-6 flex justify-center rounded-2xl bg-amber-50 p-4">
                  <div dangerouslySetInnerHTML={{ __html: question.diagramSvg }} className="max-w-sm [&_svg]:h-auto [&_svg]:w-full" />
                </div>
              )}
              <div className="mt-6 grid gap-3 md:grid-cols-2">
                {question.choices.map((choice) => {
                  const isSelected = selectedAnswer === choice.key
                  const isCorrect = choice.key === question.correctAnswer
                  let buttonClass = 'rounded-3xl border border-stone-200 bg-white/80 p-4 text-left hover:border-emerald-800'
                  if (showResult) {
                    if (isSelected && isCorrect) {
                      buttonClass = 'rounded-3xl border-2 border-green-500 bg-green-50 p-4 text-left'
                    } else if (isSelected && !isCorrect) {
                      buttonClass = 'rounded-3xl border-2 border-red-500 bg-red-50 p-4 text-left'
                    } else if (isCorrect) {
                      buttonClass = 'rounded-3xl border-2 border-green-500 bg-green-50 p-4 text-left'
                    }
                  }
                  return (
                    <button
                      key={choice.key}
                      className={buttonClass}
                      onClick={() => answer(choice.key)}
                      disabled={isSubmitting || showResult}
                    >
                      <span className="font-bold text-emerald-900">{choice.key}.</span> <MarkdownRenderer content={choice.text} />
                    </button>
                  )
                })}
              </div>
              {!showResult && (
                <p className="mt-5 rounded-3xl bg-stone-100 p-4 text-sm text-stone-600">
                  提示：<MarkdownRenderer content={question.hint || '先尝试回忆核心定义和典型例子。'} />
                </p>
              )}
              {showResult && (
                <div className="mt-5 space-y-3">
                  <div
                    className={`rounded-3xl p-4 ${
                      selectedAnswer === question.correctAnswer
                        ? 'bg-green-50 border border-green-200'
                        : 'bg-red-50 border border-red-200'
                    }`}
                  >
                    <p className="font-semibold text-stone-900">
                      {selectedAnswer === question.correctAnswer ? '✓ 回答正确！' : '✗ 回答错误'}
                    </p>
                    <p className="mt-2 text-sm text-stone-700">
                      <MarkdownRenderer content={question.explanation || '继续加油！'} />
                    </p>
                  </div>
                  <button
                    className="warm-button w-full"
                    onClick={nextQuestion}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? '提交中...' : nextLabel(index, activeTask?.questions.length || 0)}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              title={isTaskCompleted ? '今日试卷已完成' : '还没有可作答的试卷'}
              description={
                isTaskCompleted
                  ? '做得很好。下一套卷子会根据你的最新表现调整难度。'
                  : activeTask?.emptyReason || '设置题量后生成一套自适应试卷。'
              }
            />
          )}
        </SectionCard>

        <SectionCard title="自适应出卷">
          <label className="block">
            <span className="text-sm font-semibold text-stone-600">试卷题数</span>
            <input
              className="field mt-2"
              type="number"
              min={1}
              max={50}
              value={targetCount}
              onChange={(event) => setTargetCount(Number(event.target.value))}
            />
          </label>
          <button className="warm-button mt-4 w-full" onClick={generatePractice} disabled={isGenerating}>
            {isGenerating ? '生成中...' : '生成自适应试卷'}
          </button>
          <div className="mt-6">
            <div className="mb-2 flex justify-between text-sm text-stone-600">
              <span>本套完成度</span>
              <span>{percent}%</span>
            </div>
            <ProgressBar value={percent} />
          </div>
          <p className="mt-4 text-sm text-stone-500">
            目标 {activeTask?.targetCount ?? 0} 题 · 已完成 {activeTask?.completedCount ?? 0} 题
          </p>
          <AdaptiveMetaPanel task={activeTask} />
        </SectionCard>
      </div>
    </PageShell>
  )
}

function nextLabel(index: number, total: number) {
  return index + 1 >= total ? '完成试卷' : '下一题'
}

function AdaptiveMetaPanel({ task }: { task: DailyPracticeTask | null }) {
  const meta = task?.paperMeta
  if (!meta || (!meta.focus?.length && !meta.bloomDistribution && !meta.difficultyMix)) return null

  return (
    <div className="mt-6 space-y-4 border-t border-stone-100 pt-5">
      <Distribution title="认知层级" items={meta.bloomDistribution} />
      <Distribution title="困难度" items={meta.difficultyMix} />
      {meta.focus && meta.focus.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-stone-700">抽题依据</h3>
          <div className="mt-2 space-y-2">
            {meta.focus.slice(0, 4).map((item) => (
              <div key={`${item.knowledgeName}-${item.adaptiveScore}`} className="rounded-2xl bg-stone-50 p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold text-stone-800">{item.knowledgeName}</span>
                  <span className="text-stone-500">{Math.round(item.masteryScore)}%</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-stone-500">{item.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Distribution({ title, items }: { title: string; items?: Record<string, number> }) {
  const entries = Object.entries(items || {})
  if (entries.length === 0) return null

  return (
    <div>
      <h3 className="text-sm font-semibold text-stone-700">{title}</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {entries.map(([key, value]) => (
          <span key={key} className="rounded-full bg-white px-3 py-1 text-xs text-stone-600 ring-1 ring-stone-200">
            {key} {value}
          </span>
        ))}
      </div>
    </div>
  )
}
