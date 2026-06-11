import api from './client.js'

export async function getAdminOverview() {
  const res = await api.get('/admin/overview')
  return res.data
}

export async function getAdminOrders() {
  const res = await api.get('/admin/orders')
  return res.data
}

export async function getAdminUsers() {
  const res = await api.get('/admin/users')
  return res.data
}

export async function getAdminBrokers() {
  const res = await api.get('/admin/brokers')
  return res.data
}

export async function assignAdminOrder(orderId: string, brokerId: string) {
  const res = await api.put(`/admin/orders/${orderId}/assign`, { brokerId })
  return res.data
}
