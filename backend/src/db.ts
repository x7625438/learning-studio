import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

const DB_PATH = process.env.DB_PATH || './data/app.db'

// Ensure data directory exists
const dataDir = dirname(DB_PATH)
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true })
}

export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

function ensureColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

// Initialize schema
export function initDatabase() {
  db.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name          TEXT NOT NULL,
      phone         TEXT,
      avatar        TEXT,
      city          TEXT,
      career        TEXT,
      client_type   TEXT,
      role          TEXT NOT NULL DEFAULT '介绍人' CHECK(role IN ('介绍人', '合伙人')),
      status        TEXT NOT NULL DEFAULT '活跃' CHECK(status IN ('活跃', '新人', '禁用')),
      invite_code   TEXT UNIQUE,
      invited_by    TEXT REFERENCES users(id),
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- User certifications
    CREATE TABLE IF NOT EXISTS user_certifications (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Notification settings
    CREATE TABLE IF NOT EXISTS notification_settings (
      user_id               TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      match_success         INTEGER DEFAULT 1,
      expert_feedback       INTEGER DEFAULT 1,
      payout_received       INTEGER DEFAULT 1,
      platform_announcement INTEGER DEFAULT 0,
      updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Customers
    CREATE TABLE IF NOT EXISTS customers (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      need         TEXT,
      age          TEXT,
      city         TEXT,
      gender       TEXT,
      family       TEXT,
      children     TEXT,
      job          TEXT,
      income       TEXT,
      assets       TEXT,
      products     TEXT,
      budget       TEXT,
      supplement   TEXT,
      return_value TEXT,
      status       TEXT DEFAULT '待处理' CHECK(status IN ('待处理', '跟进中', '已匹配', '已完成', '已关闭')),
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Experts
    CREATE TABLE IF NOT EXISTS experts (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      title      TEXT NOT NULL,
      score      REAL DEFAULT 5.0,
      clients    INTEGER DEFAULT 0,
      response   TEXT,
      joined_at  TEXT,
      regions    TEXT,
      bio        TEXT,
      avatar     TEXT,
      status     TEXT DEFAULT '活跃' CHECK(status IN ('活跃', '离线', '休假')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Expert tags
    CREATE TABLE IF NOT EXISTS expert_tags (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      expert_id TEXT NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
      tag       TEXT NOT NULL
    );

    -- Expert specialties
    CREATE TABLE IF NOT EXISTS expert_specialties (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      expert_id TEXT NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
      specialty TEXT NOT NULL
    );

    -- Orders
    CREATE TABLE IF NOT EXISTS orders (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      expert_id   TEXT REFERENCES experts(id),
      status      TEXT NOT NULL DEFAULT '待匹配' CHECK(status IN ('待匹配', '已匹配', '对接中', '已联系', '已面谈', '签单中', '已完成', '需关注', '已取消')),
      premium     TEXT,
      need_type   TEXT,
      products    TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Order timeline
    CREATE TABLE IF NOT EXISTS order_timeline (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      title    TEXT NOT NULL,
      detail   TEXT NOT NULL,
      time     DATETIME DEFAULT CURRENT_TIMESTAMP,
      color    TEXT DEFAULT 'blue' CHECK(color IN ('green', 'blue', 'red', 'gray'))
    );

    -- Messages
    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id   TEXT NOT NULL REFERENCES users(id),
      receiver_id TEXT NOT NULL REFERENCES users(id),
      order_id    TEXT REFERENCES orders(id),
      content     TEXT NOT NULL,
      is_read     INTEGER DEFAULT 0,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Notifications
    CREATE TABLE IF NOT EXISTS notifications (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       TEXT NOT NULL,
      title      TEXT NOT NULL,
      content    TEXT,
      is_read    INTEGER DEFAULT 0,
      related_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Team members (leader -> member relationship)
    CREATE TABLE IF NOT EXISTS team_members (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      leader_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      member_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      join_date    TEXT,
      level        TEXT DEFAULT '初级介绍人',
      contribution TEXT DEFAULT '$0',
      UNIQUE(leader_id, member_id)
    );

    -- Earnings
    CREATE TABLE IF NOT EXISTS earnings (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_id   TEXT REFERENCES orders(id),
      type       TEXT NOT NULL,
      amount     TEXT NOT NULL,
      status     TEXT DEFAULT '待结算' CHECK(status IN ('待结算', '已结算')),
      date       TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- AI conversations
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      customer_id TEXT REFERENCES customers(id),
      title       TEXT,
      extracted   TEXT,
      status      TEXT DEFAULT '进行中' CHECK(status IN ('进行中', '已完成', '已取消')),
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- AI conversation messages
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
      role            TEXT NOT NULL CHECK(role IN ('user', 'ai')),
      content         TEXT NOT NULL,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_customers_user_id ON customers(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
    CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_team_leader ON team_members(leader_id);
    CREATE INDEX IF NOT EXISTS idx_earnings_user ON earnings(user_id);
    CREATE INDEX IF NOT EXISTS idx_conv_messages ON conversation_messages(conversation_id);
  `)

  ensureColumn('users', 'platform_role', "TEXT DEFAULT 'a_side'")
  ensureColumn('users', 'a_side_type', "TEXT DEFAULT 'regular_a'")
  ensureColumn('users', 'parent_id', 'TEXT')
  ensureColumn('users', 'referred_by', 'TEXT')
  ensureColumn('users', 'override_rate', 'REAL DEFAULT 250')
  ensureColumn('users', 'profession', 'TEXT')
  ensureColumn('users', 'insurance_holdings', 'TEXT')
  ensureColumn('users', 'insurance_coverage_range', 'TEXT')
  ensureColumn('users', 'awareness_level', 'TEXT')
  ensureColumn('users', 'is_licensed', 'INTEGER DEFAULT 0')
  ensureColumn('customers', 'phone', 'TEXT')

  ensureColumn('orders', 'b_side_id', 'TEXT')
  ensureColumn('orders', 'case_status', "TEXT DEFAULT '已提交'")
  ensureColumn('orders', 'cooperation_type', "TEXT DEFAULT 'tier_50'")
  ensureColumn('orders', 'urgency', "TEXT DEFAULT '普通'")
  ensureColumn('orders', 'consent_confirmed_at', 'DATETIME')
  ensureColumn('orders', 'assigned_at', 'DATETIME')

  db.exec(`
    CREATE TABLE IF NOT EXISTS case_status_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      old_status  TEXT,
      new_status  TEXT NOT NULL,
      changed_by  TEXT REFERENCES users(id),
      changed_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS case_notes (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id          TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      author_id         TEXT NOT NULL REFERENCES users(id),
      content           TEXT NOT NULL,
      visible_to_a_side INTEGER DEFAULT 0,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS commissions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id   TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES users(id),
      role       TEXT NOT NULL,
      amount     TEXT NOT NULL,
      status     TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'paid')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      paid_at    DATETIME
    );

    CREATE TABLE IF NOT EXISTS client_locks (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      client_phone_hash TEXT NOT NULL UNIQUE,
      a_side_id         TEXT NOT NULL REFERENCES users(id),
      order_id          TEXT REFERENCES orders(id),
      locked_until      DATETIME NOT NULL,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_orders_b_side ON orders(b_side_id);
    CREATE INDEX IF NOT EXISTS idx_orders_case_status ON orders(case_status);
    CREATE INDEX IF NOT EXISTS idx_case_notes_order ON case_notes(order_id);
    CREATE INDEX IF NOT EXISTS idx_commissions_user ON commissions(user_id);
    CREATE INDEX IF NOT EXISTS idx_client_locks_phone ON client_locks(client_phone_hash);
  `)
}
