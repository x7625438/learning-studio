import { useCallback, useEffect, useState } from 'react'
import { useKnowledgeStore } from '../store/knowledgeStore'
import KnowledgeCard from '../components/KnowledgeCard'
import KnowledgeDetail from '../components/KnowledgeDetail'
import KnowledgeSearch from '../components/KnowledgeSearch'
import KnowledgeReview from '../components/KnowledgeReview'
import type { CreateMemoryPayload, KnowledgeMemory } from '../types/api'

const SUBJECTS = ['', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '综合']
const MEMORY_TYPES = [
  { value: '', label: '全部类型' },
  { value: 'concept', label: '概念' },
  { value: 'fact', label: '事实' },
  { value: 'insight', label: '洞察' },
  { value: 'skill', label: '技巧' },
  { value: 'question', label: '问题' },
]
const SORT_OPTIONS = [
  { value: 'updated_at', label: '最近更新' },
  { value: 'created_at', label: '创建时间' },
  { value: 'importance', label: '重要性' },
  { value: 'mastery_level', label: '掌握度' },
  { value: 'next_review_at', label: '下次复习' },
]

type Tab = 'browse' | 'search' | 'review'

export default function KnowledgeBase() {
  const {
    memories, stats, isLoading, total, page, pageSize, filters,
    searchResults,
    fetchMemories, fetchStats, searchMemories,
    createMemory, updateMemory, deleteMemory,
    setFilters, clearSearch,
  } = useKnowledgeStore()

  const [activeTab, setActiveTab] = useState<Tab>('browse')
  const [selectedMemory, setSelectedMemory] = useState<KnowledgeMemory | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)

  // Create form state
  const [createTitle, setCreateTitle] = useState('')
  const [createContent, setCreateContent] = useState('')
  const [createSummary, setCreateSummary] = useState('')
  const [createSubject, setCreateSubject] = useState('')
  const [createTags, setCreateTags] = useState('')
  const [createMemoryType, setCreateMemoryType] = useState<string>('concept')
  const [createImportance, setCreateImportance] = useState(5)
  const [creating, setCreating] = useState(false)
  const [showConsolidate, setShowConsolidate] = useState(false)
  const [consolidationCandidates, setConsolidationCandidates] = useState<
    Array<{ memory1: KnowledgeMemory; memory2: KnowledgeMemory; reason: string }>
  >([])
  const [consolidating, setConsolidating] = useState(false)
  const [systemMessage, setSystemMessage] = useState('')
  const [isCapturing, setIsCapturing] = useState(false)
  const [isReindexing, setIsReindexing] = useState(false)
  const [ragQuery, setRagQuery] = useState('')
  const [ragContext, setRagContext] = useState('')
  const [isCheckingRag, setIsCheckingRag] = useState(false)

  const {
    fetchConsolidationCandidates,
    consolidateMemories,
    exportMemories,
    autoCaptureMemories,
    reindexMemories,
    fetchKnowledgeContext,
  } = useKnowledgeStore()

  useEffect(() => {
    fetchMemories()
    fetchStats()
  }, [fetchMemories, fetchStats])

  // Re-fetch when filters change
  useEffect(() => {
    fetchMemories(1)
  }, [filters, fetchMemories])

  const handleSearch = useCallback(
    (query: string) => {
      if (!query) {
        clearSearch()
        return
      }
      searchMemories(query)
    },
    [searchMemories, clearSearch],
  )

  const handleCardClick = useCallback((memory: KnowledgeMemory) => {
    setSelectedMemory(memory)
  }, [])

  const handleSave = useCallback(
    async (id: string, data: { title?: string; content?: string; summary?: string; subject?: string; tags?: string[] }) => {
      await updateMemory(id, data)
      // Refresh the detail view
      const { memories: updated } = useKnowledgeStore.getState()
      const refreshed = updated.find((m) => m.id === id)
      if (refreshed) setSelectedMemory(refreshed)
    },
    [updateMemory],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteMemory(id)
      setSelectedMemory(null)
    },
    [deleteMemory],
  )

  const handleCreate = async () => {
    if (!createTitle.trim() || !createContent.trim()) return
    setCreating(true)
    try {
      const payload: CreateMemoryPayload = {
        title: createTitle.trim(),
        content: createContent.trim(),
        summary: createSummary.trim(),
        subject: createSubject,
        memoryType: createMemoryType as CreateMemoryPayload['memoryType'],
        tags: createTags.split(',').map((t) => t.trim()).filter(Boolean),
        importance: createImportance,
      }
      await createMemory(payload)
      setShowCreateModal(false)
      setCreateTitle('')
      setCreateContent('')
      setCreateSummary('')
      setCreateSubject('')
      setCreateTags('')
      setCreateMemoryType('concept')
      setCreateImportance(5)
    } finally {
      setCreating(false)
    }
  }

  const handleLoadConsolidationCandidates = async () => {
    setShowConsolidate(true)
    try {
      const candidates = await fetchConsolidationCandidates()
      setConsolidationCandidates(candidates)
    } catch {
      // ignore
    }
  }

  const handleConsolidate = async (memoryIds: string[]) => {
    setConsolidating(true)
    try {
      await consolidateMemories(memoryIds)
      setConsolidationCandidates([])
    } finally {
      setConsolidating(false)
    }
  }

  const handleExport = async () => {
    await exportMemories()
  }

  const handleAutoCapture = async () => {
    setIsCapturing(true)
    setSystemMessage('')
    try {
      const result = await autoCaptureMemories(30)
      setSystemMessage(result.message || `扫描 ${result.scanned} 条，捕获 ${result.captured} 条`)
    } finally {
      setIsCapturing(false)
    }
  }

  const handleReindex = async () => {
    setIsReindexing(true)
    setSystemMessage('')
    try {
      const result = await reindexMemories()
      setSystemMessage(result.message || `已重建 ${result.indexed}/${result.total} 条向量索引`)
    } finally {
      setIsReindexing(false)
    }
  }

  const handleCheckRag = async () => {
    if (!ragQuery.trim()) return
    setIsCheckingRag(true)
    setRagContext('')
    try {
      const context = await fetchKnowledgeContext(ragQuery.trim())
      setRagContext(context || '没有检索到可注入的相关知识。')
    } finally {
      setIsCheckingRag(false)
    }
  }

  const totalPages = Math.ceil(total / pageSize)
  const displayItems = activeTab === 'search' && searchResults.length > 0 ? searchResults : memories
  const showBrowseGrid = activeTab !== 'review'

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-stone-800">知识库</h1>
          <p className="mt-1 text-sm text-stone-500">你的个人学习记忆库</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-500 hover:bg-stone-50 transition"
            title="导出知识库为 JSON"
          >
            导出
          </button>
          <button
            onClick={handleLoadConsolidationCandidates}
            className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-500 hover:bg-stone-50 transition"
          >
            整合记忆
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="rounded-xl bg-emerald-900 px-4 py-2.5 text-sm font-semibold text-amber-50 hover:bg-emerald-800 transition shadow-sm"
          >
            + 添加知识
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-2xl font-bold text-stone-800">{stats.total}</p>
            <p className="text-xs text-stone-500">知识总数</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-2xl font-bold text-amber-600">{stats.dueToday}</p>
            <p className="text-xs text-stone-500">今日待复习</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-2xl font-bold text-emerald-700">{stats.averageMastery}%</p>
            <p className="text-xs text-stone-500">平均掌握度</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-4">
            <div className="flex flex-wrap gap-1">
              {Object.entries(stats.bySubject).slice(0, 3).map(([subj, cnt]) => (
                <span key={subj} className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  {subj} {cnt}
                </span>
              ))}
            </div>
            <p className="text-xs text-stone-500 mt-1">学科分布</p>
          </div>
        </div>
      )}

      {/* Capability console */}
      <div className="rounded-2xl border border-stone-200 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-sm font-bold text-stone-800">系统能力检查</h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">自动捕获</span>
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">RAG 注入</span>
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">SM-2 调度</span>
              <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-700">记忆整合</span>
            </div>
            {systemMessage && (
              <p className="mt-2 text-xs font-medium text-emerald-700">{systemMessage}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleAutoCapture}
              disabled={isCapturing}
              className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 transition disabled:opacity-50"
            >
              {isCapturing ? '捕获中...' : '扫描学习记录'}
            </button>
            <button
              onClick={handleReindex}
              disabled={isReindexing}
              className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 transition disabled:opacity-50"
            >
              {isReindexing ? '重建中...' : '重建向量索引'}
            </button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="flex gap-2">
            <input
              value={ragQuery}
              onChange={(e) => setRagQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCheckRag()
              }}
              placeholder="输入问题，检查会注入哪些知识..."
              className="min-w-0 flex-1 rounded-xl border border-stone-200 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-amber-400"
            />
            <button
              onClick={handleCheckRag}
              disabled={isCheckingRag || !ragQuery.trim()}
              className="rounded-xl bg-stone-800 px-3 py-2 text-xs font-semibold text-white hover:bg-stone-700 transition disabled:opacity-50"
            >
              {isCheckingRag ? '检索中' : '检查 RAG'}
            </button>
          </div>
          {ragContext && (
            <pre className="max-h-40 overflow-auto rounded-xl bg-stone-50 p-3 text-xs leading-5 text-stone-600 whitespace-pre-wrap">
              {ragContext}
            </pre>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 rounded-2xl bg-stone-100 p-1 w-fit">
        {[
          { key: 'browse' as Tab, label: '浏览' },
          { key: 'review' as Tab, label: '复习' },
          { key: 'search' as Tab, label: '搜索' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              activeTab === tab.key
                ? 'bg-white text-stone-800 shadow-sm'
                : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Review tab */}
      {activeTab === 'review' && <KnowledgeReview />}

      {/* Search tab */}
      {activeTab === 'search' && (
        <div className="space-y-4">
          <KnowledgeSearch onSearch={handleSearch} placeholder="输入关键词搜索你的知识库..." />
          {searchResults.length > 0 && (
            <p className="text-xs text-stone-400">
              找到 {searchResults.length} 条结果
              {searchResults.filter((r) => r._source === 'vector').length > 0 &&
                `（${searchResults.filter((r) => r._source === 'vector').length} 条语义匹配）`}
            </p>
          )}
        </div>
      )}

      {/* Browse tab — filters (hidden on review) */}
      {activeTab === 'browse' && showBrowseGrid && (
        <div className="flex flex-wrap items-center gap-2">
          {/* Subject filter */}
          <select
            value={filters.subject || ''}
            onChange={(e) => setFilters({ subject: e.target.value || undefined })}
            className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-600 outline-none focus:ring-2 focus:ring-amber-400"
          >
            <option value="">全部学科</option>
            {SUBJECTS.filter(Boolean).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {/* Type filter */}
          <select
            value={filters.memoryType || ''}
            onChange={(e) => setFilters({ memoryType: e.target.value ? e.target.value as KnowledgeMemory['memoryType'] : undefined })}
            className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-600 outline-none focus:ring-2 focus:ring-amber-400"
          >
            {MEMORY_TYPES.map((mt) => (
              <option key={mt.value} value={mt.value}>{mt.label}</option>
            ))}
          </select>

          {/* Sort */}
          <select
            value={filters.sortBy || 'updated_at'}
            onChange={(e) => setFilters({ sortBy: e.target.value })}
            className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-600 outline-none focus:ring-2 focus:ring-amber-400"
          >
            {SORT_OPTIONS.map((so) => (
              <option key={so.value} value={so.value}>{so.label}</option>
            ))}
          </select>

          <button
            onClick={() => setFilters({ sortOrder: filters.sortOrder === 'asc' ? 'desc' : 'asc' })}
            className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-500 hover:bg-stone-50 transition"
          >
            {filters.sortOrder === 'asc' ? '↑ 升序' : '↓ 降序'}
          </button>
        </div>
      )}

      {/* Grid (browse & search only) */}
      {showBrowseGrid && (
        <>
          {isLoading && displayItems.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-stone-400">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-stone-200 border-t-amber-500" />
              <span className="ml-2 text-sm">加载中...</span>
            </div>
          ) : displayItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-stone-400">
              <svg className="h-12 w-12 mb-3 text-stone-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              <p className="text-sm font-medium">
                {activeTab === 'search' ? '没有找到匹配的知识记忆' : '还没有知识记忆'}
              </p>
              <p className="text-xs mt-1">
                {activeTab === 'search' ? '尝试其他关键词搜索' : '点击右上角「添加知识」开始构建你的知识库'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {displayItems.map((mem) => (
                <KnowledgeCard key={mem.id} memory={mem} onClick={handleCardClick} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Pagination (browse only) */}
      {activeTab === 'browse' && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => fetchMemories(page - 1)}
            className="rounded-xl px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            上一页
          </button>
          <span className="text-sm text-stone-400">
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => fetchMemories(page + 1)}
            className="rounded-xl px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            下一页
          </button>
        </div>
      )}

      {/* Detail modal */}
      {selectedMemory && (
        <KnowledgeDetail
          memory={selectedMemory}
          onClose={() => setSelectedMemory(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}

      {/* Create modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
          onClick={() => setShowCreateModal(false)}
        >
          <div
            className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowCreateModal(false)}
              className="absolute right-4 top-4 rounded-full p-1.5 text-stone-400 hover:bg-stone-100 transition"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <h2 className="text-lg font-bold text-stone-800 mb-4">添加知识记忆</h2>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">标题 *</label>
                <input
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  placeholder="例如：泰勒展开的定义与条件"
                  className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">内容 *（支持 Markdown）</label>
                <textarea
                  value={createContent}
                  onChange={(e) => setCreateContent(e.target.value)}
                  rows={5}
                  placeholder="详细描述这个知识点..."
                  className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none resize-y"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">一句话摘要</label>
                <input
                  value={createSummary}
                  onChange={(e) => setCreateSummary(e.target.value)}
                  placeholder="用一句话总结核心要点"
                  className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1">学科</label>
                  <select
                    value={createSubject}
                    onChange={(e) => setCreateSubject(e.target.value)}
                    className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none"
                  >
                    <option value="">不指定</option>
                    {SUBJECTS.filter(Boolean).map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1">类型</label>
                  <select
                    value={createMemoryType}
                    onChange={(e) => setCreateMemoryType(e.target.value)}
                    className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none"
                  >
                    {MEMORY_TYPES.filter((mt) => mt.value).map((mt) => (
                      <option key={mt.value} value={mt.value}>{mt.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1">标签（逗号分隔）</label>
                  <input
                    value={createTags}
                    onChange={(e) => setCreateTags(e.target.value)}
                    placeholder="微积分, 极限, 基础"
                    className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1">重要性 ({createImportance})</label>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={createImportance}
                    onChange={(e) => setCreateImportance(Number(e.target.value))}
                    className="w-full accent-amber-500"
                  />
                </div>
              </div>
            </div>

            <div className="mt-5 flex gap-2 justify-end">
              <button
                onClick={() => setShowCreateModal(false)}
                className="rounded-xl px-4 py-2 text-sm font-medium text-stone-500 hover:bg-stone-100 transition"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !createTitle.trim() || !createContent.trim()}
                className="rounded-xl bg-emerald-900 px-4 py-2 text-sm font-semibold text-amber-50 hover:bg-emerald-800 transition disabled:opacity-50"
              >
                {creating ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Consolidation panel */}
      {showConsolidate && (
        <div className="rounded-2xl border border-purple-200 bg-purple-50/50 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-stone-700">记忆整合建议</h3>
            <button
              onClick={() => {
                setShowConsolidate(false)
                setConsolidationCandidates([])
              }}
              className="text-xs text-stone-400 hover:text-stone-600"
            >
              关闭
            </button>
          </div>

          {consolidationCandidates.length === 0 ? (
            <p className="text-sm text-stone-500 py-4 text-center">
              正在分析记忆关联...如果没有结果显示，说明当前记忆没有需要整合的内容。
            </p>
          ) : (
            <div className="space-y-3">
              {consolidationCandidates.map((pair, i) => (
                <div key={i} className="rounded-xl border border-purple-200 bg-white p-4">
                  <p className="text-xs text-purple-600 font-medium mb-2">
                    建议整合：{pair.reason}
                  </p>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="rounded-lg bg-stone-50 p-3">
                      <p className="text-xs font-semibold text-stone-700 line-clamp-2">{pair.memory1.title}</p>
                      <p className="text-[10px] text-stone-400 mt-1">{pair.memory1.subject} · 掌握度 {pair.memory1.masteryLevel.toFixed(0)}%</p>
                    </div>
                    <div className="rounded-lg bg-stone-50 p-3">
                      <p className="text-xs font-semibold text-stone-700 line-clamp-2">{pair.memory2.title}</p>
                      <p className="text-[10px] text-stone-400 mt-1">{pair.memory2.subject} · 掌握度 {pair.memory2.masteryLevel.toFixed(0)}%</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleConsolidate([pair.memory1.id, pair.memory2.id])}
                    disabled={consolidating}
                    className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 transition disabled:opacity-50"
                  >
                    {consolidating ? '整合中...' : '合并这 2 条记忆'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
