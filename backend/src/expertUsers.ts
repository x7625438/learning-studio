import { db } from './db.js'

export function expertUserId(expertId: string) {
  return `expert-user-${expertId}`
}

export function ensureExpertUser(expertId: string): string | null {
  const expert = db.prepare('SELECT id, name, title, regions FROM experts WHERE id = ?').get(expertId) as
    { id: string; name: string; title: string; regions: string | null } | undefined

  if (!expert) return null

  const id = expertUserId(expert.id)
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, password_hash, name, city, career, role, status)
    VALUES (?, ?, ?, ?, ?, ?, '合伙人', '活跃')
  `).run(
    id,
    `${expert.id}@experts.insurance.local`,
    'expert-login-disabled',
    expert.name,
    expert.regions ?? '',
    expert.title,
  )

  return id
}
