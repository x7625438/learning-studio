import { create } from 'zustand'
import apiClient, { API_ENDPOINTS } from '../utils/api-client'
import type {
  ApiResponse,
  CreateMemoryPayload,
  KnowledgeFilters,
  KnowledgeMemory,
  KnowledgeStats,
  UpdateMemoryPayload,
} from '../types/api'

interface KnowledgeState {
  memories: KnowledgeMemory[]
  stats: KnowledgeStats | null
  isLoading: boolean
  total: number
  page: number
  pageSize: number
  filters: KnowledgeFilters
  searchResults: KnowledgeMemory[]
  dueReviews: KnowledgeMemory[]

  fetchMemories: (page?: number) => Promise<void>
  fetchStats: () => Promise<void>
  searchMemories: (query: string, topK?: number) => Promise<void>
  createMemory: (data: CreateMemoryPayload) => Promise<KnowledgeMemory>
  updateMemory: (id: string, data: UpdateMemoryPayload) => Promise<void>
  deleteMemory: (id: string) => Promise<void>
  restoreMemory: (id: string) => Promise<void>
  fetchDueReviews: () => Promise<void>
  submitReview: (memoryId: string, quality: number) => Promise<KnowledgeMemory | null>
  fetchConsolidationCandidates: () => Promise<Array<{ memory1: KnowledgeMemory; memory2: KnowledgeMemory; reason: string }>>
  consolidateMemories: (memoryIds: string[], title?: string, content?: string) => Promise<void>
  exportMemories: () => Promise<void>
  autoCaptureMemories: (limit?: number) => Promise<{ captured: number; scanned: number; message: string }>
  reindexMemories: () => Promise<{ indexed: number; total: number; message: string }>
  fetchKnowledgeContext: (query: string, topK?: number) => Promise<string>
  setFilters: (filters: Partial<KnowledgeFilters>) => void
  clearSearch: () => void
}

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  memories: [],
  stats: null,
  isLoading: false,
  total: 0,
  page: 1,
  pageSize: 20,
  filters: {},
  searchResults: [],
  dueReviews: [],

  fetchMemories: async (page?: number) => {
    const { filters, pageSize } = get()
    const p = page ?? get().page
    set({ isLoading: true })

    const params = new URLSearchParams()
    params.set('page', String(p))
    params.set('pageSize', String(pageSize))
    if (filters.subject) params.set('subject', filters.subject)
    if (filters.topic) params.set('topic', filters.topic)
    if (filters.memoryType) params.set('memoryType', filters.memoryType)
    if (filters.sortBy) params.set('sortBy', filters.sortBy)
    if (filters.sortOrder) params.set('sortOrder', filters.sortOrder)

    const response = await apiClient.get<{ data: KnowledgeMemory[]; total: number; page: number; pageSize: number }>(
      `${API_ENDPOINTS.KNOWLEDGE_MEMORIES}?${params.toString()}`
    )
    set({
      memories: response.data,
      total: response.total,
      page: response.page,
      pageSize: response.pageSize,
      isLoading: false,
    })
  },

  fetchStats: async () => {
    const response = await apiClient.get<ApiResponse<KnowledgeStats>>(
      `${API_ENDPOINTS.KNOWLEDGE_MEMORIES}/stats`
    )
    set({ stats: response.data })
  },

  searchMemories: async (query, topK = 10) => {
    if (!query.trim()) {
      set({ searchResults: [] })
      return
    }
    set({ isLoading: true })
    const response = await apiClient.get<{ data: KnowledgeMemory[] }>(
      `${API_ENDPOINTS.KNOWLEDGE_MEMORIES}/search?q=${encodeURIComponent(query)}&topK=${topK}`
    )
    set({ searchResults: response.data, isLoading: false })
  },

  createMemory: async (data) => {
    const response = await apiClient.post<ApiResponse<KnowledgeMemory>>(
      API_ENDPOINTS.KNOWLEDGE_MEMORIES,
      data
    )
    await get().fetchMemories(1)
    await get().fetchStats()
    return response.data
  },

  updateMemory: async (id, data) => {
    await apiClient.put<ApiResponse<KnowledgeMemory>>(
      `${API_ENDPOINTS.KNOWLEDGE_MEMORIES}/${id}`,
      data
    )
    await get().fetchMemories()
    await get().fetchStats()
  },

  deleteMemory: async (id) => {
    await apiClient.delete(`${API_ENDPOINTS.KNOWLEDGE_MEMORIES}/${id}`)
    await get().fetchMemories()
    await get().fetchStats()
  },

  restoreMemory: async (id) => {
    await apiClient.post(`${API_ENDPOINTS.KNOWLEDGE_MEMORIES}/${id}/restore`)
    await get().fetchMemories()
    await get().fetchStats()
  },

  fetchDueReviews: async () => {
    const response = await apiClient.get<{ data: KnowledgeMemory[] }>(
      `${API_ENDPOINTS.KNOWLEDGE_MEMORIES}/due-review?limit=50`
    )
    set({ dueReviews: response.data })
  },

  submitReview: async (memoryId, quality) => {
    const response = await apiClient.post<ApiResponse<KnowledgeMemory>>(
      `${API_ENDPOINTS.KNOWLEDGE_MEMORIES}/review`,
      { memoryId, quality }
    )
    await get().fetchStats()
    return response.data
  },

  fetchConsolidationCandidates: async () => {
    const response = await apiClient.get<{ data: Array<{ memory1: KnowledgeMemory; memory2: KnowledgeMemory; reason: string }> }>(
      `${API_ENDPOINTS.KNOWLEDGE_MEMORIES}/consolidation-candidates`
    )
    return response.data
  },

  consolidateMemories: async (memoryIds, title?, content?) => {
    await apiClient.post(`${API_ENDPOINTS.KNOWLEDGE_MEMORIES}/consolidate`, {
      memoryIds,
      title: title || '',
      content: content || '',
    })
    await get().fetchMemories(1)
    await get().fetchStats()
  },

  exportMemories: async () => {
    const response = await apiClient.get<{ data: Record<string, unknown> }>(
      `${API_ENDPOINTS.KNOWLEDGE_MEMORIES}/export`
    )
    const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `knowledge-memories-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  },

  autoCaptureMemories: async (limit = 20) => {
    const response = await apiClient.post<{
      data: { captured: number; scanned: number }
      message: string
    }>(`${API_ENDPOINTS.KNOWLEDGE_MEMORIES}/auto-capture`, { limit })
    await get().fetchMemories(1)
    await get().fetchStats()
    return { ...response.data, message: response.message || '' }
  },

  reindexMemories: async () => {
    const response = await apiClient.post<{
      data: { indexed: number; total: number }
      message: string
    }>(`${API_ENDPOINTS.KNOWLEDGE_MEMORIES}/reindex`)
    return { ...response.data, message: response.message || '' }
  },

  fetchKnowledgeContext: async (query, topK = 5) => {
    const response = await apiClient.get<{ data: { context: string; message?: string } }>(
      `${API_ENDPOINTS.KNOWLEDGE_MEMORIES}/context?q=${encodeURIComponent(query)}&topK=${topK}`
    )
    return response.data.context || response.data.message || ''
  },

  setFilters: (filters) => {
    set({ filters: { ...get().filters, ...filters }, page: 1 })
  },

  clearSearch: () => set({ searchResults: [] }),
}))
