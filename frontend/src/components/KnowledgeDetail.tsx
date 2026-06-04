import { useState } from 'react'
import MarkdownRenderer from './MarkdownRenderer'
import type { KnowledgeMemory } from '../types/api'

interface Props {
  memory: KnowledgeMemory | null
  onClose: () => void
  onSave: (id: string, data: { title?: string; content?: string; summary?: string; subject?: string; tags?: string[] }) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

export default function KnowledgeDetail({ memory, onClose, onSave, onDelete }: Props) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(memory?.title || '')
  const [content, setContent] = useState(memory?.content || '')
  const [summary, setSummary] = useState(memory?.summary || '')
  const [subject, setSubject] = useState(memory?.subject || '')
  const [tagsText, setTagsText] = useState((memory?.tags || []).join(', '))
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!memory) return null

  const handleSave = async () => {
    setSaving(true)
    try {
      const tags = tagsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      await onSave(memory.id, { title, content, summary, subject, tags })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    await onDelete(memory.id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1.5 text-stone-400 hover:bg-stone-100 transition"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {editing ? (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-stone-800">编辑知识记忆</h2>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">标题</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">摘要（一句话总结）</label>
              <input
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">学科</label>
              <select
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none"
              >
                <option value="">不指定</option>
                <option value="数学">数学</option>
                <option value="英语">英语</option>
                <option value="物理">物理</option>
                <option value="化学">化学</option>
                <option value="生物">生物</option>
                <option value="历史">历史</option>
                <option value="地理">地理</option>
                <option value="综合">综合</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">标签（逗号分隔）</label>
              <input
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none"
                placeholder="例如: 微积分, 极限, 导数"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">内容（Markdown）</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={8}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none resize-y"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEditing(false)}
                className="rounded-xl px-4 py-2 text-sm font-medium text-stone-500 hover:bg-stone-100 transition"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-xl bg-emerald-900 px-4 py-2 text-sm font-semibold text-amber-50 hover:bg-emerald-800 transition disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex-1">
                <h2 className="text-xl font-bold text-stone-800">{memory.title}</h2>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {memory.subject && (
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                      {memory.subject}
                    </span>
                  )}
                  <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-500">
                    {memory.memoryType}
                  </span>
                  {memory.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => {
                    setEditing(true)
                    setTitle(memory.title)
                    setContent(memory.content)
                    setSummary(memory.summary)
                    setSubject(memory.subject)
                    setTagsText(memory.tags.join(', '))
                  }}
                  className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 transition"
                  title="编辑"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  onClick={handleDelete}
                  className={`rounded-lg p-1.5 transition ${confirmDelete ? 'bg-red-50 text-red-600' : 'text-stone-400 hover:bg-stone-100'}`}
                  title={confirmDelete ? '再次点击确认删除' : '删除'}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Stats row */}
            <div className="flex items-center gap-4 mb-4 p-3 rounded-xl bg-stone-50 text-xs text-stone-500">
              <div>
                <span className="font-semibold text-stone-700">{memory.masteryLevel.toFixed(0)}%</span> 掌握度
              </div>
              <div>
                <span className="font-semibold text-stone-700">{memory.reviewCount}</span> 次复习
              </div>
              <div>
                <span className="font-semibold text-stone-700">{memory.intervalDays}</span> 天间隔
              </div>
              {memory.nextReviewAt && (
                <div>
                  下次复习:{' '}
                  <span className="font-semibold text-stone-700">
                    {new Date(memory.nextReviewAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
              )}
            </div>

            {/* Content */}
            <MarkdownRenderer
              content={memory.content}
              className="text-sm"
            />

            {/* Review history */}
            {memory.reviewHistory && memory.reviewHistory.length > 0 && (
              <details className="mt-4">
                <summary className="text-xs font-medium text-stone-400 cursor-pointer hover:text-stone-600">
                  复习记录 ({memory.reviewHistory.length})
                </summary>
                <div className="mt-2 space-y-1">
                  {memory.reviewHistory.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 text-xs text-stone-500">
                      <span className="w-16">{new Date(r.createdAt).toLocaleDateString('zh-CN')}</span>
                      <span>评分: {r.quality}/5</span>
                      <span>间隔: {r.intervalBefore}→{r.intervalAfter}天</span>
                      <span>EF: {r.easeBefore?.toFixed(2)}→{r.easeAfter?.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  )
}
