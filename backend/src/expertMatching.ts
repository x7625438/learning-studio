import { db } from './db.js'

export function findMatchingExpertId(need?: string | null): string | null {
  const normalizedNeed = need ?? ''
  const specialtyKeywords = [
    normalizedNeed.includes('重疾') ? '重疾' : null,
    normalizedNeed.includes('医疗') ? '医疗' : null,
    normalizedNeed.includes('养老') ? '养老' : null,
    normalizedNeed.includes('教育') ? '教育' : null,
    normalizedNeed.includes('家庭') ? '家庭' : null,
  ].filter(Boolean) as string[]

  for (const keyword of specialtyKeywords) {
    const expert = db.prepare(`
      SELECT e.id
      FROM experts e
      LEFT JOIN expert_specialties s ON s.expert_id = e.id
      LEFT JOIN expert_tags t ON t.expert_id = e.id
      WHERE e.status = '活跃'
        AND (s.specialty LIKE ? OR t.tag LIKE ? OR e.title LIKE ?)
      ORDER BY e.score DESC
      LIMIT 1
    `).get(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`) as { id: string } | undefined

    if (expert?.id) return expert.id
  }

  const fallback = db.prepare(`
    SELECT id FROM experts
    WHERE status = '活跃'
    ORDER BY score DESC
    LIMIT 1
  `).get() as { id: string } | undefined

  return fallback?.id ?? null
}
