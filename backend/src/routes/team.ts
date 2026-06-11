import { Router } from 'express'
import { db } from '../db.js'
import { authMiddleware, type AuthRequest } from '../auth.js'

const router = Router()

// Get team overview
router.get('/', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!

  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined
  if (!user || user.role !== '合伙人') {
    res.status(403).json({ error: '仅合伙人可访问团队功能' })
    return
  }

  const memberCount = db.prepare('SELECT COUNT(*) as count FROM team_members WHERE leader_id = ?').get(userId) as { count: number }

  const monthlyReferrals = db.prepare(`
    SELECT COUNT(*) as count FROM customers c
    JOIN users u ON c.user_id = u.id
    JOIN team_members tm ON tm.member_id = u.id
    WHERE tm.leader_id = ? AND strftime('%Y-%m', c.created_at) = strftime('%Y-%m', 'now')
  `).get(userId) as { count: number }

  const monthlyOverride = db.prepare(`
    SELECT COALESCE(SUM(
      CAST(REPLACE(REPLACE(amount, '$', ''), ',', '') AS REAL)
    ), 0) as total FROM earnings
    WHERE user_id = ? AND type = '团队override' AND strftime('%Y-%m', date) = strftime('%Y-%m', 'now')
  `).get(userId) as { total: number }

  const totalEarnings = db.prepare(`
    SELECT COALESCE(SUM(
      CAST(REPLACE(REPLACE(amount, '$', ''), ',', '') AS REAL)
    ), 0) as total FROM earnings WHERE user_id = ? AND status = '已结算'
  `).get(userId) as { total: number }

  res.json({
    memberCount: memberCount.count,
    monthlyReferrals: monthlyReferrals.count,
    monthlyOverride: monthlyOverride.total ? `$${monthlyOverride.total.toFixed(0)}` : '$0',
    totalEarnings: totalEarnings.total ? `$${totalEarnings.total.toFixed(0)}` : '$0',
  })
})

// Get team members
router.get('/members', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!
  const { search } = req.query as { search?: string }

  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined
  if (!user || user.role !== '合伙人') {
    res.status(403).json({ error: '仅合伙人可访问' })
    return
  }

  let sql = `
    SELECT tm.id, tm.member_id, tm.join_date as team_join_date, tm.level, tm.contribution,
           u.name, u.email, u.phone, u.status as member_status
    FROM team_members tm
    JOIN users u ON tm.member_id = u.id
    WHERE tm.leader_id = ?
  `
  const params: (string | undefined)[] = [userId]

  if (search) {
    sql += ' AND u.name LIKE ?'
    params.push(`%${search}%`)
  }

  sql += ' ORDER BY tm.join_date DESC'

  const members = db.prepare(sql).all(...params) as Array<{
    id: number; member_id: string; name: string; email: string; phone: string | null; level: string;
    team_join_date: string | null; member_status: string; contribution: string
  }>

  const result = members.map(m => {
    const referrals = db.prepare('SELECT COUNT(*) as count FROM customers WHERE user_id = ?').get(m.member_id) as { count: number }
    const deals = db.prepare("SELECT COUNT(*) as count FROM orders WHERE user_id = ? AND status = '已完成'").get(m.member_id) as { count: number }
    const lastActive = db.prepare('SELECT MAX(created_at) as last_time FROM messages WHERE sender_id = ? OR receiver_id = ?').get(m.member_id, m.member_id) as { last_time: string | null }

    return {
      id: String(m.id),
      name: m.name,
      avatar: m.name.charAt(0),
      joinDate: m.team_join_date ?? '',
      level: m.level,
      referrals: referrals.count,
      deals: deals.count,
      contribution: m.contribution,
      status: m.member_status === '活跃' ? '活跃' : '新人',
      phone: m.phone ?? '',
      email: m.email,
      lastActive: lastActive.last_time ? lastActive.last_time.split('T')[0] : m.team_join_date || '',
      recentOrders: [],
    }
  })

  res.json({ list: result })
})

// Get member detail
router.get('/members/:id', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!

  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined
  if (!user || user.role !== '合伙人') {
    res.status(403).json({ error: '仅合伙人可访问' })
    return
  }

  const member = db.prepare(`
    SELECT tm.id, tm.member_id, tm.join_date as team_join_date, tm.level, tm.contribution,
           u.name, u.email, u.phone, u.status as member_status
    FROM team_members tm
    JOIN users u ON tm.member_id = u.id
    WHERE tm.id = ? AND tm.leader_id = ?
  `).get(req.params.id, userId) as {
    id: number; member_id: string; name: string; email: string; phone: string | null; level: string;
    team_join_date: string | null; member_status: string; contribution: string
  } | undefined

  if (!member) {
    res.status(404).json({ error: '成员不存在' })
    return
  }

  const referrals = db.prepare('SELECT COUNT(*) as count FROM customers WHERE user_id = ?').get(member.member_id) as { count: number }
  const deals = db.prepare("SELECT COUNT(*) as count FROM orders WHERE user_id = ? AND status = '已完成'").get(member.member_id) as { count: number }

  const recentOrders = db.prepare(`
    SELECT o.id, c.name as customer_name, o.status, o.created_at as date, o.premium as amount
    FROM orders o
    JOIN customers c ON o.customer_id = c.id
    WHERE o.user_id = ?
    ORDER BY o.created_at DESC
    LIMIT 5
  `).all(member.member_id) as Array<{ id: string; customer_name: string; status: string; date: string; amount: string | null }>

  res.json({
    id: String(member.id),
    name: member.name,
    avatar: member.name.charAt(0),
    joinDate: member.team_join_date ?? '',
    level: member.level,
    referrals: referrals.count,
    deals: deals.count,
    contribution: member.contribution,
    status: member.member_status === '活跃' ? '活跃' : '新人',
    phone: member.phone ?? '',
    email: member.email,
    lastActive: member.team_join_date || '',
    recentOrders: recentOrders.map(o => ({
      id: o.id,
      type: o.customer_name,
      date: o.date ? o.date.split('T')[0] : '',
      status: o.status === '已完成' ? '已结算' : '待结算',
      amount: o.amount || '$0',
    })),
  })
})

// Get earnings
router.get('/earnings', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!
  const { status } = req.query as { status?: string }

  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined
  if (!user || user.role !== '合伙人') {
    res.status(403).json({ error: '仅合伙人可访问' })
    return
  }

  let sql = 'SELECT * FROM earnings WHERE user_id = ?'
  const params: (string | undefined)[] = [userId]

  if (status) {
    sql += ' AND status = ?'
    params.push(status)
  }

  sql += ' ORDER BY date DESC'

  const earnings = db.prepare(sql).all(...params) as Array<{
    id: number; type: string; amount: string; status: string; date: string; order_id: string | null
  }>

  const result = earnings.map(e => {
    const memberName = e.type.includes('团队')
      ? db.prepare('SELECT name FROM users WHERE id = (SELECT member_id FROM team_members WHERE leader_id = ? LIMIT 1)').get(userId) as { name: string } | undefined
      : undefined

    return {
      id: e.id,
      member: memberName?.name || '团队成员',
      avatar: memberName?.name?.charAt(0) || '团',
      orderId: e.order_id || '',
      type: e.type,
      override: e.amount,
      date: e.date,
      status: e.status as '已结算' | '待结算',
    }
  })

  res.json({ list: result })
})

export default router
