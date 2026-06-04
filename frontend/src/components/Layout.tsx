import { ReactNode, useEffect } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuthStore, useProfileStore } from '../store'
import { useSocket } from '../hooks/useSocket'

const navItems = [
  { name: '首页', href: '/' },
  { name: '学习档案', href: '/profile' },
  { name: '即时问答', href: '/qa' },
  { name: '教材对话', href: '/textbook' },
  { name: '自适应试卷', href: '/practice' },
  { name: '错题本', href: '/wrong-questions' },
  { name: '作文批改', href: '/essay-grading' },
  { name: '学习日历', href: '/calendar' },
  { name: '费曼学习', href: '/feynman' },
  { name: '启发讲题', href: '/tutoring' },
  { name: '学习路径', href: '/learning-path' },
  { name: '知识图谱', href: '/knowledge-graph' },
  { name: '知识库', href: '/knowledge-base' },
]

function BrandLogo() {
  return (
    <span className="flex items-center gap-3">
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] bg-[#fff7c8] text-xl font-black text-[#213b1f] shadow-[inset_0_-8px_20px_rgba(70,58,20,0.08)]">
        学
      </span>
      <span className="leading-tight">
        <span className="block text-lg font-extrabold tracking-wide text-amber-50">智学平台</span>
        <span className="mt-1 block text-sm font-semibold text-amber-100/55">AI Learning Studio</span>
      </span>
    </span>
  )
}

export default function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const dashboard = useProfileStore((state) => state.dashboard)
  const fetchDashboard = useProfileStore((state) => state.fetchDashboard)
  useSocket()

  useEffect(() => {
    fetchDashboard().catch(() => undefined)
  }, [fetchDashboard])

  return (
    <div className="min-h-screen">
      <aside className="fixed left-4 top-4 z-40 hidden h-[calc(100vh-2rem)] w-64 flex-col rounded-[2rem] border border-amber-900/10 bg-[#22201d] p-4 text-amber-50 shadow-2xl lg:flex">
        <Link to="/" className="mb-6 rounded-[1.6rem] px-1 py-1 transition hover:bg-white/5">
          <BrandLogo />
        </Link>

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              className={({ isActive }) =>
                `block rounded-2xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? 'bg-[#fff7c8] text-[#213b1f]' : 'text-amber-50/72 hover:bg-white/10'
                }`
              }
            >
              {item.name}
            </NavLink>
          ))}
        </nav>

        <div className="mt-4 rounded-3xl bg-white/8 p-3 text-sm text-amber-50/80">
          <p className="font-semibold text-amber-50">{user?.username}</p>
          <p className="mt-1 text-xs">连续学习 {dashboard?.profile.streakDays ?? 0} 天</p>
          <button
            className="mt-3 text-xs text-amber-100 underline"
            onClick={() => {
              logout()
              navigate('/login')
            }}
          >
            退出登录
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-30 border-b border-amber-900/10 bg-[#fbf4e8]/90 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#22201d] p-1">
              <span className="grid h-full w-full place-items-center rounded-xl bg-[#fff7c8] text-base font-black text-[#213b1f]">
                学
              </span>
            </span>
            <span>
              <span className="block text-sm font-extrabold text-emerald-950">智学平台</span>
              <span className="block text-[10px] font-semibold text-stone-500">AI Learning Studio</span>
            </span>
          </Link>
          <button
            className="text-sm font-semibold text-stone-600"
            onClick={() => {
              logout()
              navigate('/login')
            }}
          >
            退出
          </button>
        </div>
        <nav className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {navItems.slice(0, 8).map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              className={({ isActive }) =>
                `shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
                  isActive ? 'bg-emerald-900 text-amber-50' : 'bg-white/70 text-stone-600'
                }`
              }
            >
              {item.name}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="px-4 py-6 lg:ml-72 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          {children}
        </motion.div>
      </main>
    </div>
  )
}
