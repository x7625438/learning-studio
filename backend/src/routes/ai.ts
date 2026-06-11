import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { createHash } from 'crypto'
import { db } from '../db.js'
import { authMiddleware, type AuthRequest } from '../auth.js'
import { extractCustomerInfo, chatWithAI } from '../deepseek.js'

const router = Router()

function clientPhoneHash(phone: string) {
  return createHash('sha256').update(phone.replace(/\D/g, '')).digest('hex')
}

function toStorageText(value: unknown): string | null {
  if (value == null) return null
  if (Array.isArray(value)) {
    return value.map(toStorageText).filter(Boolean).join('、') || null
  }
  if (typeof value === 'object') {
    const entries = Object.values(value as Record<string, unknown>)
      .map(toStorageText)
      .filter(Boolean)
    return entries.join('、') || null
  }
  const text = String(value).trim()
  return text || null
}

const EXTRACTION_KEY_ALIASES: Record<string, string> = {
  marital_status: 'family',
  occupation: 'job',
  annual_income: 'income',
  insurable_assets: 'assets',
  insurance_needs: 'need',
  annual_budget: 'budget',
  referral_consent: 'consent',
  refer_to_b_side_advisor: 'consent',
}

function normalizeExtractionForStorage(data: Record<string, unknown>) {
  const normalized: Record<string, string | null> = {}
  for (const [key, value] of Object.entries(data)) {
    const normalizedKey = EXTRACTION_KEY_ALIASES[key] || key
    const text = toStorageText(value)
    if (text && !normalized[normalizedKey]) {
      normalized[normalizedKey] = text
    }
  }
  return normalized
}

// Create conversation
router.post('/conversations', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!
  const id = uuidv4()

  db.prepare(`
    INSERT INTO ai_conversations (id, user_id, title, extracted)
    VALUES (?, ?, '新客户录入', '{}')
  `).run(id, userId)

  // System welcome message
  db.prepare(`
    INSERT INTO conversation_messages (conversation_id, role, content)
    VALUES (?, 'ai', '你好！我来帮你录入客户信息。请描述一下客户的基本情况，比如姓名、年龄、家庭、需求等。')
  `).run(id)

  res.json({ conversationId: id })
})

// AI chat rate limiting (30 messages per user per day)
const chatRateLimit = new Map<string, { count: number; dayStart: number }>()

function checkChatRateLimit(userId: string): boolean {
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  const maxMessages = 30

  const record = chatRateLimit.get(userId)
  if (!record || now - record.dayStart > dayMs) {
    chatRateLimit.set(userId, { count: 1, dayStart: now })
    return true
  }

  if (record.count >= maxMessages) return false
  record.count++
  return true
}

// Send message
router.post('/conversations/:id/messages', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.userId!
  const conversationId = req.params.id as string
  const { text } = req.body

  if (!checkChatRateLimit(userId)) {
    res.status(429).json({ error: '每天最多发送 30 条消息，请明天再试' })
    return
  }

  const conv = db.prepare('SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?').get(conversationId, userId) as
    { id: string; extracted: string | null } | undefined

  if (!conv) {
    res.status(404).json({ error: '会话不存在' })
    return
  }

  // Save user message
  db.prepare(`
    INSERT INTO conversation_messages (conversation_id, role, content)
    VALUES (?, 'user', ?)
  `).run(conversationId, text)

  // Get conversation history
  const messages = db.prepare(`
    SELECT role, content FROM conversation_messages
    WHERE conversation_id = ?
    ORDER BY created_at ASC
  `).all(conversationId) as Array<{ role: string; content: string }>

  // Build history for API (last 10 messages)
  const history = messages.slice(-11, -1).map(m => ({
    role: m.role === 'ai' ? 'assistant' : 'user',
    content: m.content,
  }))

  try {
    const { reply, extracted } = await chatWithAI(history, text)

    // Save AI response
    db.prepare(`
      INSERT INTO conversation_messages (conversation_id, role, content)
      VALUES (?, 'ai', ?)
    `).run(conversationId, reply)

    // Merge with existing extracted data
    let existingExtracted: Record<string, unknown> = {}
    try {
      existingExtracted = conv.extracted ? JSON.parse(conv.extracted) : {}
    } catch {
      existingExtracted = {}
    }

    const merged = normalizeExtractionForStorage({ ...existingExtracted, ...extracted })

    // Update extracted data
    db.prepare(`
      UPDATE ai_conversations SET extracted = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(JSON.stringify(merged), conversationId)

    res.json({ reply, extracted: merged })
  } catch (err) {
    console.error('AI chat error:', err)
    // Fallback: simple extraction + static response
    const extracted = await simpleExtract(text)
    const reply = '已收到你的信息，我先帮你提取了客户资料。如果信息不完整，请继续补充。'

    db.prepare(`
      INSERT INTO conversation_messages (conversation_id, role, content)
      VALUES (?, 'ai', ?)
    `).run(conversationId, reply)

    let existingExtracted: Record<string, unknown> = {}
    try {
      existingExtracted = conv.extracted ? JSON.parse(conv.extracted) : {}
    } catch {
      existingExtracted = {}
    }
    const merged = normalizeExtractionForStorage({ ...existingExtracted, ...extracted })
    db.prepare(`
      UPDATE ai_conversations SET extracted = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(JSON.stringify(merged), conversationId)

    res.json({ reply, extracted: merged })
  }
})

