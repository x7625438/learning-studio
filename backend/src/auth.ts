import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { Request, Response, NextFunction } from 'express'

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET must be configured in production')
}
const jwtSecret = JWT_SECRET || 'dev-insurance-platform-jwt-secret'
const SALT_ROUNDS = 10

export interface AuthRequest extends Request {
  userId?: string
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, SALT_ROUNDS)
}

export function comparePassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash)
}

// Login rate limiting: 5 failed attempts within 15 minutes locks account
const loginAttempts = new Map<string, { count: number; firstAttempt: number }>()

export function recordFailedLogin(email: string): { locked: boolean; remaining: number } {
  const now = Date.now()
  const windowMs = 15 * 60 * 1000 // 15 minutes
  const maxAttempts = 5

  const record = loginAttempts.get(email)
  if (!record || now - record.firstAttempt > windowMs) {
    loginAttempts.set(email, { count: 1, firstAttempt: now })
    return { locked: false, remaining: maxAttempts - 1 }
  }

  record.count++
  if (record.count >= maxAttempts) {
    return { locked: true, remaining: 0 }
  }

  return { locked: false, remaining: maxAttempts - record.count }
}

export function clearLoginAttempts(email: string) {
  loginAttempts.delete(email)
}

export function isAccountLocked(email: string): boolean {
  const now = Date.now()
  const windowMs = 15 * 60 * 1000
  const maxAttempts = 5

  const record = loginAttempts.get(email)
  if (!record) return false
  if (now - record.firstAttempt > windowMs) {
    loginAttempts.delete(email)
    return false
  }
  return record.count >= maxAttempts
}


export function generateToken(userId: string): string {
  return jwt.sign({ userId }, jwtSecret, { expiresIn: '7d' })
}

export function verifyToken(token: string): { userId: string } {
  return jwt.verify(token, jwtSecret) as { userId: string }
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: '未提供认证令牌' })
    return
  }
  try {
    const token = authHeader.slice(7)
    const decoded = verifyToken(token)
    req.userId = decoded.userId
    next()
  } catch {
    res.status(401).json({ error: '令牌无效或已过期' })
  }
}
