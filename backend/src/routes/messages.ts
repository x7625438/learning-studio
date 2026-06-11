import { Router } from 'express'
import { db } from '../db.js'
import { authMiddleware, type AuthRequest } from '../auth.js'

const router = Router()

function getInteractionStatus({
  orderStatus,
  lastSenderId,
  lastTime,
  unreadCount,
  userId,
}: {
  orderStatus?: string | null
  lastSenderId?: string | null
  lastTime?: string | null
  unreadCount?: number
  userId: string
}) {
  if (orderStatus === '佣金已结算') return '已结算'
  if (orderStatus === '保单已批准') return '保单已批准'
  if (orderStatus === '客户有顾虑') return '需关注'
  if (orderStatus === '已提交') return '待接单'
  if (!lastTime) return orderStatus ? '待沟通' : '暂无互动'
  if ((unreadCount ?? 0) > 0) return '对方已回复'
  if (lastSenderId === userId) return '等待对方回复'
  return '待你回复'
}

// Get contacts
router.get('/contacts', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!

  // Get unique contacts with last message
  const contacts = db.prepare(`
    WITH contact_threads AS (
      SELECT
        CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as contact_id,
        MAX(created_at) as last_time
      FROM messages
      WHERE sender_id = ? OR receiver_id = ?
      GROUP BY contact_id
    )
    SELECT
      ct.contact_id,
      ct.last_time,
      (
        SELECT content
        FROM messages
        WHERE (sender_id = ? AND receiver_id = ct.contact_id)
           OR (sender_id = ct.contact_id AND receiver_id = ?)
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ) as last_message,
      (
        SELECT sender_id
        FROM messages
        WHERE (sender_id = ? AND receiver_id = ct.contact_id)
           OR (sender_id = ct.contact_id AND receiver_id = ?)
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ) as last_sender_id,
      (
        SELECT COUNT(*)
        FROM messages
        WHERE sender_id = ct.contact_id
          AND receiver_id = ?
          AND is_read = 0
      ) as unread_count
    FROM contact_threads ct
    ORDER BY ct.last_time DESC
  `).all(userId, userId, userId, userId, userId, userId, userId, userId) as Array<{
    contact_id: string; last_time: string; last_message: string; last_sender_id: string; unread_count: number
  }>

  const result = contacts.map(c => {
    const user = db.prepare('SELECT id, name, role, status FROM users WHERE id = ?').get(c.contact_id) as {
      id: string; name: string; role: string; status: string
    } | undefined

    // Find associated order
    const order = db.prepare(`
      SELECT o.id, c.name as customer_name, c.need as customer_need, COALESCE(o.case_status, o.status) as status
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE (o.user_id = ? AND o.b_side_id = ?)
         OR (o.b_side_id = ? AND o.user_id = ?)
      ORDER BY o.created_at DESC
      LIMIT 1
    `).get(userId, c.contact_id, userId, c.contact_id) as { id: string; customer_name: string; customer_need: string | null; status: string } | undefined

    return {
      id: user?.id || c.contact_id,
      name: user?.name || '未知用户',
      role: user?.role || '介绍人',
      lastMessage: c.last_message,
      lastTime: c.last_time,
      unreadCount: c.unread_count,
      order: order ? {
        id: order.id,
        customerName: order.customer_name,
        status: order.status,
        interactionStatus: getInteractionStatus({
          orderStatus: order.status,
          lastSenderId: c.last_sender_id,
          lastTime: c.last_time,
          unreadCount: c.unread_count,
          userId,
        }),
        summary: order.customer_need,
      } : null,
    }
  })

  const contactIds = new Set(result.map((item) => item.id))
  const orderContacts = db.prepare(`
    SELECT o.id as order_id, COALESCE(o.case_status, o.status) as status,
           CASE WHEN o.user_id = ? THEN b.id ELSE a.id END as contact_id,
           CASE WHEN o.user_id = ? THEN b.name ELSE a.name END as contact_name,
           CASE WHEN o.user_id = ? THEN 'B端顾问' ELSE 'A端推荐人' END as contact_role,
           c.name as customer_name, c.need as customer_need
    FROM orders o
    JOIN users a ON o.user_id = a.id
    JOIN users b ON o.b_side_id = b.id
    JOIN customers c ON o.customer_id = c.id
    WHERE (o.user_id = ? OR o.b_side_id = ?)
      AND o.b_side_id IS NOT NULL
    ORDER BY o.created_at DESC
  `).all(userId, userId, userId, userId, userId) as Array<{
    order_id: string; status: string; contact_id: string; contact_name: string; contact_role: string;
    customer_name: string; customer_need: string | null
  }>

  for (const item of orderContacts) {
    const contactId = item.contact_id
    if (!contactId || contactIds.has(contactId)) continue

    contactIds.add(contactId)
    result.push({
      id: contactId,
      name: item.contact_name,
      role: item.contact_role,
      lastMessage: '工单已接单，等待双方沟通',
      lastTime: '',
      unreadCount: 0,
      order: {
        id: item.order_id,
        customerName: item.customer_name,
        status: item.status,
        interactionStatus: getInteractionStatus({
          orderStatus: item.status,
          userId,
        }),
        summary: item.customer_need,
      },
    })
  }

  res.json({ contacts: result })
})

// Get messages with a contact
router.get('/:contactId', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!
  const contactId = req.params.contactId as string

  const messages = db.prepare(`
    SELECT * FROM messages
    WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
    ORDER BY created_at ASC
  `).all(userId, contactId, contactId, userId) as Array<{
    id: number; sender_id: string; receiver_id: string; content: string; created_at: string
  }>

  const contact = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(contactId) as {
    id: string; name: string; role: string
  } | undefined

  // Mark as read
  db.prepare('UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?').run(contactId, userId)

  res.json({
    contact: contact || { id: contactId, name: '未知用户', role: '介绍人' },
    messages: messages.map(m => ({
      id: m.id,
      from: m.sender_id === userId ? 'me' : 'expert',
      text: m.content,
      time: new Date(m.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
    })),
  })
})

// Send message
router.post('/', authMiddleware, (req: AuthRequest, res) => {
  const { receiverId, content, orderId } = req.body
  const userId = req.userId!

  if (!receiverId || !content) {
    res.status(400).json({ error: '接收者和内容必填' })
    return
  }

  db.prepare(`
    INSERT INTO messages (sender_id, receiver_id, order_id, content)
    VALUES (?, ?, ?, ?)
  `).run(userId, receiverId, orderId || null, content)

  // Create notification for receiver
  const sender = db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as { name: string } | undefined
  db.prepare(`
    INSERT INTO notifications (user_id, type, title, content)
    VALUES (?, 'message', '新的对话消息', ?)
  `).run(receiverId, `${sender?.name || '用户'} 发来一条新消息`)

  res.json({ success: true })
})

export default router
