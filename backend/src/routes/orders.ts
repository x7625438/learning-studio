import { Router } from 'express'
import { createHash } from 'crypto'
import { db } from '../db.js'
import { authMiddleware, type AuthRequest } from '../auth.js'

const router = Router()

const CASE_STATUSES = [
  '已提交',
  '已分配顾问',
  '会议已安排',
  '沟通中',
  '客户有顾虑',
  '客户暂时搁置',
  '客户不感兴趣',
  '申请已提交',
  '核保中',
  '需要体检',
  '保单已批准',
  '佣金已结算',
] as const

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

function clientPhoneHash(phone: string) {
  return createHash('sha256').update(phone.replace(/\D/g, '')).digest('hex')
}

function createCommissionsIfSettled(orderId: string) {
  // Wrapped in transaction to ensure atomicity: all 3 commissions or none
  const doCreateCommissions = db.transaction((orderId: string) => {
    const order = db.prepare(`
      SELECT o.id, o.user_id, o.b_side_id, o.premium, o.cooperation_type,
             u.override_rate
      FROM orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.id = ?
    `).get(orderId) as {
      id: string; user_id: string; b_side_id: string | null; premium: string | null;
      cooperation_type: string | null; override_rate: number | null
    } | undefined
    if (!order || !order.b_side_id) return

    const existing = db.prepare('SELECT COUNT(*) as count FROM commissions WHERE order_id = ?').get(orderId) as { count: number }
    if (existing.count > 0) return

    const cooperationRatioMap: Record<string, number> = {
      tier_20: 0.2,
      tier_50: 0.5,
      tier_70: 0.7,
    }
    const fyp = parseMoneyLike(order.premium)
    if (fyp <= 0) return
    const fyc = fyp * 0.5
    const ratio = cooperationRatioMap[order.cooperation_type || 'tier_50'] ?? 0.5
    const overrideRate = (order.override_rate ?? 250) / 100
    const bRate = 2.5
    const totalPool = fyc * 3.1
    const aAmount = fyc * ratio * overrideRate
    const bAmount = fyc * (1 - ratio) * bRate
    const platformAmount = Math.max(0, totalPool - aAmount - bAmount)

    // Ensure platform user exists (within transaction)
    db.prepare(`
      INSERT OR IGNORE INTO users (
        id, email, password_hash, name, role, status, invite_code,
        platform_role, a_side_type, override_rate
      )
      VALUES (
        'platform', 'platform@insurance.local', 'system-owned-account',
        '平台留存', '合伙人', '活跃', 'INV-platform',
        'admin', 'big_a', 270
      )
    `).run()

    const insert = db.prepare(`
      INSERT INTO commissions (order_id, user_id, role, amount, status)
      VALUES (?, ?, ?, ?, 'approved')
    `)

    // Big A / Small A override split
    const aUser = db.prepare('SELECT a_side_type, parent_id FROM users WHERE id = ?').get(order.user_id) as
      { a_side_type: string | null; parent_id: string | null } | undefined

    if (aUser?.a_side_type === 'small_a' && aUser.parent_id) {
      // Small A -> Big A split
      // Default: small A gets 130%, big A gets 140% (total 270%)
      const smallASplit = 1.3
      const bigASplit = overrideRate - smallASplit
      const smallAAmount = fyc * ratio * smallASplit
      const bigAAmount = fyc * ratio * bigASplit

      insert.run(orderId, order.user_id, 'a_side', `$${smallAAmount.toFixed(0)}`)
      insert.run(orderId, aUser.parent_id, 'big_a_override', `$${bigAAmount.toFixed(0)}`)

      // Notify big A about override income
      db.prepare(`
        INSERT INTO notifications (user_id, type, title, content, related_id)
        VALUES (?, 'commission', '团队佣金到账', ?, ?)
      `).run(aUser.parent_id,
        `小A成员工单 ${orderId} 已结算，你获得 override 佣金 $${bigAAmount.toFixed(0)}。`,
        orderId)
    } else {
      insert.run(orderId, order.user_id, 'a_side', `$${aAmount.toFixed(0)}`)
    }

    insert.run(orderId, order.b_side_id, 'b_side', `$${bAmount.toFixed(0)}`)
    insert.run(orderId, 'platform', 'platform', `$${platformAmount.toFixed(0)}`)

    // Check for referral bonus (平级推荐)
    const referrer = db.prepare('SELECT referred_by FROM users WHERE id = ?').get(order.user_id) as
      { referred_by: string | null } | undefined
    if (referrer?.referred_by) {
      // Check if this is the referred user's FIRST completed deal
      const completedCount = db.prepare(`
        SELECT COUNT(*) as count FROM orders o
        JOIN users u ON o.user_id = u.id
        WHERE u.id = ? AND o.case_status = '佣金已结算'
      `).get(order.user_id) as { count: number }

      if (completedCount.count <= 1) {
        // One-time referral bonus: $100
        db.prepare(`
          INSERT INTO commissions (order_id, user_id, role, amount, status)
          VALUES (?, ?, 'referral_bonus', '$100', 'approved')
        `).run(orderId, referrer.referred_by)

        db.prepare(`
          INSERT INTO notifications (user_id, type, title, content, related_id)
          VALUES (?, 'commission', '推荐奖励到账', ?, ?)
        `).run(referrer.referred_by,
          `你推荐的用户已完成首单，获得 $100 推荐奖励。`,
          orderId)
      }
    }
  })

  // Execute within transaction
  doCreateCommissions(orderId)
}

