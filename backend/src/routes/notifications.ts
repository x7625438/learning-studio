import { Router } from 'express'
import { db } from '../db.js'
import { authMiddleware, type AuthRequest } from '../auth.js'

const router = Router()

// List notifications
router.get('/', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!
  const { unreadOnly } = req.query as { unreadOnly?: string }

  let sql = 'SELECT * FROM notifications WHERE user_id = ?'
  const params: (string | number)[] = [userId]

  if (unreadOnly === 'true') {
    sql += ' AND is_read = 0'
  }

  sql += ' ORDER BY created_at DESC LIMIT 20'

  const notifications = db.prepare(sql).all(...params) as Array<{
    id: number; type: string; title: string; content: string | null; is_read: number; related_id: string | null; created_at: string
  }>

  const unreadCount = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0').get(userId) as { count: number }

  res.json({
    list: notifications.map(n => ({
      id: n.id,
      type: n.type,
      title: n.title,
      content: n.content,
      isRead: !!n.is_read,
      relatedId: n.related_id,
      time: n.created_at,
    })),
    unreadCount: unreadCount.count,
  })
})

// Mark all as read
router.put('/read-all', authMiddleware, (req: AuthRequest, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.userId!)
  res.json({ success: true })
})

// Mark as read
router.put('/:id/read', authMiddleware, (req: AuthRequest, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id as string, req.userId!)
  res.json({ success: true })
})

export default router
