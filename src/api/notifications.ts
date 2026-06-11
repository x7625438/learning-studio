import api from './client.js'

export async function getNotifications(unreadOnly?: boolean) {
  const res = await api.get('/notifications', { params: { unreadOnly } })
  return res.data
}

export async function markAsRead(id: number) {
  const res = await api.put(`/notifications/${id}/read`)
  return res.data
}

export async function markAllAsRead() {
  const res = await api.put('/notifications/read-all')
  return res.data
}