// Fix missing platform commissions for orders that already settled
function fixMissingCommissions(orderId: string) {
  const existing = db.prepare('SELECT role FROM commissions WHERE order_id = ?').all(orderId) as Array<{ role: string }>
  const roles = existing.map(r => r.role)
  if (!roles.includes('platform') && roles.length > 0) {
    createCommissionsIfSettled(orderId)
  }
}


function getCurrentUser(userId: string) {
  return db.prepare('SELECT id, name, platform_role, a_side_type FROM users WHERE id = ?').get(userId) as
    { id: string; name: string; platform_role: string | null; a_side_type: string | null } | undefined
}

function buildOrderDetail(orderId: string, userId?: string) {
  const order = db.prepare(`
    SELECT o.*, c.name as customer_name, c.need as customer_need, c.age as customer_age,
           c.city as customer_city, c.gender as customer_gender, c.family as customer_family,
           c.children as customer_children, c.job as customer_job, c.income as customer_income, c.assets as customer_assets,
           c.products as customer_products, c.budget as customer_budget,
           c.supplement as customer_supplement, c.return_value as customer_return_value,
           c.phone as customer_phone, c.created_at as customer_created_at,
           e.name as expert_name, e.title as expert_title, e.score as expert_score,
           e.clients as expert_clients, e.response as expert_response, e.joined_at as expert_joined_at,
           e.regions as expert_regions, e.bio as expert_bio,
           b.name as broker_name, b.email as broker_email, b.phone as broker_phone, b.city as broker_city
    FROM orders o
    LEFT JOIN customers c ON o.customer_id = c.id
    LEFT JOIN experts e ON o.expert_id = e.id
    LEFT JOIN users b ON o.b_side_id = b.id
    WHERE o.id = ?
    ${userId ? 'AND (o.user_id = ? OR o.b_side_id = ?)' : ''}
  `).get(...(userId ? [orderId, userId, userId] : [orderId])) as Record<string, string | number | null> | undefined

  if (!order) return null

  const timeline = db.prepare('SELECT * FROM order_timeline WHERE order_id = ? ORDER BY time DESC').all(orderId) as Array<{
    title: string; detail: string; time: string; color: string
  }>

  const expertTags = order.expert_id
    ? db.prepare('SELECT tag FROM expert_tags WHERE expert_id = ?').all(order.expert_id as string) as Array<{ tag: string }>
    : []
  const expertSpecialties = order.expert_id
    ? db.prepare('SELECT specialty FROM expert_specialties WHERE expert_id = ?').all(order.expert_id as string) as Array<{ specialty: string }>
    : []

  return {
    id: order.id,
    status: order.case_status || order.status,
    legacyStatus: order.status,
    createdAt: order.created_at,
    premium: order.premium,
    needType: order.need_type,
    products: order.products,
    cooperationType: order.cooperation_type,
    urgency: order.urgency,
    assignedAt: order.assigned_at,
    customer: {
      name: order.customer_name,
      phone: order.customer_phone,
      need: order.customer_need,
      age: order.customer_age,
      city: order.customer_city,
      gender: order.customer_gender,
      family: order.customer_family,
      children: order.customer_children,
      job: order.customer_job,
      income: order.customer_income,
      assets: order.customer_assets,
      products: order.customer_products,
      budget: order.customer_budget,
      supplement: order.customer_supplement,
      returnValue: order.customer_return_value,
      createdAt: order.customer_created_at,
    },
    expert: order.expert_id ? {
      name: order.expert_name,
      title: order.expert_title,
      score: String(order.expert_score),
      clients: String(order.expert_clients),
      response: order.expert_response,
      joinedAt: order.expert_joined_at,
      regions: order.expert_regions,
      bio: order.expert_bio,
      tags: expertTags.map(t => t.tag),
      specialties: expertSpecialties.map(s => s.specialty),
    } : null,
    broker: order.b_side_id ? {
      id: order.b_side_id,
      name: order.broker_name,
      email: order.broker_email,
      phone: order.broker_phone,
      city: order.broker_city,
    } : null,
    timeline: timeline.map(t => ({
      title: t.title,
      detail: t.detail,
      time: t.time,
      color: t.color as 'green' | 'blue' | 'red' | 'gray',
    })),
  }
}

