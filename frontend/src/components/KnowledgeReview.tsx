import { useState, useEffect } from 'react'
import { useKnowledgeStore } from '../store/knowledgeStore'
import MarkdownRenderer from './MarkdownRenderer'
import type { KnowledgeMemory } from '../types/api'

const QUALITY_LABELS: { value: number; label: string; desc: string; color: string }[] = [
  { value: 0, label: '完全忘记', desc: '看到内容后完全没有印象', color: 'bg-red-500' },
  { value: 1, label: '模糊印象', desc: '有一点模糊印象，但无法回忆细节', color: 'bg-orange-500' },
  { value: 2, label: '勉强回忆', desc: '能回忆出部分内容，但不完整', color: 'bg-amber-500' },
  { value: 3, label: '较好回忆', desc: '能回忆大部分，有一些困难', color: 'bg-lime-500' },
  { value: 4, label: '顺利回忆', desc: '能较顺利地回忆出内容', color: 'bg-emerald-500' },
  { value: 5, label: '完全掌握', desc: '轻松、完整地回忆起所有内容', color: 'bg-green-600' },
]

export default function KnowledgeReview() {
  const { dueReviews, fetchDueReviews, submitReview } = useKnowledgeStore()
  const [current, setCurrent] = useState<KnowledgeMemory | null>(null)
  const [showContent, setShowContent] = useState(false)
  const [grading, setGrading] = useState(false)
  const [justGraded, setJustGraded] = useState<{ quality: number; ef: number; interval: number } | null>(null)

  useEffect(() => {
    fetchDueReviews()
  }, [fetchDueReviews])

  const handleStartReview = (memory: KnowledgeMemory) => {
    setCurrent(memory)
    setShowContent(false)
    setJustGraded(null)
  }

  const handleShowContent = () => {
    setShowContent(true)
  }

  const handleGrade = async (quality: number) => {
    if (!current) return
    setGrading(true)
    try {
      const result = await submitReview(current.id, quality)
      if (result) {
        setJustGraded({
          quality,
          ef: result.easinessFactor,
          interval: result.intervalDays,
        })
        // Remove from local queue
        await fetchDueReviews()
      }
    } finally {
      setGrading(false)
    }
  }

  const handleNext = () => {
    setCurrent(null)
    setShowContent(false)
    setJustGraded(null)
  }

  // Stats row
  if (!current) {
    return (
      <div className="space-y-4">
        {dueReviews.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-stone-400">
            <svg className="h-12 w-12 mb-3 text-stone-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-medium">没有需要复习的知识</p>
            <p className="text-xs mt-1">太棒了！所有知识都在掌握中</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-stone-500">
                共 <span className="font-semibold text-stone-700">{dueReviews.length}</span> 条待复习
              </p>
            </div>
            <div className="space-y-2">
              {dueReviews.map((mem) => (
                <button
                  key={mem.id}
                  onClick={() => handleStartReview(mem)}
                  className="w-full text-left rounded-2xl border border-stone-200 bg-white p-4 shadow-sm transition hover:shadow-md hover:border-amber-300"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-stone-800 text-sm truncate">{mem.title}</h4>
                      {mem.subject && (
                        <span className="inline-block mt-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                          {mem.subject}
                        </span>
                      )}
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="text-xs font-medium text-red-500">
                        {mem._daysOverdue != null && mem._daysOverdue > 0
                          ? `逾期 ${mem._daysOverdue} 天`
                          : '今天到期'}
                      </p>
                      <p className="text-[10px] text-stone-400 mt-0.5">
                        掌握度 {mem.masteryLevel.toFixed(0)}%
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    )
  }

  // Review flow
  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {/* Back button */}
      <button
        onClick={handleNext}
        className="text-sm font-medium text-stone-500 hover:text-stone-700 transition"
      >
        ← 返回列表
      </button>

      {/* Title */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <h3 className="text-lg font-bold text-stone-800">{current.title}</h3>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {current.subject && (
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-amber-700">
              {current.subject}
            </span>
          )}
          <span className="text-xs text-stone-400">
            复习 {current.reviewCount + 1} 次 | 间隔 {current.intervalDays} 天
          </span>
        </div>
      </div>

      {/* Content reveal */}
      {!showContent ? (
        <div className="flex flex-col items-center py-8">
          <p className="text-stone-500 text-sm mb-4">请先在脑中回忆这条知识的内容</p>
          <button
            onClick={handleShowContent}
            className="rounded-xl bg-emerald-900 px-6 py-3 text-sm font-semibold text-amber-50 hover:bg-emerald-800 transition shadow-sm"
          >
            查看内容
          </button>
        </div>
      ) : (
        <>
          {/* Content card */}
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <MarkdownRenderer content={current.content} className="text-sm" />
          </div>

          {/* Just graded feedback */}
          {justGraded ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
              <svg className="h-8 w-8 mx-auto mb-2 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-semibold text-emerald-800">
                {QUALITY_LABELS.find((q) => q.value === justGraded.quality)?.label} — 复习已记录
              </p>
              <div className="mt-2 flex items-center justify-center gap-4 text-xs text-emerald-600">
                <span>EF: {justGraded.ef.toFixed(2)}</span>
                <span>下次复习: {justGraded.interval} 天后</span>
              </div>
              <button
                onClick={handleNext}
                className="mt-3 rounded-xl bg-emerald-900 px-4 py-2 text-sm font-semibold text-amber-50 hover:bg-emerald-800 transition"
              >
                继续下一题
              </button>
            </div>
          ) : (
            /* Quality grading */
            <div>
              <p className="text-sm font-medium text-stone-600 mb-3">你的回忆程度如何？</p>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {QUALITY_LABELS.map((q) => (
                  <button
                    key={q.value}
                    onClick={() => handleGrade(q.value)}
                    disabled={grading}
                    className={`flex flex-col items-center rounded-xl border p-3 transition ${
                      grading
                        ? 'opacity-50 cursor-not-allowed'
                        : 'border-stone-200 hover:border-amber-300 hover:shadow-sm'
                    }`}
                  >
                    <span className={`h-3 w-3 rounded-full ${q.color} mb-1.5`} />
                    <span className="text-xs font-semibold text-stone-700">{q.label}</span>
                    <span className="text-[10px] text-stone-400 mt-0.5">{q.value}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
