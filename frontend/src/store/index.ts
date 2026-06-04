import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import apiClient, { API_ENDPOINTS } from '../utils/api-client'
import type {
  ApiResponse,
  AuthPayload,
  DailyPracticeTask,
  HeatmapCell,
  KnowledgeGraph,
  LearningPath,
  ProfileDashboard,
  User,
  WeakPoint,
  WeeklyStats,
} from '../types/api'

type NotificationType = 'success' | 'error' | 'warning' | 'info'

export interface Notification {
  id: string
  type: NotificationType
  message: string
  duration?: number
}

export const useNotificationStore = create<{
  notifications: Notification[]
  addNotification: (notification: Omit<Notification, 'id'>) => void
  removeNotification: (id: string) => void
  clearNotifications: () => void
}>((set) => ({
  notifications: [],
  addNotification: (notification) =>
    set((state) => ({
      notifications: [
        ...state.notifications,
        { ...notification, id: crypto.randomUUID(), duration: notification.duration ?? 4200 },
      ],
    })),
  removeNotification: (id) =>
    set((state) => ({ notifications: state.notifications.filter((item) => item.id !== id) })),
  clearNotifications: () => set({ notifications: [] }),
}))

interface AuthStoreState {
  user: User | null
  token: string | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (username: string, password: string) => Promise<void>
  fetchMe: () => Promise<void>
  logout: () => void
}

const AUTH_TOKEN_KEY = 'auth_token'
const AUTH_STORAGE_KEY = 'auth-storage'

export const useAuthStore = create<AuthStoreState>()(
  persist(
    (set, get) => ({
      user: null,
      token: localStorage.getItem(AUTH_TOKEN_KEY),
      isLoading: false,
      login: async (email, password) => {
        set({ isLoading: true })
        try {
          const response = await apiClient.post<ApiResponse<AuthPayload>>(`${API_ENDPOINTS.AUTH}/login`, {
            email,
            password,
          })
          localStorage.setItem(AUTH_TOKEN_KEY, response.data.token)
          set({ user: response.data.user, token: response.data.token })
        } finally {
          set({ isLoading: false })
        }
      },
      register: async (username, password) => {
        set({ isLoading: true })
        try {
          const response = await apiClient.post<ApiResponse<AuthPayload>>(`${API_ENDPOINTS.AUTH}/register`, {
            username,
            password,
          })
          localStorage.setItem(AUTH_TOKEN_KEY, response.data.token)
          set({ user: response.data.user, token: response.data.token })
        } finally {
          set({ isLoading: false })
        }
      },
      fetchMe: async () => {
        if (!get().token) return
        const response = await apiClient.get<ApiResponse<User>>(`${API_ENDPOINTS.AUTH}/me`)
        set({ user: response.data })
      },
      logout: () => {
        localStorage.removeItem(AUTH_TOKEN_KEY)
        localStorage.removeItem(AUTH_STORAGE_KEY)
        set({ user: null, token: null, isLoading: false })
      },
    }),
    {
      name: AUTH_STORAGE_KEY,
      merge: (persistedState, currentState) => {
        const token = localStorage.getItem(AUTH_TOKEN_KEY)
        if (!token) {
          return { ...currentState, user: null, token: null, isLoading: false }
        }

        const persistedAuth = persistedState as Partial<AuthStoreState> | undefined
        return {
          ...currentState,
          ...persistedAuth,
          token,
          isLoading: false,
        }
      },
    }
  )
)

export const useProfileStore = create<{
  dashboard: ProfileDashboard | null
  weakPoints: WeakPoint[]
  isLoading: boolean
  fetchDashboard: () => Promise<void>
  updateProfile: (payload: Record<string, unknown>) => Promise<void>
  applyWebSocketUpdate: (payload: { weakPoints?: WeakPoint[] }) => void
}>((set, get) => ({
  dashboard: null,
  weakPoints: [],
  isLoading: false,
  fetchDashboard: async () => {
    set({ isLoading: true })
    const response = await apiClient.get<ApiResponse<ProfileDashboard>>(API_ENDPOINTS.PROFILE)
    set({ dashboard: response.data, weakPoints: response.data.weakPoints, isLoading: false })
  },
  updateProfile: async (payload) => {
    await apiClient.put(`${API_ENDPOINTS.PROFILE}`, payload)
    await get().fetchDashboard()
  },
  applyWebSocketUpdate: (payload) => {
    if (!payload.weakPoints) return
    set((state) => ({
      weakPoints: payload.weakPoints || state.weakPoints,
      dashboard: state.dashboard
        ? { ...state.dashboard, weakPoints: payload.weakPoints || state.dashboard.weakPoints }
        : state.dashboard,
    }))
  },
}))

