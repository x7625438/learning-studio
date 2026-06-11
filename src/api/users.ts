import api from './client.js'

export async function getProfile() {
  const res = await api.get('/users/profile')
  return {
    ...res.data.user,
    certifications: res.data.certifications ?? [],
    qualifications: res.data.certifications ?? [],
    settings: res.data.settings,
    inviteCount: res.data.inviteCount ?? 0,
  }
}

export async function updateProfile(data: Record<string, unknown>) {
  const res = await api.put('/users/profile', data)
  return res.data
}

export async function getNotificationSettings() {
  const res = await api.get('/users/settings/notifications')
  return res.data
}

export async function updateNotificationSettings(data: Record<string, boolean>) {
  const res = await api.put('/users/settings/notifications', data)
  return res.data
}

export async function getInviteInfo() {
  const res = await api.get('/users/invite')
  return res.data
}

export async function updateRole(role: '介绍人' | '合伙人') {
  const res = await api.put('/users/role', { role })
  return res.data
}

export async function addCertification(name: string) {
  const res = await api.post('/users/certifications', { name })
  return res.data
}
