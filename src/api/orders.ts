import api from './client.js'

export async function getOrders(params?: { status?: string; search?: string }) {
  const res = await api.get('/orders', { params })
  return res.data
}

export async function createOrder(data: Record<string, unknown>) {
  const res = await api.post('/orders', data)
  return res.data
}

export async function getOrder(id: string) {
  const res = await api.get(`/orders/${id}`)
  return res.data
}

export async function getOrderMarketplace() {
  const res = await api.get('/orders/marketplace')
  return res.data
}

export async function claimOrder(id: string) {
  const res = await api.post(`/orders/${id}/claim`)
  return res.data
}

export async function updateOrderStatus(id: string, status: string) {
  const res = await api.put(`/orders/${id}/status`, { status })
  return res.data
}
