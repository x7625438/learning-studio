import api from './client.js'

export async function getExperts(params?: { search?: string; specialty?: string }) {
  const res = await api.get('/experts', { params })
  return res.data
}

export async function getExpert(id: string) {
  const res = await api.get(`/experts/${id}`)
  return res.data
}