// Get conversation
router.get('/conversations/:id', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!
  const conversationId = req.params.id as string

  const conv = db.prepare('SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?').get(conversationId, userId) as
    { id: string; extracted: string | null; status: string } | undefined

  if (!conv) {
    res.status(404).json({ error: '会话不存在' })
    return
  }

  const messages = db.prepare(`
    SELECT role, content FROM conversation_messages
    WHERE conversation_id = ?
    ORDER BY created_at ASC
  `).all(conversationId) as Array<{ role: string; content: string }>

  let extracted: Record<string, string | null> = {}
  try {
    extracted = conv.extracted ? JSON.parse(conv.extracted) : {}
  } catch {
    extracted = {}
  }

  res.json({
    id: conv.id,
    messages: messages.map(m => ({ from: m.role === 'ai' ? 'ai' : 'user', text: m.content })),
    extracted,
    status: conv.status,
  })
})

// Complete conversation -> create customer + order
router.post('/conversations/:id/complete', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!
  const conversationId = req.params.id as string
  const { customerData } = req.body

  const conv = db.prepare('SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?').get(conversationId, userId) as
    { id: string; extracted: string | null; status: string; customer_id: string | null } | undefined

  if (!conv) {
    res.status(404).json({ error: '会话不存在' })
    return
  }

  if (conv.status === '已完成' && conv.customer_id) {
    const existingOrder = db.prepare('SELECT id FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1').get(conv.customer_id) as
      { id: string } | undefined
    if (existingOrder) {
      res.json({ customerId: conv.customer_id, orderId: existingOrder.id, alreadyCompleted: true })
      return
    }
  }

  const data = normalizeExtractionForStorage(customerData || {})

  if (data.phone) {
    const existingLock = db.prepare(`
      SELECT a_side_id FROM client_locks
      WHERE client_phone_hash = ? AND datetime(locked_until) > datetime('now')
    `).get(clientPhoneHash(String(data.phone))) as { a_side_id: string } | undefined
    if (existingLock && existingLock.a_side_id !== userId) {
      res.status(409).json({ error: '该客户手机号已被其他推荐人锁定，保护期内不能重复提交' })
      return
    }
  }

  // Create customer
  const customerId = uuidv4()
  db.prepare(`
    INSERT INTO customers (id, user_id, name, phone, need, age, city, gender, family, children, job, income, assets, products, budget, supplement, return_value)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    customerId, userId,
    data.name || '未命名客户',
    data.phone || null,
    data.need || null,
    data.age || null,
    data.city || null,
    data.gender || null,
    data.family || null,
    data.children || null,
    data.job || null,
    data.income || null,
    data.assets || null,
    data.products || null,
    data.budget || null,
    data.supplement || null,
    data.returnValue || '$0',
  )

  // Create order
  const orderId = `ORD-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`
  db.prepare(`
    INSERT INTO orders (
      id, user_id, customer_id, expert_id, b_side_id, status, case_status,
      premium, need_type, products, cooperation_type, urgency, consent_confirmed_at
    )
    VALUES (?, ?, ?, NULL, NULL, '待匹配', '已提交', ?, ?, ?, ?, ?, ?)
  `).run(
    orderId,
    userId,
    customerId,
    data.budget || null,
    data.need || null,
    data.products || null,
    data.cooperationType || 'tier_50',
    data.urgency || '普通',
    new Date().toISOString(),
  )

  // Timeline
  db.prepare(`
    INSERT INTO order_timeline (order_id, title, detail, color)
    VALUES (?, '工单已提交', '由A端AI智能录单创建，等待B端顾问接单', 'blue')
  `).run(orderId)

  db.prepare(`
    INSERT INTO case_status_history (order_id, old_status, new_status, changed_by)
    VALUES (?, NULL, '已提交', ?)
  `).run(orderId, userId)

  if (data.phone) {
    db.prepare(`
      INSERT INTO client_locks (client_phone_hash, a_side_id, order_id, locked_until)
      VALUES (?, ?, ?, datetime('now', '+6 months'))
      ON CONFLICT(client_phone_hash) DO UPDATE SET
        a_side_id = excluded.a_side_id,
        order_id = excluded.order_id,
        locked_until = excluded.locked_until
    `).run(clientPhoneHash(String(data.phone)), userId, orderId)
  }

  // Update conversation
  db.prepare(`
    UPDATE ai_conversations SET customer_id = ?, status = '已完成', updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(customerId, conversationId)

  // Notification
  db.prepare(`
    INSERT INTO notifications (user_id, type, title, content, related_id)
    VALUES (?, 'order', '新客户工单已创建', ?, ?)
  `).run(userId, `客户 ${data.name || '未命名'} 的工单已创建`, orderId)

  res.json({ customerId, orderId })
})