// List orders
router.get('/', authMiddleware, (req: AuthRequest, res) => {
  const { status: tab, search } = req.query as { status?: string; search?: string }
  const userId = req.userId!
  const currentUser = getCurrentUser(userId)
  if (!currentUser) {
    res.status(401).json({ error: '用户不存在' })
    return
  }

  let sql = `
    SELECT o.*, c.name as c_name, c.need as c_need, c.age as c_age, c.city as c_city,
           c.gender as c_gender, c.family as c_family, c.children as c_children, c.job as c_job, c.income as c_income,
           c.assets as c_assets, c.products as c_products, c.budget as c_budget,
           c.supplement as c_supplement, c.return_value as c_return_value, c.phone as c_phone, c.created_at as c_created_at,
           e.name as e_name, e.title as e_title, e.score as e_score, e.clients as e_clients,
           e.response as e_response, e.joined_at as e_joined_at, e.regions as e_regions, e.bio as e_bio,
           b.name as b_name, b.email as b_email, b.phone as b_phone, b.city as b_city
    FROM orders o
    LEFT JOIN customers c ON o.customer_id = c.id
    LEFT JOIN experts e ON o.expert_id = e.id
    LEFT JOIN users b ON o.b_side_id = b.id
  `
  const params: (string | undefined)[] = []

  if (currentUser.platform_role === 'admin') {
    sql += ' WHERE 1 = 1'
  } else if (currentUser.platform_role === 'b_side') {
    sql += ' WHERE o.b_side_id = ?'
    params.push(userId)
  } else {
    sql += ' WHERE o.user_id = ?'
    params.push(userId)
  }

  if (tab && tab !== '全部') {
    const statusMap: Record<string, string[]> = {
      '跟进中': ['已分配顾问', '会议已安排', '沟通中', '申请已提交', '核保中', '需要体检'],
      '已完成': ['保单已批准', '佣金已结算'],
      '需关注': ['客户有顾虑', '客户暂时搁置', '客户不感兴趣'],
    }
    const statuses = statusMap[tab]
    if (statuses) {
      sql += ` AND COALESCE(o.case_status, '已提交') IN (${statuses.map(() => '?').join(',')})`
      params.push(...statuses)
    }
  }

  if (search) {
    sql += ' AND (c.name LIKE ? OR e.name LIKE ? OR o.need_type LIKE ?)'
    const like = `%${search}%`
    params.push(like, like, like)
  }

  sql += ' ORDER BY o.created_at DESC'

  const orders = db.prepare(sql).all(...params) as Array<Record<string, string | null>>

  res.json({
    list: orders.map(o => {
      const expertTags = o.e_name ? db.prepare('SELECT tag FROM expert_tags WHERE expert_id = ?').all(o.expert_id as string) as Array<{ tag: string }> : []
      const expertSpecialties = o.e_name ? db.prepare('SELECT specialty FROM expert_specialties WHERE expert_id = ?').all(o.expert_id as string) as Array<{ specialty: string }> : []
      return {
        id: o.id,
        status: o.case_status || o.status,
        legacyStatus: o.status,
        createdAt: o.created_at,
        premium: o.premium,
        needType: o.need_type,
        cooperationType: o.cooperation_type,
        urgency: o.urgency,
        customer: {
          name: o.c_name,
          phone: o.c_phone,
          need: o.c_need,
          age: o.c_age,
          city: o.c_city,
          gender: o.c_gender,
          family: o.c_family,
          children: o.c_children,
          job: o.c_job,
          income: o.c_income,
          assets: o.c_assets,
          products: o.c_products,
          budget: o.c_budget,
          supplement: o.c_supplement,
          returnValue: o.c_return_value,
          createdAt: o.c_created_at,
        },
        expert: o.e_name ? {
          name: o.e_name,
          title: o.e_title,
          score: String(o.e_score || 0),
          clients: String(o.e_clients || 0),
          response: o.e_response,
          joinedAt: o.e_joined_at,
          regions: o.e_regions,
          bio: o.e_bio,
          tags: expertTags.map(t => t.tag),
          specialties: expertSpecialties.map(s => s.specialty),
        } : null,
        broker: o.b_name ? {
          id: o.b_side_id,
          name: o.b_name,
          email: o.b_email,
          phone: o.b_phone,
          city: o.b_city,
        } : null,
      }
    }),
  })
})

