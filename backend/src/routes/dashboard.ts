import { Router } from 'express'
import { db } from '../db.js'
import { authMiddleware, type AuthRequest } from '../auth.js'

const router = Router()

function parseMoneyLike(value: string | null | undefined) {
  if (!value) return 0
  const normalized = String(value).replace(/[,，$￥\s]/g, '')
  const match = normalized.match(/(\d+(?:\.\d+)?)/)
  if (!match) return 0
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return 0
  if (normalized.includes('万')) return amount * 10000
  return amount
}

// Dashboard overview
router.get('/overview', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!

  // Order stats
  const orderStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN COALESCE(case_status, '已提交') = '已提交' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN COALESCE(case_status, '已提交') IN ('已分配顾问', '会议已安排', '沟通中', '客户有顾虑', '客户暂时搁置', '申请已提交', '核保中', '需要体检') THEN 1 ELSE 0 END) as following,
      SUM(CASE WHEN COALESCE(case_status, '已提交') IN ('保单已批准', '佣金已结算') THEN 1 ELSE 0 END) as completed
    FROM orders WHERE user_id = ?
  `).get(userId) as { total: number; pending: number; following: number; completed: number }

  // Estimated income
  const premiums = db.prepare(`
    SELECT premium FROM orders WHERE user_id = ? AND COALESCE(case_status, status) != '客户不感兴趣'
  `).all(userId) as Array<{ premium: string | null }>
  const premiumTotal = premiums.reduce((sum, item) => sum + parseMoneyLike(item.premium), 0)

  // Notifications count
  const unreadNotif = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0').get(userId) as { count: number }

  // Team stats (if 合伙人)
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string }
  let teamStats = null
  if (user?.role === '合伙人') {
    const teamCount = db.prepare('SELECT COUNT(*) as count FROM team_members WHERE leader_id = ?').get(userId) as { count: number }
    const teamReferrals = db.prepare(`
      SELECT COUNT(*) as count FROM customers c
      JOIN users u ON c.user_id = u.id
      JOIN team_members tm ON tm.member_id = u.id
      WHERE tm.leader_id = ? AND strftime('%Y-%m', c.created_at) = strftime('%Y-%m', 'now')
    `).get(userId) as { count: number }
    const teamEarnings = db.prepare(`
      SELECT COALESCE(SUM(
        CAST(REPLACE(REPLACE(amount, '$', ''), ',', '') AS REAL)
      ), 0) as total FROM earnings WHERE user_id = ? AND type = '团队override' AND strftime('%Y-%m', date) = strftime('%Y-%m', 'now')
    `).get(userId) as { total: number }

    teamStats = {
      memberCount: teamCount.count,
      monthlyReferrals: teamReferrals.count,
      monthlyOverride: teamEarnings.total ? `$${teamEarnings.total.toFixed(0)}` : '$0',
      monthlyTotalIncome: teamEarnings.total ? `$${teamEarnings.total.toFixed(0)}` : '$0',
      personalIncome: '$0',
      teamIncome: teamEarnings.total ? `$${teamEarnings.total.toFixed(0)}` : '$0',
    }
  }

  res.json({
    totalCases: orderStats.total || 0,
    pending: orderStats.pending || 0,
    following: orderStats.following || 0,
    completed: orderStats.completed || 0,
    estimatedIncome: premiumTotal ? `$${(premiumTotal * 0.05).toFixed(0)}` : '$0',
    growth: '+12%',
    unreadNotifications: unreadNotif.count,
    team: teamStats,
  })
})

// Pending cases waiting for B-side brokers.
router.get('/pending-matches', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!

  const orders = db.prepare(`
    SELECT o.id, o.case_status, o.cooperation_type, o.urgency, o.need_type, o.premium, o.created_at,
           c.name as customer_name, c.need as customer_need, c.city as customer_city
    FROM orders o
    JOIN customers c ON o.customer_id = c.id
    WHERE o.user_id = ?
      AND o.b_side_id IS NULL
      AND COALESCE(o.case_status, '已提交') = '已提交'
    ORDER BY o.created_at DESC
    LIMIT 5
  `).all(userId) as Array<{
    id: string; case_status: string | null; cooperation_type: string | null; urgency: string | null;
    need_type: string | null; premium: string | null; created_at: string;
    customer_name: string; customer_need: string | null; customer_city: string | null
  }>

  res.json({
    cases: orders.map((order) => ({
      id: order.id,
      status: order.case_status || '已提交',
      cooperationType: order.cooperation_type || 'tier_50',
      urgency: order.urgency || '普通',
      needType: order.need_type,
      premium: order.premium,
      createdAt: order.created_at,
      customerName: order.customer_name,
      customerNeed: order.customer_need,
      customerCity: order.customer_city,
    })),
  })
})

// Dashboard notifications (for notification popover)
router.get('/notifications', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!

  const notifications = db.prepare(`
    SELECT id, type, title, content, related_id, created_at
    FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 10
  `).all(userId) as Array<{ id: number; type: string; title: string; content: string; related_id: string | null; created_at: string }>

  const unreadCount = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0').get(userId) as { count: number }

  res.json({
    list: notifications.map(n => ({
      id: n.id,
      type: n.type,
      title: n.title,
      content: n.content,
      relatedId: n.related_id,
      time: n.created_at,
    })),
    unreadCount: unreadCount.count,
  })
})

export default router