// Direct extraction (without conversation)
router.post('/extract', authMiddleware, async (req: AuthRequest, res) => {
  const { text } = req.body

  try {
    const extracted = await extractCustomerInfo(text)
    res.json({ extracted })
  } catch (err) {
    console.error('Extract error:', err)
    const extracted = await simpleExtract(text)
    res.json({ extracted })
  }
})

// Simple extraction fallback (regex-based)
async function simpleExtract(text: string): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {}

  const nameMatch =
    text.match(/客户(?:叫|是)?\s*([一-龥]{1,3}(?:先生|女士)?)/) ||
    text.match(/([一-龥]{1,3}(?:先生|女士))/)
  if (nameMatch) result.name = nameMatch[1].replace(/先生|女士/g, '')

  const ageMatch = text.match(/(\d{1,2})\s*[岁]/)
  if (ageMatch) result.age = `${ageMatch[1]}岁`

  if (text.includes('先生')) result.gender = '男'
  else if (text.includes('女士')) result.gender = '女'

  const cities = ['上海', '北京', '深圳', '广州', '多伦多', '温哥华', '列治文', '密西沙加', '卡尔加里']
  for (const city of cities) {
    if (text.includes(city)) {
      result.city = city
      break
    }
  }

  if (text.includes('家庭') || text.includes('已婚') || text.includes('家人')) {
    result.family = text.includes('已婚') ? '已婚' : '有家庭'
  }

  if (text.includes('孩子') || text.includes('子女')) result.children = '有子女，年龄待确认'

  const jobs = ['工程师', '企业主', '会计师', '教师', '医生', '律师', '经理', '创业者']
  for (const job of jobs) {
    if (text.includes(job)) {
      result.job = job
      break
    }
  }

  const budgetMatch = text.match(/预算.*?([一二三四五六七八九十\d,.]+万?)/)
  if (budgetMatch) result.budget = `年预算 ${budgetMatch[1]}`

  const incomeMatch = text.match(/收入.*?([一二三四五六七八九十\d,.]+万?)/)
  if (incomeMatch) result.income = `${incomeMatch[1]}`

  const assetMatch = text.match(/(?:资产|可投保|投资).*?([一二三四五六七八九十\d,.]+万?)/)
  if (assetMatch) result.assets = `${assetMatch[1]}`

  if (text.includes('重疾')) {
    result.need = '重疾险需求'
    result.products = '重疾险'
  } else if (text.includes('医疗')) {
    result.need = '医疗险需求'
    result.products = '医疗险'
  } else if (text.includes('家庭')) {
    result.need = '家庭综合保障'
    result.products = '家庭保障方案'
  } else if (text.includes('养老')) {
    result.need = '养老规划'
    result.products = '年金险'
  } else if (text.includes('教育')) {
    result.need = '教育金保险'
    result.products = '教育金'
  }

  return result
}

export default router
