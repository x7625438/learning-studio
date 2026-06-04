import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Textbook from '../pages/Textbook'
import apiClient from '../utils/api-client'
import { streamRequest } from '../utils/sse'
import { formatTextbookAnswer } from '../utils/textbook-format'

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

describe('Textbook page', () => {
  afterEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('renders a compact reader layout after upload', async () => {
    localStorage.setItem('auth_token', 'test-token')
    vi.mocked(apiClient.post).mockResolvedValue({
      data: {
        id: 'textbook-1',
        fileName: '义务教育教科书-数学八年级下册.pdf',
        fileType: 'pdf',
        fileUrl: '/api/v1/textbook/textbook-1/file',
        totalPages: 3,
        sections: [{ pageNum: 1, paragraphIndex: 0, text: '第一段教材内容' }],
      },
    })

    const { container } = render(<Textbook />)
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['pdf-content'], 'math.pdf', { type: 'application/pdf' })] },
    })

    await screen.findByText('选页模式')
    const layout = container.querySelector('div.grid.h-\\[calc\\(100vh-6rem\\)\\]') as HTMLDivElement
    expect(layout).toHaveClass('lg:grid-cols-[360px_minmax(0,1fr)]')
    expect(screen.getByRole('heading', { name: '义务教育教科书-数学八年级下册' })).toBeInTheDocument()
  })

  it('allows selecting multiple pages and sends them with the query', async () => {
    localStorage.setItem('auth_token', 'test-token')
    vi.mocked(apiClient.post).mockResolvedValue({
      data: {
        id: 'textbook-1',
        fileName: '义务教育教科书-数学八年级下册.pdf',
        fileType: 'pdf',
        fileUrl: '/api/v1/textbook/textbook-1/file',
        totalPages: 3,
        sections: [{ pageNum: 1, paragraphIndex: 0, text: '第一段教材内容' }],
      },
    })
    vi.mocked(streamRequest).mockImplementation(async function* () {
      yield { event: 'stream', data: { type: 'text', content: '收到选中的页面。' } }
    })

    const { container } = render(<Textbook />)
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['pdf-content'], 'math.pdf', { type: 'application/pdf' })] },
    })

    await screen.findByText('选页模式')
    fireEvent.click(screen.getByRole('button', { name: '选页模式' }))
    fireEvent.click(screen.getByRole('button', { name: /第 1 页/ }))
    fireEvent.click(screen.getByRole('button', { name: /第 3 页/ }))

    expect(screen.getByText('已选 2 页：1, 3')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('基于教材内容提问'), {
      target: { value: '这两页在讲什么？' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => {
      expect(streamRequest).toHaveBeenCalledWith(
        '/api/v1/textbook/textbook-1/query',
        expect.objectContaining({
          question: '这两页在讲什么？',
          selectedPages: [1, 3],
        }),
      )
    })
  })

  it('formats sqrt expressions into natural root notation', () => {
    expect(formatTextbookAnswer('这一页出现了 sqrt(h/5) 和 $\\sqrt{3}$')).toBe(
      '这一页出现了 √(h/5) 和 √3',
    )
  })
})
