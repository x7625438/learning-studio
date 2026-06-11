import { Router } from 'express'
import type { Response } from 'express'
import { db } from '../db.js'
import { authMiddleware, type AuthRequest } from '../auth.js'

const router = Router()

function requireAdmin(req: AuthRequest, res: Response) {
  const user = db.prepare('SELECT id, platform_role FROM users WHERE id = ?').get(req.userId!) as
    { id: string; platform_role: string | null } | undefined
  if (user?.platform_role !== 'admin') {
    res.status(403).json({ error: '仅管理员可访问' })
    return false
  }
  return true
}

router.get('/overview', authMiddleware, (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return

  const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get() as { count: number }
  const unassigned = db.prepare("SELECT COUNT(*) as count FROM orders WHERE b_side_id IS NULL AND COALESCE(case_status, '已提交') = '已提交'").get() as { count: number }
  const overdue = db.prepare(`
    SELECT COUNT(*) as count FROM orders
    WHERE b_side_id IS NULL
      AND COALESCE(case_status, '已提交') = '已提交'
      AND datetime(created_at) <= datetime('now', '-1 hour')
  `).get() as { count: number }
  const activeBrokers = db.prepare("SELECT COUNT(*) as count FROM users WHERE platform_role = 'b_side' AND status = '活跃'").get() as { count: number }
  const pendingCommissions = db.prepare("SELECT COUNT(*) as count FROM commissions WHERE status IN ('pending', 'approved')").get() as { count: number }

  // Generate SLA alerts for overdue orders (unclaimed > 1 hour)
  const overdueOrders = db.prepare(`
    SELECT o.id, o.created_at
    FROM orders o
    WHERE o.b_side_id IS NULL
      AND COALESCE(o.case_status, '已提交') = '已提交'
      AND datetime(o.created_at) <= datetime('now', '-1 hour')
  `).all() as Array<{ id: string; created_at: string }>

  for (const order of overdueOrders) {
    // Check if alert already sent for this order
    const existingAlert = db.prepare(`
      SELECT COUNT(*) as count FROM notifications
      WHERE type = 'sla_alert' AND related_id = ?
    `).get(order.id) as { count: number }

    if (existingAlert.count === 0) {
      // Send alert to all admins
      const admins = db.prepare("SELECT id FROM users WHERE platform_role = 'admin'").all() as Array<{ id: string }>
      for (const admin of admins) {
        db.prepare(`
          INSERT INTO notifications (user_id, type, title, content, related_id)
          VALUES (?, 'sla_alert', 'SLA 告警：工单超时未接', ?, ?)
        `).run(admin.id, `工单 ${order.id} 已超过 1 小时未被接单，需要人工介入。`, order.id)
      }
    }
  }

  res.json({
    totalOrders: totalOrders.count,
    unassigned: unassigned.count,
    overdue: overdue.count,
    activeBrokers: activeBrokers.count,
    pendingCommissions: pendingCommissions.count,
  })
})

router.get('/orders', authMiddleware, (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return

  const rows = db.prepare(`
    SELECT o.id, o.case_status, o.cooperation_type, o.urgency, o.premium, o.need_type, o.created_at,
           c.name as customer_name, c.city as customer_city,
           a.name as a_name, b.name as b_name
    FROM orders o
    JOIN customers c ON o.customer_id = c.id
    JOIN users a ON o.user_id = a.id
    LEFT JOIN users b ON o.b_side_id = b.id
    ORDER BY o.created_at DESC
    LIMIT 100
  `).all() as Array<Record<string, string | null>>

  res.json({
    list: rows.map((row) => ({
      id: row.id,
      status: row.case_status || '已提交',
      cooperationType: row.cooperation_type || 'tier_50',
      urgency: row.urgency || '普通',
      premium: row.premium,
      needType: row.need_type,
      createdAt: row.created_at,
      customerName: row.customer_name,
      customerCity: row.customer_city,
      aSideName: row.a_name,
      bSideName: row.b_name,
    })),
  })
})

router.get('/users', authMiddleware, (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return

  const users = db.prepare(`
    SELECT id, name, email, phone, role, platform_role, a_side_type, override_rate, status, created_at
    FROM users
    ORDER BY created_at DESC
    LIMIT 200
  `).all() as Array<Record<string, string | number | null>>

  res.json({ list: users })
})

router.get('/brokers', authMiddleware, (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return

  const brokers = db.prepare(`
    SELECT id, name, email, phone, city, career, status
    FROM users
    WHERE platform_role = 'b_side'
    ORDER BY name ASC
  `).all() as Array<Record<string, string | null>>

  res.json({ list: brokers })
})

router.put('/orders/:id/assign', authMiddleware, (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return
  const { brokerId } = req.body as { brokerId?: string }

  const broker = db.prepare("SELECT id, name FROM users WHERE id = ? AND platform_role = 'b_side'").get(brokerId) as
    { id: string; name: string } | undefined
  if (!broker) {
    res.status(400).json({ error: 'B端顾问不存在' })
    return
  }

  const order = db.prepare('SELECT id, user_id, case_status FROM orders WHERE id = ?').get(req.params.id as string) as
    { id: string; user_id: string; case_status: string | null } | undefined
  if (!order) {
    res.status(404).json({ error: '工单不存在' })
    return
  }

  db.prepare(`
    UPDATE orders
    SET b_side_id = ?, case_status = '已分配顾问', status = '已匹配',
        assigned_at = COALESCE(assigned_at, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(broker.id, order.id)

  db.prepare(`
    INSERT INTO order_timeline (order_id, title, detail, color)
    VALUES (?, 'Admin 已分配顾问', ?, 'blue')
  `).run(order.id, `管理员将工单分配给 B端顾问 ${broker.name}`)

  db.prepare(`
    INSERT INTO case_status_history (order_id, old_status, new_status, changed_by)
    VALUES (?, ?, '已分配顾问', ?)
  `).run(order.id, order.case_status || '已提交', req.userId!)

  db.prepare(`
    INSERT INTO notifications (user_id, type, title, content, related_id)
    VALUES (?, 'order', '工单已分配顾问', ?, ?)
  `).run(order.user_id, `平台已为该工单分配 B端顾问 ${broker.name}。`, order.id)

  res.json({ success: true })
})

export default router
