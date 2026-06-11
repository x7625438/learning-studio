import api from './client.js'

type ContactResponse = {
  id: string
  name: string
  role?: string
  lastMessage?: string
  lastTime?: string
  unreadCount?: number
  order?: {
    id?: string
    customerName?: string
    status?: string
    interactionStatus?: string
    summary?: string
  } | null
}

export async function getContacts() {
  const res = await api.get('/messages/contacts')
  return ((res.data.contacts ?? []) as ContactResponse[]).map((contact) => ({
    ...contact,
    time: contact.lastTime ? String(contact.lastTime).slice(5, 16).replace('T', ' ') : '',
    orderTopic: contact.order?.id ?? '',
    customerName: contact.order?.customerName ?? '',
    customerStatus: contact.order?.interactionStatus ?? contact.order?.status ?? '',
    customerSummary: contact.order?.summary ?? '',
  }))
}

export async function getMessages(contactId: string) {
  const res = await api.get(`/messages/${contactId}`)
  return res.data.messages ?? []
}

export async function sendMessage(receiverId: string, content: string, orderId?: string) {
  const res = await api.post('/messages', { receiverId, content, orderId })
  return res.data
}
