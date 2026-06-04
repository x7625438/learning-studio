import { StreamEvent } from '../types/api'
import { useAuthStore } from '../store'

const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

function buildRequestUrl(url: string) {
  if (/^https?:\/\//.test(url)) return url
  if (!API_BASE_URL) return url
  return `${API_BASE_URL}${url.startsWith('/') ? url : `/${url}`}`
}

export async function* streamRequest(
  url: string,
  body: unknown,
  signal?: AbortSignal
): AsyncGenerator<StreamEvent> {
  const token = localStorage.getItem('auth_token') || useAuthStore.getState().token
  const response = await fetch(buildRequestUrl(url), {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok || !response.body) {
    const fallback = `SSE request failed: ${response.status}`
    let message = fallback
    try {
      const payload = await response.json()
      message = String(payload?.message || fallback)
    } catch {
      try {
        const text = await response.text()
        if (text.trim()) message = text.trim()
      } catch {
        message = fallback
      }
    }
    throw new Error(message)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() || ''

    for (const chunk of chunks) {
      const normalizedChunk = chunk.replace(/\r/g, '')
      const event = normalizedChunk.match(/^event:\s*(.+)$/m)?.[1] || 'message'
      const dataLine = normalizedChunk.match(/^data:\s*(.+)$/m)?.[1]
      if (!dataLine) continue
      yield { event, data: JSON.parse(dataLine) }
    }
  }
}
