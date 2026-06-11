import api from './client.js'

export async function getCustomers(params?: { status?: string; search?: string }) {
  const res = await api.get('/customers', { params })
  const data = res.data
  return {
    ...data,
    customers: data.list ?? [],
    total: data.stats?.total ?? 0,
    following: data.stats?.following ?? 0,
    submitted: data.stats?.submitted ?? 0,
    monthly: data.stats?.monthly ?? 0,
  }
}

export async function createCustomer(data: Record<string, unknown>) {
  const res = await api.post('/customers', data)
  return res.data
}

export async function getCustomer(id: string) {
  const res = await api.get(`/customers/${id}`)
  return res.data
}

export async function updateCustomer(id: string, data: Record<string, unknown>) {
  const res = await api.put(`/customers/${id}`, data)
  return res.data
}
