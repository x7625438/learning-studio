import api from './client.js'

export async function getTeamOverview() {
  const res = await api.get('/team')
  return res.data
}

export async function getTeamMembers(search?: string) {
  const res = await api.get('/team/members', { params: { search } })
  return res.data.list ?? []
}

export async function getTeamMember(id: string) {
  const res = await api.get(`/team/members/${id}`)
  return res.data
}

export async function getTeamEarnings(status?: string) {
  const res = await api.get('/team/earnings', { params: { status } })
  return res.data.list ?? []
}
