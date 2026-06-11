import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { db, initDatabase } from './db.js'
import authRoutes from './routes/auth.js'
import userRoutes from './routes/users.js'
import customerRoutes from './routes/customers.js'
import orderRoutes from './routes/orders.js'
import expertRoutes from './routes/experts.js'
import messageRoutes from './routes/messages.js'
import notificationRoutes from './routes/notifications.js'
import teamRoutes from './routes/team.js'
import aiRoutes from './routes/ai.js'
import dashboardRoutes from './routes/dashboard.js'
import adminRoutes from './routes/admin.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3001

// Initialize database
initDatabase()

// Middleware
app.use(helmet())
app.use(cors({
  origin: ['http://localhost:5175', 'http://127.0.0.1:5175', 'http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
}))
app.use(express.json({ limit: '10mb' }))

// Rate limiting
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: '请求过于频繁，请稍后再试' },
}))

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/customers', customerRoutes)
app.use('/api/orders', orderRoutes)
app.use('/api/experts', expertRoutes)
app.use('/api/messages', messageRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/team', teamRoutes)
app.use('/api/ai', aiRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/admin', adminRoutes)

// Serve frontend static files in production
const frontendDist = join(__dirname, '../../dist')
app.use(express.static(frontendDist))
app.get('*', (_req, res) => {
  res.sendFile(join(frontendDist, 'index.html'))
})

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack)
  res.status(500).json({ error: '服务器内部错误' })
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`API base: http://localhost:${PORT}/api`)
})

export default app
