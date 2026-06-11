import { db, initDatabase } from './db.js'
import { hashPassword } from './auth.js'

initDatabase()

// Seed experts
const experts = [
  {
    id: 'exp-001',
    name: '李明',
    title: '重疾险专家',
    score: 4.8,
    clients: 126,
    response: '2 小时内',
    joined_at: '2025-03-15',
    regions: '大多伦多地区（GTA）、温哥华',
    bio: '10 年保险行业经验，擅长为中产家庭定制全面保障方案。持有 LLQP 牌照。',
    tags: ['重疾险', '人寿', '家庭保障'],
    specialties: ['重疾险', '人寿保险', '家庭综合保障'],
  },
  {
    id: 'exp-002',
    name: '陈华',
    title: '家庭保障规划师',
    score: 4.9,
    clients: 89,
    response: '3 小时内',
    joined_at: '2025-01-10',
    regions: '温哥华、列治文',
    bio: '8 年医疗保险专业经验，曾在大型保险公司担任核保师，深谙医疗险承保规则。',
    tags: ['医疗险', '重疾险', '健康保障'],
    specialties: ['重疾险', '人寿保险', '家庭综合保障'],
  },
  {
    id: 'exp-003',
    name: '赵敏',
    title: '医疗险专家',
    score: 4.7,
    clients: 89,
    response: '3 小时内',
    joined_at: '2025-01-10',
    regions: '温哥华、列治文',
    bio: '8 年医疗保险专业经验，曾在大型保险公司担任核保师，深谙医疗险承保规则。',
    tags: ['医疗险', '重疾险', '健康保障'],
    specialties: ['医疗险', '住院报销', '门诊保险'],
  },
  {
    id: 'exp-004',
    name: '张伟',
    title: '养老规划专家',
    score: 4.6,
    clients: 56,
    response: '1 天内',
    joined_at: '2024-08-20',
    regions: '卡尔加里、埃德蒙顿',
    bio: '专注养老规划领域，帮助客户实现安心退休。',
    tags: ['年金险', '养老规划'],
    specialties: ['年金保险', '退休规划'],
  },
  {
    id: 'exp-005',
    name: '王芳',
    title: '少儿教育金规划师',
    score: 4.8,
    clients: 67,
    response: '2 小时内',
    joined_at: '2025-02-15',
    regions: '多伦多、万锦',
    bio: '专注少儿教育金与家庭财务规划，帮助家长为孩子的未来做好准备。',
    tags: ['教育金', '少儿保险', '家庭规划'],
    specialties: ['教育金保险', '少儿重疾', '家庭财务规划'],
  },
]

const insertExpert = db.prepare(`
  INSERT OR IGNORE INTO experts (id, name, title, score, clients, response, joined_at, regions, bio)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const insertTag = db.prepare(`
  INSERT OR IGNORE INTO expert_tags (expert_id, tag) VALUES (?, ?)
`)

const insertSpecialty = db.prepare(`
  INSERT OR IGNORE INTO expert_specialties (expert_id, specialty) VALUES (?, ?)
`)

for (const expert of experts) {
  insertExpert.run(
    expert.id, expert.name, expert.title, expert.score,
    expert.clients, expert.response, expert.joined_at,
    expert.regions, expert.bio
  )
  for (const tag of expert.tags) {
    insertTag.run(expert.id, tag)
  }
  for (const specialty of expert.specialties) {
    insertSpecialty.run(expert.id, specialty)
  }
}

console.log(`Seeded ${experts.length} experts`)

const seedUsers = [
  {
    id: 'seed-a-regular',
    email: 'a@example.com',
    name: '普通A端用户',
    role: '介绍人',
    platformRole: 'a_side',
    aSideType: 'regular_a',
    overrideRate: 250,
    city: '多伦多',
    career: '地产经纪',
    profession: 'A端介绍人',
    isLicensed: 0,
  },
  {
    id: 'seed-a-big',
    email: 'big_a@example.com',
    name: '大A合伙人',
    role: '合伙人',
    platformRole: 'a_side',
    aSideType: 'big_a',
    overrideRate: 270,
    city: '温哥华',
    career: '会计师',
    profession: '大A合伙人',
    isLicensed: 0,
  },
  {
    id: 'seed-a-small',
    email: 'small_a@example.com',
    name: '小A团队成员',
    role: '介绍人',
    platformRole: 'a_side',
    aSideType: 'small_a',
    overrideRate: 250,
    city: '温哥华',
    career: '律师',
    profession: '小A团队成员',
    isLicensed: 0,
    parentId: 'seed-a-big',
  },
  {
    id: 'seed-b-broker',
    email: 'b@example.com',
    name: 'B端顾问',
    role: '合伙人',
    platformRole: 'b_side',
    aSideType: 'regular_a',
    overrideRate: 250,
    city: '大多伦多地区',
    career: '保险经纪',
    profession: '持牌保险顾问',
    isLicensed: 1,
  },
  {
    id: 'seed-admin',
    email: 'admin@example.com',
    name: '平台管理员',
    role: '合伙人',
    platformRole: 'admin',
    aSideType: 'big_a',
    overrideRate: 270,
    city: '平台总部',
    career: '运营管理',
    profession: 'Admin',
    isLicensed: 0,
  },
  {
    id: 'platform',
    email: 'platform@insurance.local',
    name: '平台留存',
    role: '合伙人',
    platformRole: 'admin',
    aSideType: 'big_a',
    overrideRate: 270,
    city: '平台',
    career: '系统账户',
    profession: '平台留存账户',
    isLicensed: 0,
  },
]

const passwordHash = hashPassword('password123')
const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (
    id, email, password_hash, name, role, status, invite_code,
    platform_role, a_side_type, parent_id, override_rate, city, career, profession, is_licensed
  )
  VALUES (?, ?, ?, ?, ?, '活跃', ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const updateSeedUser = db.prepare(`
  UPDATE users
  SET name = ?, role = ?, status = '活跃', platform_role = ?, a_side_type = ?, parent_id = ?,
      override_rate = ?, city = ?, career = ?, profession = ?, is_licensed = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`)

for (const user of seedUsers) {
  insertUser.run(
    user.id,
    user.email,
    passwordHash,
    user.name,
    user.role,
    `INV-${user.id}`,
    user.platformRole,
    user.aSideType,
    (user as any).parentId || null,
    user.overrideRate,
    user.city,
    user.career,
    user.profession,
    user.isLicensed,
  )
  updateSeedUser.run(
    user.name,
    user.role,
    user.platformRole,
    user.aSideType,
    (user as any).parentId || null,
    user.overrideRate,
    user.city,
    user.career,
    user.profession,
    user.isLicensed,
    user.id,
  )
  db.prepare('INSERT OR IGNORE INTO notification_settings (user_id) VALUES (?)').run(user.id)
}

// Seed team relationship: big_a -> small_a
const bigAId = 'seed-a-big'
const smallAId = 'seed-a-small'
db.prepare(`
  INSERT OR IGNORE INTO team_members (leader_id, member_id, join_date, level)
  VALUES (?, ?, date('now'), '初级介绍人')
`).run(bigAId, smallAId)

console.log(`Seeded ${seedUsers.length} platform users (test password: password123 where applicable)`)
console.log('Database initialized successfully')