// B-side order hall: shows anonymized, unassigned cases.
router.get('/marketplace', authMiddleware, (req: AuthRequest, res) => {
  const currentUser = getCurrentUser(req.userId!)
  if (!currentUser || !['b_side', 'admin'].includes(currentUser.platform_role || '')) {
    res.status(403).json({ error: '仅B端顾问或管理员可访问工单大厅' })
    return
  }

  const orders = db.prepare(`
    SELECT o.id, o.case_status, o.cooperation_type, o.urgency, o.need_type, o.products,
           o.premium, o.created_at,
           c.name as customer_name, c.age as customer_age, c.city as customer_city, c.gender as customer_gender,
           c.family as customer_family, c.children as customer_children, c.job as customer_job,
           c.income as customer_income, c.assets as customer_assets
    FROM orders o
    JOIN customers c ON o.customer_id = c.id
    WHERE o.b_side_id IS NULL
      AND COALESCE(o.case_status, '已提交') = '已提交'
    ORDER BY
      CASE o.urgency WHEN '紧急' THEN 0 WHEN '高' THEN 1 ELSE 2 END,
      o.created_at ASC
  `).all() as Array<Record<string, string | null>>

  const list = orders.map((order) => {
    const rawName = order.customer_name || ''
    let maskedName = '客户'
    if (rawName) {
      const genderHint = order.customer_gender === '女' || order.customer_gender === 'female' ? '女士' : '先生'
      maskedName = rawName.charAt(0) + genderHint
    }
    return {
      id: order.id,
      status: order.case_status || '已提交',
      cooperationType: order.cooperation_type || 'tier_50',
      urgency: order.urgency || '普通',
      needType: order.need_type,
      products: order.products,
      premium: order.premium,
      createdAt: order.created_at,
      customerName: maskedName,
      customer: {
        ageRange: order.customer_age ? `${order.customer_age}岁` : '年龄待补充',
        city: order.customer_city,
        gender: order.customer_gender,
        family: order.customer_family,
        children: order.customer_children,
        job: order.customer_job,
        income: order.customer_income,
        assets: order.customer_assets,
      },
    }
  })

  res.json({ list })
})


