import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db.js'
import { authMiddleware, type AuthRequest } from '../auth.js'

const router = Router()

// List customers
router.get('/', authMiddleware, (req: AuthRequest, res) => {
  const { status, search } = req.query as { status?: string; search?: string }
  const userId = req.userId!

  let sql = 'SELECT * FROM customers WHERE user_id = ?'
  const params: (string | undefined)[] = [userId]

  if (status && status !== '全部') {
    sql += ' AND status = ?'
    params.push(status)
  }

  if (search) {
    sql += ' AND (name LIKE ? OR need LIKE ? OR city LIKE ?)'
    const like = `%${search}%`
    params.push(like, like, like)
  }

  sql += ' ORDER BY created_at DESC'

  const customers = db.prepare(sql).all(...params) as Array<{
    id: string; name: string; need: string | null; age: string | null; city: string | null;
    gender: string | null; family: string | null; children: string | null; job: string | null;
    phone: string | null;
    income: string | null; assets: string | null; products: string | null; budget: string | null;
    supplement: string | null; return_value: string | null; status: string; created_at: string
  }>

  // Stats
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = '跟进中' THEN 1 ELSE 0 END) as following,
      SUM(CASE WHEN status = '已匹配' THEN 1 ELSE 0 END) as submitted,
      SUM(CASE WHEN strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now') THEN 1 ELSE 0 END) as monthly
    FROM customers WHERE user_id = ?
  `).get(userId) as { total: number; following: number; submitted: number; monthly: number }

  res.json({
    list: customers.map(c => ({ ...c, returnValue: c.return_value })),
    stats: {
      total: stats.total,
      following: stats.following || 0,
      submitted: stats.submitted || 0,
      monthly: stats.monthly || 0,
    },
  })
})

// Create customer
router.post('/', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!
  const {
    name, need, age, city, gender, family, children, job,
    phone, income, assets, products, budget, supplement, returnValue,
  } = req.body

  const id = uuidv4()
  db.prepare(`
    INSERT INTO customers (id, user_id, name, phone, need, age, city, gender, family, children, job, income, assets, products, budget, supplement, return_value)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, name, phone || null, need || null, age || null, city || null, gender || null, family || null,
    children || null, job || null, income || null, assets || null, products || null, budget || null,
    supplement || null, returnValue || null)

  res.json({ id })
})

// Get customer detail
router.get('/:id', authMiddleware, (req: AuthRequest, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND user_id = ?').get(req.params.id as string, req.userId!) as
    Record<string, string | null> | undefined

  if (!customer) {
    res.status(404).json({ error: '客户不存在' })
    return
  }

  res.json({
    ...customer,
    returnValue: customer.return_value,
  })
})

// Update customer
router.put('/:id', authMiddleware, (req: AuthRequest, res) => {
  const {
    name, need, age, city, gender, family, children, job,
    phone, income, assets, products, budget, supplement, returnValue, status,
  } = req.body

  const customer = db.prepare('SELECT id FROM customers WHERE id = ? AND user_id = ?').get(req.params.id as string, req.userId!) as { id: string } | undefined
  if (!customer) {
    res.status(404).json({ error: '客户不存在' })
    return
  }

  db.prepare(`
    UPDATE customers SET
      name = ?, phone = ?, need = ?, age = ?, city = ?, gender = ?, family = ?, children = ?,
      job = ?, income = ?, assets = ?, products = ?, budget = ?, supplement = ?,
      return_value = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(name, phone || null, need || null, age || null, city || null, gender || null, family || null,
    children || null, job || null, income || null, assets || null, products || null,
    budget || null, supplement || null, returnValue || null, status || '待处理',
    req.params.id as string, req.userId!)

  res.json({ success: true })
})

// Delete customer
router.delete('/:id', authMiddleware, (req: AuthRequest, res) => {
  db.prepare('DELETE FROM customers WHERE id = ? AND user_id = ?').run(req.params.id as string, req.userId!)
  res.json({ success: true })
})

export default router
