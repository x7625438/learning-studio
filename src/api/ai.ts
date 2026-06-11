import api from './client.js'

export async function createConversation() {
  const res = await api.post('/ai/conversations')
  return res.data as { conversationId: string }
}

export async function sendAIMessage(conversationId: string, text: string) {
  const res = await api.post(`/ai/conversations/${conversationId}/messages`, { text })
  return res.data as { reply: string; extracted: Record<string, unknown> }
}

export async function getConversation(conversationId: string) {
  const res = await api.get(`/ai/conversations/${conversationId}`)
  return res.data
}

export async function completeConversation(conversationId: string, customerData?: Record<string, unknown>) {
  const res = await api.post(`/ai/conversations/${conversationId}/complete`, { customerData })
  return res.data as { customerId: string; orderId: string; alreadyCompleted?: boolean }
}