export const usePracticeStore = create<{
  task: DailyPracticeTask | null
  fetchToday: () => Promise<void>
  submit: (questionId: string, answer: string, feeling?: string) => Promise<void>
}>((set, get) => ({
  task: null,
  fetchToday: async () => {
    const response = await apiClient.get<ApiResponse<DailyPracticeTask>>(`${API_ENDPOINTS.PRACTICE}/today`)
    set({ task: response.data })
  },
  submit: async (questionId, answer, feeling) => {
    await apiClient.post(`${API_ENDPOINTS.PRACTICE}/submit`, {
      questionId,
      answer,
      feeling,
      timeSpentSeconds: 30,
    })
    await get().fetchToday()
  },
}))

export const useCalendarStore = create<{
  heatmap: HeatmapCell[]
  weekly: WeeklyStats | null
  timerStartedAt: number | null
  timerTopic: string
  fetchCalendar: () => Promise<void>
  startTimer: (topic: string) => void
  stopTimer: () => void
  resetTimer: () => void
}>()(
  persist(
    (set) => ({
      heatmap: [],
      weekly: null,
      timerStartedAt: null,
      timerTopic: '自主学习',
      fetchCalendar: async () => {
        const now = new Date()
        const [monthly, weekly] = await Promise.all([
          apiClient.get<ApiResponse<HeatmapCell[]>>(
            `${API_ENDPOINTS.CALENDAR}/monthly?year=${now.getFullYear()}&month=${now.getMonth() + 1}`
          ),
          apiClient.get<ApiResponse<WeeklyStats>>(`${API_ENDPOINTS.CALENDAR}/weekly`),
        ])
        set({ heatmap: monthly.data, weekly: weekly.data })
      },
      startTimer: (topic) => set({ timerStartedAt: Date.now(), timerTopic: topic }),
      stopTimer: () => set({ timerStartedAt: null }),
      resetTimer: () => set({ timerStartedAt: null, timerTopic: '自主学习' }),
    }),
    { name: 'calendar-storage' }
  )
)

export const useLearningPathStore = create<{
  current: LearningPath | null
  generate: (payload: Record<string, unknown>) => Promise<void>
  fetchCurrent: () => Promise<void>
  deletePath: (pathId: string) => Promise<void>
}>((set) => ({
  current: null,
  generate: async (payload) => {
    const response = await apiClient.post<ApiResponse<LearningPath>>(
      `${API_ENDPOINTS.LEARNING_PATH}/generate`,
      payload,
      { timeout: 120000 }
    )
    set({ current: response.data })
  },
  fetchCurrent: async () => {
    const response = await apiClient.get<ApiResponse<LearningPath | null>>(
      `${API_ENDPOINTS.LEARNING_PATH}/current`
    )
    set({ current: response.data })
  },
  deletePath: async (pathId) => {
    await apiClient.delete(`${API_ENDPOINTS.LEARNING_PATH}/${pathId}`)
    set({ current: null })
  },
}))

export const useGraphStore = create<{
  graph: KnowledgeGraph | null
  generate: (topic: string) => Promise<void>
  markNode: (nodeId: string, masteryStatus: string) => Promise<void>
}>((set, get) => ({
  graph: null,
  generate: async (topic) => {
    const response = await apiClient.post<ApiResponse<KnowledgeGraphJobStart>>(
      `${API_ENDPOINTS.KNOWLEDGE_GRAPH}/generate`,
      { topic },
      { timeout: 30000 }
    )
    const graph = await pollKnowledgeGraphJob(response.data.jobId)
    set({ graph: { ...graph, id: graph.id || graph.graphId || '' } })
  },
  markNode: async (nodeId, masteryStatus) => {
    const graph = get().graph
    if (!graph) return
    const response = await apiClient.put<ApiResponse<{ nodes: KnowledgeGraph['nodes'] }>>(
      `${API_ENDPOINTS.KNOWLEDGE_GRAPH}/${graph.id}/node/${nodeId}`,
      { masteryStatus }
    )
    set({ graph: { ...graph, nodes: response.data.nodes } })
  },
}))

type KnowledgeGraphJobStart = {
  jobId: string
  graphId: string
  topic: string
  status: 'processing'
}

type KnowledgeGraphJobStatus = {
  jobId: string
  graphId: string
  topic: string
  status: 'processing' | 'completed' | 'failed'
  message?: string
  code?: string
  graph?: KnowledgeGraph
}

async function pollKnowledgeGraphJob(jobId: string): Promise<KnowledgeGraph> {
  for (let attempt = 0; attempt < 900; attempt += 1) {
    const response = await apiClient.get<ApiResponse<KnowledgeGraphJobStatus>>(
      `${API_ENDPOINTS.KNOWLEDGE_GRAPH}/jobs/${jobId}`,
      { timeout: 30000 }
    )
    if (response.data.status === 'completed' && response.data.graph) {
      return response.data.graph
    }
    if (response.data.status === 'failed') {
      throw new Error(response.data.message || 'AI 知识图谱分析失败，请稍后重试。')
    }
    await wait(2000)
  }
  throw new Error('AI 知识图谱分析仍在进行，请稍后再试。')
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

export { usePetStore } from './petStore'
