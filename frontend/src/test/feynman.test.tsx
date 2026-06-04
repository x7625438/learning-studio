import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Feynman from '../pages/Feynman'
import apiClient from '../utils/api-client'
import { streamRequest } from '../utils/sse'

vi.mock('../utils/api-client', async () => {
  const actual = await vi.importActual<typeof import('../utils/api-client')>('../utils/api-client')
  return {
    ...actual,
    default: {
      post: vi.fn(),
    },
  }
})

vi.mock('../utils/sse', () => ({
  streamRequest: vi.fn(),
}))

describe('Feynman page', () => {
  afterEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('renders streamed AI follow-up as one dialogue message', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      data: {
        id: 'session-1',
        conceptIntro: '请解释梯度下降。',
      },
    })
    vi.mocked(streamRequest).mockImplementation(async function* () {
      yield { event: 'stream', data: { type: 'text', content: '你说会往低处走，' } }
      yield { event: 'stream', data: { type: 'text', content: '学习率太大会怎样？' } }
      yield { event: 'done', data: { type: 'done' } }
    })

    render(<Feynman />)
    fireEvent.click(screen.getByRole('button', { name: '开始讲解' }))
    await screen.findByText('请解释梯度下降。')

    fireEvent.change(screen.getByPlaceholderText('像教小朋友一样解释这个概念...'), {
      target: { value: '梯度下降就是沿着损失变小的方向更新。' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交解释' }))

    await waitFor(() => {
      expect(
        Array.from(document.querySelectorAll('p')).some((node) =>
          node.textContent?.includes('AI：你说会往低处走，学习率太大会怎样？'),
        ),
      ).toBe(true)
    })
    expect(streamRequest).toHaveBeenCalledWith(
      '/api/v1/feynman/session-1/explain',
      { text: '梯度下降就是沿着损失变小的方向更新。' },
    )
  })
})
