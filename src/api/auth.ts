import api from './client.js'

export interface User {
  id: string
  email: string
  name: string
  role: '介绍人' | '合伙人'
  platformRole?: 'a_side' | 'b_side' | 'admin'
  aSideType?: 'regular_a' | 'small_a' | 'big_a'
  overrideRate?: number
  status: string
  phone: string | null
  city: string | null
  career: string | null
  clientType: string | null
  avatar: string | null
}

export async function register(data: { email: string; password: string; name: string; phone?: string; city?: string; profession?: string; inviteCode?: string; insuranceHoldings?: string; insuranceCoverageRange?: string; awarenessLevel?: string; isLicensed?: boolean; platformRole?: 'a_side' | 'b_side'; aSideType?: 'regular_a' | 'small_a' | 'big_a' }) {
  const res = await api.post('/auth/register', data)
  return res.data
}

export async function login(email: string, password: string) {
  const res = await api.post('/auth/login', { email, password })
  return res.data as { token: string; user: User }
}

export async function getMe() {
  const res = await api.get('/auth/me')
  return res.data.user as User
}

export async function changePassword(oldPassword: string, newPassword: string) {
  const res = await api.put('/auth/password', { oldPassword, newPassword })
  return res.data
}
