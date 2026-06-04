import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore, useLearningPathStore, useNotificationStore, useProfileStore } from '../store'
import apiClient from '../utils/api-client'

vi.mock('../utils/api-client', async () => {
  const actual = await vi.importActual<typeof import('../utils/api-client')>('../utils/api-client')
  return {
    ...actual,
    default: {
      get: vi.fn(),
      post: vi.fn(),
    },
  }
})

describe('stores', () => {
  beforeEach(() => {
    localStorage.clear()
    useNotificationStore.getState().clearNotifications()
    useAuthStore.setState({ user: null, token: null, isLoading: false })
  })

  it('adds and removes notifications', () => {
    useNotificationStore.getState().addNotification({ type: 'info', message: 'hello' })
    const id = useNotificationStore.getState().notifications[0].id
    expect(useNotificationStore.getState().notifications).toHaveLength(1)
    useNotificationStore.getState().removeNotification(id)
    expect(useNotificationStore.getState().notifications).toHaveLength(0)
  })

  it('clears auth token on logout', () => {
    localStorage.setItem('auth_token', 'token')
    useAuthStore.setState({ token: 'token' })
    useAuthStore.getState().logout()
    expect(useAuthStore.getState().token).toBeNull()
    expect(localStorage.getItem('auth_token')).toBeNull()
  })

  it('does not keep a persisted user without an auth token', () => {
    localStorage.removeItem('auth_token')
    const state = useAuthStore.persist.getOptions().merge?.(
      {
        user: {
          id: 'user-1',
          username: 'Mike',
          createdAt: null,
          updatedAt: null,
          lastLoginAt: null,
        },
        token: 'stale-token',
      },
      useAuthStore.getInitialState(),
    )

    expect(state?.user).toBeNull()
    expect(state?.token).toBeNull()
  })

  it('applies profile websocket updates', () => {
    useProfileStore.setState({ dashboard: null, weakPoints: [] })
    useProfileStore.getState().applyWebSocketUpdate({
      weakPoints: [
        {
          id: '1',
          knowledgeName: '泰勒展开',
          masteryScore: 32,
          errorCount: 2,
          correctCount: 0,
          priority: 'high',
          lastPracticedAt: null,
          nextReviewAt: null,
          reviewInterval: 1,
          source: 'qa',
        },
      ],
    })
    expect(useProfileStore.getState().weakPoints[0].knowledgeName).toBe('泰勒展开')
  })

  it('uses an extended timeout for AI learning path generation', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      data: {
        id: 'path-1',
        topic: '考研数学一',
        status: 'active',
        weeks: [],
      },
    })

    await useLearningPathStore.getState().generate({ topic: '考研数学一' })

    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/learning-path/generate',
      { topic: '考研数学一' },
      { timeout: 120000 },
    )
  })
})
