import api from './client.js'

export async function getOverview() {
  const res = await api.get('/dashboard/overview')
  return res.data
}

export async function getPendingMatches() {
  const res = await api.get('/dashboard/pending-matches')
  return res.data
}

export async function getDashboardNotifications() {
  const res = await api.get('/dashboard/notifications')
  return res.data
}
