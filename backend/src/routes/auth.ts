import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db.js'
import { hashPassword, comparePassword, generateToken, authMiddleware, type AuthRequest, isAccountLocked, recordFailedLogin, clearLoginAttempts } from '../auth.js'

const router = Router()

// Register
router.post('/register', (req, res) => {
  const { email, password, name, phone, city, profession, insuranceHoldings, insuranceCoverageRange, awarenessLevel, isLicensed, platformRole, aSideType, inviteCode } = req.body

  if (!email || !password || !name) {
    res.status(400).json({ error: '邮箱、密码和姓名必填' })
    return
  }

  if (password.length < 8) {
    res.status(400).json({ error: '密码至少需要8位' })
    return
  }

  // Validate platform role
  if (!platformRole || !['a_side', 'b_side'].includes(platformRole)) {
    res.status(400).json({ error: '请选择注册角色类型（A端或B端）' })
    return
  }

  // Validate A-side type if A端
  let finalASideType: string = aSideType || 'regular_a'
  if (platformRole === 'a_side') {
    if (!aSideType || !['regular_a', 'small_a', 'big_a'].includes(aSideType)) {
      res.status(400).json({ error: '请选择A端类型（大A、小A或普通A）' })
      return
    }
    finalASideType = aSideType
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (existing) {
    res.status(409).json({ error: '该邮箱已被注册' })
    return
  }

  const id = uuidv4()
  const passwordHash = hashPassword(password)
  const inviteCodeNew = `INV${Date.now().toString(36).toUpperCase()}`

  // Check invite code
  let invitedBy: string | null = null
  let parentId: string | null = null
  let referredBy: string | null = null

  if (inviteCode) {
    const inviter = db.prepare('SELECT id, a_side_type FROM users WHERE invite_code = ?').get(inviteCode) as { id: string; a_side_type: string | null } | undefined
    if (inviter) {
      invitedBy = inviter.id
      // 如果邀请人是大A，被邀请人强制为小A
      if (inviter.a_side_type === 'big_a') {
        finalASideType = 'small_a'
        parentId = inviter.id
      } else {
        // 平级推荐
        referredBy = inviter.id
      }
    }
  }

  // Determine role and override rate
  const isA = platformRole === 'a_side'
  const isBigA = isA && finalASideType === 'big_a'
  const role = isBigA || !isA ? '合伙人' : '介绍人'
  const overrideRate = isBigA ? 270 : 250

  const createUser = db.transaction(() => {
    db.prepare(`
      INSERT INTO users (
        id, email, password_hash, name, phone, city, career, client_type,
        invite_code, invited_by, platform_role, a_side_type, parent_id, referred_by, override_rate,
        profession, insurance_holdings, insurance_coverage_range, awareness_level, is_licensed
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, email, passwordHash, name, phone || null, city || null, profession || null, null,
      inviteCodeNew, invitedBy, platformRole, finalASideType, parentId, referredBy, overrideRate,
      profession || null, insuranceHoldings || null, insuranceCoverageRange || null, awarenessLevel || null, isLicensed ? 1 : 0,
    )

    db.prepare('INSERT INTO notification_settings (user_id) VALUES (?)').run(id)

    const welcomeMsg = platformRole === 'b_side'
      ? '您已成功注册为B端顾问，开始接单吧！'
      : '您已成功注册，开始介绍您的第一位客户吧！'
    db.prepare(`
      INSERT INTO notifications (user_id, type, title, content)
      VALUES (?, 'system', '欢迎使用保险智能获客平台', ?)
    `).run(id, welcomeMsg)

    if (invitedBy) {
      db.prepare(`
        INSERT OR IGNORE INTO team_members (leader_id, member_id, join_date)
        VALUES (?, ?, date('now'))
      `).run(invitedBy, id)

      db.prepare(`
        INSERT INTO notifications (user_id, type, title, content, related_id)
        VALUES (?, 'team', '新成员加入团队', ?, ?)
      `).run(invitedBy, `${name} 已通过你的邀请链接加入团队。`, id)
    }
  })

  createUser()

  const token = generateToken(id)
  res.json({
    token,
    user: {
      id,
      email,
      name,
      role,
      platformRole,
      aSideType: finalASideType,
      status: '新人',
    },
  })
})

// Login
router.post('/login', (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    res.status(400).json({ error: '邮箱和密码必填' })
    return
  }

  // Check if account is locked
  if (isAccountLocked(email)) {
    res.status(429).json({ error: '账户已被临时锁定，请15分钟后再试' })
    return
  }

  const user = db.prepare('SELECT id, email, name, password_hash, role, platform_role, a_side_type, override_rate, status, phone, city, career, client_type, avatar FROM users WHERE email = ?').get(email) as
    { id: string; email: string; name: string; password_hash: string; role: string; platform_role: string | null; a_side_type: string | null; override_rate: number | null; status: string; phone: string | null; city: string | null; career: string | null; client_type: string | null; avatar: string | null } | undefined

  if (!user || !comparePassword(password, user.password_hash)) {
    const { locked, remaining } = recordFailedLogin(email)
    if (locked) {
      res.status(429).json({ error: '登录失败次数过多，账户已被锁定15分钟' })
    } else {
      res.status(401).json({ error: `邮箱或密码错误，还剩 ${remaining} 次尝试机会` })
    }
    return
  }

  // Clear failed attempts on successful login
  clearLoginAttempts(email)

  const token = generateToken(user.id)
  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      platformRole: user.platform_role || 'a_side',
      aSideType: user.a_side_type || 'regular_a',
      overrideRate: user.override_rate ?? 250,
      status: user.status,
      phone: user.phone,
      city: user.city,
      career: user.career,
      clientType: user.client_type,
      avatar: user.avatar,
    },
  })
})

// Get current user
router.get('/me', authMiddleware, (req: AuthRequest, res) => {
  const user = db.prepare(`
    SELECT id, email, name, role, platform_role, a_side_type, override_rate, status, phone, city, career, client_type, avatar
    FROM users WHERE id = ?
  `).get(req.userId!) as { id: string; email: string; name: string; role: string; platform_role: string | null; a_side_type: string | null; override_rate: number | null; status: string; phone: string | null; city: string | null; career: string | null; client_type: string | null; avatar: string | null } | undefined

  if (!user) {
    res.status(404).json({ error: '用户不存在' })
    return
  }

  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      platformRole: user.platform_role || 'a_side',
      aSideType: user.a_side_type || 'regular_a',
      overrideRate: user.override_rate ?? 250,
      status: user.status,
      phone: user.phone,
      city: user.city,
      career: user.career,
      clientType: user.client_type,
      avatar: user.avatar,
    },
  })
})

// Change password
router.put('/password', authMiddleware, (req: AuthRequest, res) => {
  const { oldPassword, newPassword } = req.body

  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.userId!) as { password_hash: string } | undefined
  if (!user || !comparePassword(oldPassword, user.password_hash)) {
    res.status(401).json({ error: '原密码错误' })
    return
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.userId!)
  res.json({ success: true })
})

export default router
