import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios'
import { useAuthStore, useNotificationStore } from '../store'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

export const API_ENDPOINTS = {
  AUTH: '/api/v1/auth',
  PROFILE: '/api/v1/profile',
  WEAK_POINTS: '/api/v1/weak-points',
  QA: '/api/v1/qa',
  TEXTBOOK: '/api/v1/textbook',
  PRACTICE: '/api/v1/practice',
  CALENDAR: '/api/v1/calendar',
  MILESTONES: '/api/v1/milestones',
  FEYNMAN: '/api/v1/feynman',
  LEARNING_PATH: '/api/v1/learning-path',
  DOCUMENTS: '/api/v1/documents',
  KNOWLEDGE_GRAPH: '/api/v1/knowledge-graph',
  PET: '/api/v1/pet',
  USER_PROFILE_DOC: '/api/v1/user-profile-doc',
  WRONG_QUESTIONS: '/api/v1/wrong-questions',
  ESSAY_GRADING: '/api/v1/essay-grading',
  KNOWLEDGE_MEMORIES: '/api/v1/knowledge-memories',
  TUTORING: '/api/v1/tutoring',
} as const

// Extended config type — `silent` suppresses error notifications for background loads
export interface RequestConfig extends AxiosRequestConfig {
  silent?: boolean
}

class APIClient {
  private client: AxiosInstance

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    })
    this.setupInterceptors()
  }

  private setupInterceptors() {
    this.client.interceptors.request.use((config) => {
      const token = localStorage.getItem('auth_token') || useAuthStore.getState().token
      if (token) config.headers.Authorization = `Bearer ${token}`
      return config
    })

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError<{ message?: string }>) => {
        const status = error.response?.status
        const message = error.response?.data?.message || error.message || '请求失败'

        // Essay-grading page handles non-auth errors inline without a toast.
        const url: string = error.config?.url || ''
        const isEssayGrading = url.includes('/essay-grading')

        // 401 means the saved session is no longer valid. Keep this global so
        // every protected page leaves the stale logged-in state consistently.
        if (status === 401) {
          useAuthStore.getState().logout()
          if (window.location.pathname !== '/login') {
            window.location.href = '/login'
          }
          return Promise.reject(error)
        }

        // Skip toast for essay-grading (page handles errors inline)
        if (isEssayGrading) {
          return Promise.reject(error)
        }

        // Default: show notification
        useNotificationStore.getState().addNotification({
          type: status && status >= 500 ? 'error' : 'warning',
          message,
        })
        return Promise.reject(error)
      },
    )
  }

  async get<T>(url: string, config?: RequestConfig): Promise<T> {
    const response = await this.client.get<T>(url, config)
    return response.data
  }

  async post<T>(url: string, data?: unknown, config?: RequestConfig): Promise<T> {
    const response = await this.client.post<T>(url, data, config)
    return response.data
  }

  async put<T>(url: string, data?: unknown, config?: RequestConfig): Promise<T> {
    const response = await this.client.put<T>(url, data, config)
    return response.data
  }

  async delete<T>(url: string, config?: RequestConfig): Promise<T> {
    const response = await this.client.delete<T>(url, config)
    return response.data
  }
}

export const apiClient = new APIClient()
export default apiClient
