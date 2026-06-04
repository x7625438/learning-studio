import type { KnowledgeMemory } from '../types/api'

const SUBJECT_COLORS: Record<string, string> = {
  数学: 'bg-blue-100 text-blue-700',
  英语: 'bg-green-100 text-green-700',
  物理: 'bg-purple-100 text-purple-700',
  化学: 'bg-orange-100 text-orange-700',
  生物: 'bg-emerald-100 text-emerald-700',
  历史: 'bg-amber-100 text-amber-700',
  地理: 'bg-teal-100 text-teal-700',
  综合: 'bg-gray-100 text-gray-700',
}

function getSubjectColor(subject: string): string {
  return SUBJECT_COLORS[subject] || 'bg-gray-100 text-gray-600'
}

function getSourceLabel(sourceType: string): string {
  const map: Record<string, string> = {
    manual: '手动添加',
    'auto-qa': '来自问答',
    'auto-practice': '来自练习',
    'auto-feynman': '来自费曼',
    'auto-textbook': '来自教材',
    consolidation: '系统整合',
  }
  return map[sourceType] || sourceType
}

function isDue(nextReviewAt: string | null): boolean {
  if (!nextReviewAt) return false
  return new Date(nextReviewAt) <= new Date()
}

interface Props {
  memory: KnowledgeMemory
  onClick: (memory: KnowledgeMemory) => void
}

export default function KnowledgeCard({ memory, onClick }: Props) {
  const due = isDue(memory.nextReviewAt)
  const masteryColor =
    memory.masteryLevel >= 70 ? 'bg-emerald-500' : memory.masteryLevel >= 40 ? 'bg-amber-500' : 'bg-red-400'

  return (
    <button
      onClick={() => onClick(memory)}
      className="text-left group w-full rounded-2xl border border-stone-200 bg-white p-5 shadow-sm transition hover:shadow-md hover:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-400"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-stone-800 text-sm leading-snug line-clamp-2 flex-1">
          {memory.title}
        </h3>
        {due && (
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            待复习
          </span>
        )}
      </div>

      {memory.summary && (
        <p className="mt-1.5 text-xs text-stone-500 line-clamp-2">{memory.summary}</p>
      )}

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {memory.subject && (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${getSubjectColor(memory.subject)}`}>
            {memory.subject}
          </span>
        )}
        <span className="inline-flex items-center rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-medium text-stone-500">
          {getSourceLabel(memory.sourceType)}
        </span>
      </div>

      {/* Mastery bar */}
      <div className="mt-3 flex items-center gap-2">
        <div className="h-1.5 flex-1 rounded-full bg-stone-100 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${masteryColor}`}
            style={{ width: `${memory.masteryLevel}%` }}
          />
        </div>
        <span className="text-[10px] font-medium text-stone-400">{memory.masteryLevel.toFixed(0)}%</span>
      </div>
    </button>
  )
}