// Order submission rate limiting (10 per hour per A-side)
const orderRateLimit = new Map<string, { count: number; windowStart: number }>()

function checkOrderRateLimit(userId: string): boolean {
  const now = Date.now()
  const windowMs = 60 * 60 * 1000 // 1 hour
  const maxOrders = 10

  const record = orderRateLimit.get(userId)
  if (!record || now - record.windowStart > windowMs) {
    orderRateLimit.set(userId, { count: 1, windowStart: now })
    return true
  }

  if (record.count >= maxOrders) return false
  record.count++
  return true
}

// Create order
router.post('/', authMiddleware, (req: AuthRequest, res) => {
  const { customerId, needType, products, premium, cooperationType, urgency, consentConfirmed } = req.body
  const userId = req.userId!

  if (!checkOrderRateLimit(userId)) {
    res.status(429).json({ error: '每小时最多提交 10 个工单，请稍后再试' })
    return
  }

  if (!consentConfirmed) {
    res.status(400).json({ error: '提交工单前必须确认客户已同意转介' })
    return
  }

  const customer = db.prepare('SELECT id, phone FROM customers WHERE id = ? AND user_id = ?').get(customerId, userId) as
    { id: string; phone: string | null } | undefined
  if (!customer) {
    res.status(404).json({ error: '客户不存在' })
    return
  }

  const id = `ORD-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`

  const result = db.transaction(() => {
    if (customer.phone) {
      const phoneHash = clientPhoneHash(customer.phone)
      const existingLock = db.prepare(`
        SELECT a_side_id, locked_until FROM client_locks
        WHERE client_phone_hash = ? AND datetime(locked_until) > datetime('now')
      `).get(phoneHash) as { a_side_id: string; locked_until: string } | undefined

      if (existingLock && existingLock.a_side_id !== userId) {
        return { status: 409, error: '该客户手机号已被其他推荐人锁定，保护期内不能重复提交' }
      }
    }

    db.prepare(`
      INSERT INTO orders (
        id, user_id, customer_id, expert_id, b_side_id, status, case_status,
        premium, need_type, products, cooperation_type, urgency, consent_confirmed_at
      )
      VALUES (?, ?, ?, NULL, NULL, '待匹配', '已提交', ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      customerId,
      premium || null,
      needType || null,
      products || null,
      cooperationType || 'tier_50',
      urgency || '普通',
      new Date().toISOString(),
    )

    if (customer.phone) {
      const phoneHash = clientPhoneHash(customer.phone)
      db.prepare(`
        INSERT INTO client_locks (client_phone_hash, a_side_id, order_id, locked_until)
        VALUES (?, ?, ?, datetime('now', '+6 months'))
        ON CONFLICT(client_phone_hash) DO UPDATE SET
          a_side_id = excluded.a_side_id,
          order_id = excluded.order_id,
          locked_until = excluded.locked_until
      `).run(phoneHash, userId, id)
    }

    return { status: 200 }
  })()

  if (result.status !== 200) {
    res.status(result.status).json({ error: result.error })
    return
  }

  // Add timeline entry
  db.prepare(`
    INSERT INTO order_timeline (order_id, title, detail, color)
    VALUES (?, '工单已提交', '由A端推荐人创建，等待B端顾问接单', 'blue')
  `).run(id)

  db.prepare(`
    INSERT INTO case_status_history (order_id, old_status, new_status, changed_by)
    VALUES (?, NULL, '已提交', ?)
  `).run(id, userId)

  // Update customer status
  db.prepare("UPDATE customers SET status = '跟进中' WHERE id = ?").run(customerId)

  // Create notification
  db.prepare(`
    INSERT INTO notifications (user_id, type, title, content, related_id)
    VALUES (?, 'order', '新工单已创建', ?, ?)
  `).run(userId, `客户工单 ${id} 已成功创建`, id)

  res.json({ id })
})

// B-side atomic claim.
router.post('/:id/claim', authMiddleware, (req: AuthRequest, res) => {
  const currentUser = getCurrentUser(req.userId!)
  if (!currentUser || !['b_side', 'admin'].includes(currentUser.platform_role || '')) {
    res.status(403).json({ error: '仅B端顾问或管理员可接单' })
    return
  }

  const orderId = req.params.id as string
  const result = db.transaction(() => {
    const order = db.prepare('SELECT id, b_side_id, case_status, user_id FROM orders WHERE id = ?').get(orderId) as
      { id: string; b_side_id: string | null; case_status: string | null; user_id: string } | undefined

    if (!order) return { status: 404, error: '工单不存在' }
    if (order.b_side_id) return { status: 409, error: '工单已被其他顾问接单' }
    if ((order.case_status || '已提交') !== '已提交') return { status: 409, error: '当前状态不可接单' }

    const now = new Date().toISOString()
    const update = db.prepare(`
      UPDATE orders
      SET b_side_id = ?, case_status = '已分配顾问', status = '已匹配', assigned_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND b_side_id IS NULL
    `).run(req.userId!, now, orderId)

    if (update.changes !== 1) return { status: 409, error: '工单已被其他顾问接单' }

    db.prepare(`
      INSERT INTO order_timeline (order_id, title, detail, color)
      VALUES (?, 'B端顾问已接单', ?, 'blue')
    `).run(orderId, `${currentUser.name} 已接单，将先联系A端推荐人对齐案情`)

    db.prepare(`
      INSERT INTO case_status_history (order_id, old_status, new_status, changed_by)
      VALUES (?, ?, '已分配顾问', ?)
    `).run(orderId, order.case_status || '已提交', req.userId!)

    db.prepare(`
      INSERT INTO notifications (user_id, type, title, content, related_id)
      VALUES (?, 'order', '工单已被顾问接单', ?, ?)
    `).run(order.user_id, `B端顾问 ${currentUser.name} 已接单，会先与你对齐案情。`, orderId)

    return { status: 200 }
  })()

  if (result.status !== 200) {
    res.status(result.status).json({ error: result.error })
    return
  }

  res.json({ success: true, order: buildOrderDetail(orderId, req.userId!) })
})

// Get order detail
router.get('/:id', authMiddleware, (req: AuthRequest, res) => {
  const currentUser = getCurrentUser(req.userId!)
  const order = buildOrderDetail(req.params.id as string, currentUser?.platform_role === 'admin' ? undefined : req.userId!)
  if (!order) {
    res.status(404).json({ error: '工单不存在' })
    return
  }
  res.json(order)
})

// Update order status
router.put('/:id/status', authMiddleware, (req: AuthRequest, res) => {
  const { status } = req.body
  const orderId = req.params.id as string

  if (!CASE_STATUSES.includes(status)) {
    res.status(400).json({ error: '工单状态不合法' })
    return
  }

  const currentUser = getCurrentUser(req.userId!)
  const isAdmin = currentUser?.platform_role === 'admin'

  const order = db.prepare(`
    SELECT id, user_id, b_side_id, case_status
    FROM orders
    WHERE id = ?
      AND (? = 1 OR user_id = ? OR b_side_id = ?)
  `).get(orderId, isAdmin ? 1 : 0, req.userId!, req.userId!) as
    { id: string; user_id: string; b_side_id: string | null; case_status: string | null } | undefined
  if (!order) {
    res.status(404).json({ error: '工单不存在' })
    return
  }

  if (currentUser?.platform_role === 'a_side' && status !== '客户暂时搁置') {
    res.status(403).json({ error: 'A端只能查看进度，不能推进核心状态' })
    return
  }

  const legacyStatusMap: Record<string, string> = {
    '已提交': '待匹配',
    '已分配顾问': '已匹配',
    '会议已安排': '对接中',
    '沟通中': '已联系',
    '客户有顾虑': '需关注',
    '客户暂时搁置': '需关注',
    '客户不感兴趣': '已取消',
    '申请已提交': '签单中',
    '核保中': '签单中',
    '需要体检': '签单中',
    '保单已批准': '已完成',
    '佣金已结算': '已完成',
  }
  const nextLegacyStatus = legacyStatusMap[status] || '跟进中'

  db.prepare('UPDATE orders SET case_status = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, nextLegacyStatus, orderId)

  // Add timeline entry
  const titleMap: Record<string, string> = {
    '已提交': '工单已提交',
    '已分配顾问': 'B端顾问已接单',
    '会议已安排': '会议已安排',
    '沟通中': '客户沟通中',
    '客户有顾虑': '客户有顾虑',
    '客户暂时搁置': '客户暂时搁置',
    '客户不感兴趣': '客户不感兴趣',
    '申请已提交': '申请已提交',
    '核保中': '核保中',
    '需要体检': '需要体检',
    '保单已批准': '保单已批准',
    '佣金已结算': '佣金已结算',
  }

  db.prepare(`
    INSERT INTO order_timeline (order_id, title, detail, color)
    VALUES (?, ?, ?, 'green')
  `).run(orderId, titleMap[status] || status, `工单状态更新为：${status}`)

  db.prepare(`
    INSERT INTO case_status_history (order_id, old_status, new_status, changed_by)
    VALUES (?, ?, ?, ?)
  `).run(orderId, order.case_status || '已提交', status, req.userId!)

  if (status === '佣金已结算') {
    createCommissionsIfSettled(orderId)
  }

  const updatedOrder = buildOrderDetail(orderId, isAdmin ? undefined : req.userId!)
  res.json({ success: true, order: updatedOrder })
})

// Delete order (A-side only, before B claims)
router.delete('/:id', authMiddleware, (req: AuthRequest, res) => {
  const currentUser = getCurrentUser(req.userId!)
  const orderId = req.params.id as string

  const order = db.prepare(`
    SELECT id, user_id, b_side_id, case_status
    FROM orders WHERE id = ?
  `).get(orderId) as
    { id: string; user_id: string; b_side_id: string | null; case_status: string | null } | undefined

  if (!order) {
    res.status(404).json({ error: '工单不存在' })
    return
  }

  if (order.user_id !== req.userId! && currentUser?.platform_role !== 'admin') {
    res.status(403).json({ error: '无权删除此工单' })
    return
  }

  if (order.b_side_id) {
    res.status(409).json({ error: '工单已被顾问接单，无法删除' })
    return
  }

  db.prepare('DELETE FROM order_timeline WHERE order_id = ?').run(orderId)
  db.prepare('DELETE FROM case_status_history WHERE order_id = ?').run(orderId)
  db.prepare('DELETE FROM case_notes WHERE order_id = ?').run(orderId)
  db.prepare('DELETE FROM client_locks WHERE order_id = ?').run(orderId)
  db.prepare('DELETE FROM commissions WHERE order_id = ?').run(orderId)
  db.prepare('DELETE FROM orders WHERE id = ?').run(orderId)

  res.json({ success: true })
})


export { buildOrderDetail }
export default router
