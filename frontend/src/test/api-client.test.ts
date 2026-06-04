import { beforeEach, describe, expect, it, vi } from 'vitest'

const axiosMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  requestUse: vi.fn(),
  responseUse: vi.fn(),
}))

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: axiosMock.get,
      post: axiosMock.post,
      put: axiosMock.put,
      delete: axiosMock.delete,
      interceptors: {
        request: { use: axiosMock.requestUse },
        response: { use: axiosMock.responseUse },
      },
    })),
  },
}))

describe('api client auth handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('clears a stale session on essay-grading 401 responses', async () => {
    window.history.pushState({}, '', '/login')

    const { useAuthStore } = await import('../store')
    await import('../utils/api-client')

    localStorage.setItem('auth_token', 'stale-token')
    useAuthStore.setState({ user: null, token: 'stale-token', isLoading: false })

    const handleRejected = axiosMock.responseUse.mock.calls[0][1]
    const error = {
      response: { status: 401, data: { message: 'Please log in again.' } },
      config: { url: '/api/v1/essay-grading' },
      message: 'Request failed with status code 401',
    }

    await expect(handleRejected(error)).rejects.toBe(error)
    expect(useAuthStore.getState().token).toBeNull()
    expect(localStorage.getItem('auth_token')).toBeNull()
  })
})
