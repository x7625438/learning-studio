import { Router } from 'express'
import { db } from '../db.js'
import { authMiddleware, type AuthRequest } from '../auth.js'

const router = Router()

// Get profile
router.get('/profile', authMiddleware, (req: AuthRequest, res) => {
  const user = db.prepare(`
    SELECT id, email, name, phone, city, career, client_type, role, platform_role, a_side_type,
           override_rate, profession, insurance_holdings, insurance_coverage_range,
           awareness_level, is_licensed, status, avatar, invite_code
    FROM users WHERE id = ?
  `).get(req.userId!) as {
    id: string; email: string; name: string; phone: string | null; city: string | null; career: string | null;
    client_type: string | null; role: string; platform_role: string | null; a_side_type: string | null;
    override_rate: number | null; profession: string | null; insurance_holdings: string | null;
    insurance_coverage_range: string | null; awareness_level: string | null; is_licensed: number | null;
    status: string; avatar: string | null; invite_code: string
  } | undefined

  if (!user) {
    res.status(404).json({ error: '用户不存在' })
    return
  }

  const certifications = db.prepare('SELECT id, name FROM user_certifications WHERE user_id = ?').all(req.userId!) as Array<{ id: number; name: string }>

  const settings = db.prepare('SELECT * FROM notification_settings WHERE user_id = ?').get(req.userId!) as {
    match_success: number; expert_feedback: number; payout_received: number; platform_announcement: number
  } | undefined

  const inviteCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE invited_by = ?').get(req.userId!) as { count: number }

  res.json({
    user: {
      ...user,
      clientType: user.client_type,
      platformRole: user.platform_role || 'a_side',
      aSideType: user.a_side_type || 'regular_a',
      overrideRate: user.override_rate ?? 250,
      insuranceHoldings: user.insurance_holdings,
      insuranceCoverageRange: user.insurance_coverage_range,
      awarenessLevel: user.awareness_level,
      isLicensed: !!user.is_licensed,
      inviteCode: user.invite_code,
    },
    certifications: certifications.map(c => c.name),
    settings: settings ? {
      matchSuccess: !!settings.match_success,
      expertFeedback: !!settings.expert_feedback,
      payoutReceived: !!settings.payout_received,
      platformAnnouncement: !!settings.platform_announcement,
    } : null,
    inviteCount: inviteCount.count,
  })
})

// Update profile
router.put('/profile', authMiddleware, (req: AuthRequest, res) => {
  const { name, phone, city, career, clientType } = req.body

  db.prepare(`
    UPDATE users SET name = ?, phone = ?, city = ?, career = ?, client_type = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(name, phone, city, career, clientType, req.userId!)

  res.json({ success: true })
})

// Update current user's role. In production this can be guarded by an approval workflow;
// for this self-serve platform it lets a referrer upgrade into partner mode immediately.
router.put('/role', authMiddleware, (req: AuthRequest, res) => {
  const { role } = req.body as { role?: string }

  if (role !== '介绍人' && role !== '合伙人') {
    res.status(400).json({ error: '角色不合法' })
    return
  }

  const aSideType = role === '合伙人' ? 'big_a' : 'regular_a'
  const overrideRate = role === '合伙人' ? 270 : 250
  db.prepare(`
    UPDATE users
    SET role = ?, platform_role = 'a_side', a_side_type = ?, override_rate = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(role, aSideType, overrideRate, req.userId!)
  res.json({ success: true, role, platformRole: 'a_side', aSideType, overrideRate })
})

// Admin-only platform role management. End users cannot self-promote into B/Admin.
router.put('/platform-role', authMiddleware, (req: AuthRequest, res) => {
  const { userId, platformRole } = req.body as { userId?: string; platformRole?: string }
  if (!platformRole || !['a_side', 'b_side', 'admin'].includes(platformRole)) {
    res.status(400).json({ error: '平台角色不合法' })
    return
  }
  if (!userId) {
    res.status(400).json({ error: '缺少目标用户' })
    return
  }

  const currentUser = db.prepare('SELECT platform_role FROM users WHERE id = ?').get(req.userId!) as
    { platform_role: string | null } | undefined
  if (currentUser?.platform_role !== 'admin') {
    res.status(403).json({ error: '只有 Admin 可以调整平台角色' })
    return
  }

  const result = db.prepare('UPDATE users SET platform_role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(platformRole, userId)
  if (result.changes === 0) {
    res.status(404).json({ error: '目标用户不存在' })
    return
  }
  res.json({ success: true, userId, platformRole })
})

// Add certification
router.post('/certifications', authMiddleware, (req: AuthRequest, res) => {
  const { name } = req.body
  db.prepare('INSERT INTO user_certifications (user_id, name) VALUES (?, ?)').run(req.userId!, name)
  res.json({ success: true })
})

// Remove certification
router.delete('/certifications/:id', authMiddleware, (req: AuthRequest, res) => {
  db.prepare('DELETE FROM user_certifications WHERE id = ? AND user_id = ?').run(req.params.id as string, req.userId!)
  res.json({ success: true })
})

// Get notification settings
router.get('/settings/notifications', authMiddleware, (req: AuthRequest, res) => {
  const settings = db.prepare('SELECT * FROM notification_settings WHERE user_id = ?').get(req.userId!) as {
    match_success: number; expert_feedback: number; payout_received: number; platform_announcement: number
  } | undefined

  if (!settings) {
    db.prepare('INSERT INTO notification_settings (user_id) VALUES (?)').run(req.userId!)
    res.json({
      matchSuccess: true,
      expertFeedback: true,
      payoutReceived: true,
      platformAnnouncement: false,
    })
    return
  }

  res.json({
    matchSuccess: !!settings.match_success,
    expertFeedback: !!settings.expert_feedback,
    payoutReceived: !!settings.payout_received,
    platformAnnouncement: !!settings.platform_announcement,
  })
})

// Update notification settings
router.put('/settings/notifications', authMiddleware, (req: AuthRequest, res) => {
  const { matchSuccess, expertFeedback, payoutReceived, platformAnnouncement } = req.body

  db.prepare(`
    INSERT INTO notification_settings (user_id, match_success, expert_feedback, payout_received, platform_announcement)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      match_success = excluded.match_success,
      expert_feedback = excluded.expert_feedback,
      payout_received = excluded.payout_received,
      platform_announcement = excluded.platform_announcement,
      updated_at = CURRENT_TIMESTAMP
  `).run(req.userId!, matchSuccess ? 1 : 0, expertFeedback ? 1 : 0, payoutReceived ? 1 : 0, platformAnnouncement ? 1 : 0)

  res.json({ success: true })
})

// Get invite info
router.get('/invite', authMiddleware, (req: AuthRequest, res) => {
  const user = db.prepare('SELECT invite_code, name FROM users WHERE id = ?').get(req.userId!) as { invite_code: string; name: string } | undefined
  const inviteCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE invited_by = ?').get(req.userId!) as { count: number }
  const origin = req.get('origin')
  const host = req.get('host')
  const requestBaseUrl = host ? `${req.protocol}://${host}` : 'http://localhost:5175'
  const appUrl = process.env.PUBLIC_APP_URL || origin || requestBaseUrl
  const inviteCode = user?.invite_code ?? ''

  res.json({
    inviteCode,
    inviteCount: inviteCount.count,
    inviterName: user?.name ?? '',
    inviteUrl: `${appUrl.replace(/\/$/, '')}/login?inviteCode=${encodeURIComponent(inviteCode)}`,
  })
})

export default router
