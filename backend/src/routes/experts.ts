import { Router } from 'express'
import { db } from '../db.js'
import { authMiddleware, type AuthRequest } from '../auth.js'

const router = Router()

// List B-side broker profiles. This is the platform expert pool in the business
// workflow: licensed advisors that can claim and handle submitted cases.
router.get('/', authMiddleware, (req: AuthRequest, res) => {
  const { search, specialty } = req.query as { search?: string; specialty?: string }

  let sql = `
    SELECT u.id, u.name, u.email, u.phone, u.city, u.career, u.profession,
           u.insurance_holdings, u.insurance_coverage_range, u.awareness_level,
           u.is_licensed, u.status, u.created_at,
           COUNT(DISTINCT o.id) as handled_cases,
           SUM(CASE WHEN o.case_status = '佣金已结算' THEN 1 ELSE 0 END) as settled_cases
    FROM users u
    LEFT JOIN orders o ON o.b_side_id = u.id
    WHERE u.platform_role = 'b_side' AND u.status = ?
  `
  const params: string[] = ['活跃']

  if (search) {
    sql += ' AND (u.name LIKE ? OR u.city LIKE ? OR u.career LIKE ? OR u.profession LIKE ?)'
    const like = `%${search}%`
    params.push(like, like, like, like)
  }

  sql += ' GROUP BY u.id ORDER BY handled_cases DESC, u.created_at DESC'

  const brokers = db.prepare(sql).all(...params) as Array<{
    id: string; name: string; email: string; phone: string | null; city: string | null;
    career: string | null; profession: string | null; insurance_holdings: string | null;
    insurance_coverage_range: string | null; awareness_level: string | null;
    is_licensed: number | null; status: string; created_at: string | null;
    handled_cases: number; settled_cases: number | null;
  }>

  const result = brokers.map(broker => {
    const specialties = [
      broker.profession || broker.career || '保险顾问',
      broker.insurance_holdings,
      broker.insurance_coverage_range,
    ].filter(Boolean) as string[]
    const tags = [
      broker.is_licensed ? '持牌顾问' : '待审核牌照',
      broker.city || '区域待补充',
      broker.awareness_level || '资料待完善',
    ].filter(Boolean) as string[]

    return {
      id: broker.id,
      name: broker.name,
      title: broker.profession || broker.career || 'B端保险顾问',
      score: broker.handled_cases > 0 ? '4.8' : '待接单',
      clients: String(broker.handled_cases || 0),
      response: '接单后联系',
      joinedAt: broker.created_at,
      regions: broker.city || '资料待完善',
      bio: `${broker.name} 是平台 B 端顾问，负责接单后与 A 端推荐人对接客户资料并推进保单流程。`,
      tags,
      specialties,
    }
  })

  // Filter by specialty if specified
  let filtered = result
  if (specialty) {
    filtered = result.filter(e => e.specialties.some(s => s.includes(specialty)) || e.tags.some(t => t.includes(specialty)))
  }

  res.json({ list: filtered })
})

// Get broker profile detail
router.get('/:id', authMiddleware, (_req, res) => {
  const broker = db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, u.city, u.career, u.profession,
           u.insurance_holdings, u.insurance_coverage_range, u.awareness_level,
           u.is_licensed, u.status, u.created_at,
           COUNT(DISTINCT o.id) as handled_cases
    FROM users u
    LEFT JOIN orders o ON o.b_side_id = u.id
    WHERE u.id = ? AND u.platform_role = 'b_side'
    GROUP BY u.id
  `).get(_req.params.id as string) as {
    id: string; name: string; email: string; phone: string | null; city: string | null;
    career: string | null; profession: string | null; insurance_holdings: string | null;
    insurance_coverage_range: string | null; awareness_level: string | null;
    is_licensed: number | null; status: string; created_at: string | null;
    handled_cases: number;
  } | undefined

  if (!broker) {
    res.status(404).json({ error: '顾问不存在' })
    return
  }

  const specialties = [
    broker.profession || broker.career || '保险顾问',
    broker.insurance_holdings,
    broker.insurance_coverage_range,
  ].filter(Boolean) as string[]
  const tags = [
    broker.is_licensed ? '持牌顾问' : '待审核牌照',
    broker.city || '区域待补充',
    broker.awareness_level || '资料待完善',
  ].filter(Boolean) as string[]

  res.json({
    id: broker.id,
    name: broker.name,
    title: broker.profession || broker.career || 'B端保险顾问',
    score: broker.handled_cases > 0 ? '4.8' : '待接单',
    clients: String(broker.handled_cases || 0),
    response: '接单后联系',
    joinedAt: broker.created_at,
    regions: broker.city || '资料待完善',
    bio: `${broker.name} 是平台 B 端顾问，负责接单后与 A 端推荐人对接客户资料并推进保单流程。`,
    tags,
    specialties,
  })
})

export default router
