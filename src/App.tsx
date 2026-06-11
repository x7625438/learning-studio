import {
  ArrowLeft,
  ArrowDown,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Copy,
  FileText,
  Filter,
  Gift,
  GraduationCap,
  Home,
  PhoneCall,
  Mail,
  Menu,
  MessageCircle,
  Mic,
  MoreVertical,
  Pencil,
  Paperclip,
  Play,
  Plus,
  RefreshCw,
  Search,
  SendHorizontal,
  Share2,
  Settings,
  Sparkles,
  Star,
  User as UserIcon,
  UserRoundPlus,
  Video,
  X,
} from 'lucide-react'
import QRCode from 'qrcode'
import { useCallback, useEffect, useRef, useState } from 'react'
import LoginPage from './LoginPage.tsx'
import { changePassword, getMe } from './api/auth.js'
import type { User as UserType } from './api/auth.js'
import { getOverview, getPendingMatches, getDashboardNotifications } from './api/dashboard.js'
import { getCustomers } from './api/customers.js'
import { createConversation, sendAIMessage, completeConversation } from './api/ai.js'
import { claimOrder, getOrder, getOrderMarketplace, getOrders, updateOrderStatus } from './api/orders.js'
import { getContacts, getMessages, sendMessage as sendMessageApi } from './api/messages.js'
import { addCertification, getProfile, updateProfile, getNotificationSettings, updateNotificationSettings } from './api/users.js'
import { getTeamMembers, getTeamEarnings, getTeamOverview } from './api/team.js'
import { getNotifications, markAllAsRead, markAsRead } from './api/notifications.js'
import { getInviteInfo } from './api/users.js'
import { getExperts } from './api/experts.js'
import { assignAdminOrder, getAdminBrokers, getAdminOrders, getAdminOverview, getAdminUsers } from './api/admin.js'

type Route = 'home' | 'intro' | 'introCompose' | 'progress' | 'experts' | 'brokerHall' | 'admin' | 'messages' | 'learning' | 'profile' | 'team' | 'inviteMember' | 'login'

const routePaths: Record<Route, string> = {
  home: '/',
  intro: '/intro',
  introCompose: '/intro/compose',
  progress: '/progress',
  experts: '/experts',
  brokerHall: '/broker/orders',
  admin: '/admin',
  messages: '/messages',
  learning: '/learning-center',
  profile: '/profile',
  team: '/team',
  inviteMember: '/team/invite',
  login: '/login',
}

function formatDateTime(utcString: string | null | undefined): string {
  if (!utcString) return '—'
  const date = new Date(utcString.replace(' ', 'T') + 'Z')
  if (Number.isNaN(date.getTime())) return utcString
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function routeFromPath(pathname: string): Route {
  const match = (Object.entries(routePaths) as Array<[Route, string]>).find(([, path]) => path === pathname)
  return match?.[0] ?? 'home'
}

export default function App() {
  const [route, setRouteState] = useState<Route>(() => routeFromPath(window.location.pathname))
  const [modal, setModal] = useState<'invite' | null>(null)
  const [openPanel, setOpenPanel] = useState<'notifications' | 'user' | null>(null)
  const [drawer, setDrawer] = useState<
    | { type: 'customer'; customer: CustomerRecord }
    | { type: 'expert'; expert: ExpertRecord }
    | { type: 'order'; order: ProgressOrderRecord }
    | { type: 'member'; member: TeamMemberRecord }
    | null
  >(null)
  const [user, setUser] = useState<UserType | null>(null)
  const [loading, setLoading] = useState(true)
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const platformRole = user?.platformRole ?? 'a_side'

  const [guideVisible, setGuideVisible] = useState(true)
  const [guideStep, setGuideStep] = useState<1 | 2 | 3 | 4 | 5 | 6 | null>(null)
  const [guideForm, setGuideForm] = useState({
    name: '',
    phone: '',
    email: '',
    city: '',
    career: '',
    clients: '',
  })
  const notifyRef = useRef<HTMLDivElement | null>(null)
  const userMenuRef = useRef<HTMLDivElement | null>(null)

  const setRoute = (nextRoute: Route, options?: { replace?: boolean }) => {
    setRouteState(nextRoute)
    const nextPath = routePaths[nextRoute]
    if (window.location.pathname !== nextPath) {
      window.history[options?.replace ? 'replaceState' : 'pushState']({}, '', nextPath)
    }
  }

  useEffect(() => {
    const handlePopState = () => setRouteState(routeFromPath(window.location.pathname))
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (token) {
      getMe()
        .then(setUser)
        .catch(() => { localStorage.removeItem('token') })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    getNotifications()
      .then((data) => setUnreadNotifications(data?.unreadCount ?? 0))
      .catch(() => setUnreadNotifications(0))
  }, [user])

  useEffect(() => {
    if (user && route === 'login') {
      setRoute('home', { replace: true })
    }
  }, [user, route])

  useEffect(() => {
    if (!user || route !== 'home') return
    if (user.platformRole === 'admin') setRoute('admin', { replace: true })
  }, [user, route])

  useEffect(() => {
    if (!openPanel) return

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (notifyRef.current?.contains(target) || userMenuRef.current?.contains(target)) return
      setOpenPanel(null)
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenPanel(null)
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [openPanel])

  const openIntroComposer = () => setRoute('introCompose')

  const aSideType = user?.aSideType ?? 'regular_a'

  const navItems = [
    { id: 'home', label: '工作台', icon: Home },
    ...(platformRole === 'a_side' ? [
      { id: 'intro' as Route, label: '介绍客户', icon: MessageCircle },
      { id: 'progress' as Route, label: '客户进度', icon: Menu },
      ...(aSideType === 'big_a' ? [{ id: 'team' as Route, label: '我的团队', icon: UserRoundPlus }] : []),
    ] : []),
    ...(['b_side', 'admin'].includes(platformRole) ? [
      { id: 'brokerHall' as Route, label: '工单大厅', icon: ClipboardList },
      { id: 'experts' as Route, label: '顾问资料', icon: CheckCircle2 },
    ] : []),
    ...(platformRole === 'admin' ? [
      { id: 'admin' as Route, label: 'Admin', icon: Settings },
    ] : []),
    { id: 'messages', label: '消息', icon: Mail },
    { id: 'learning', label: '学习中心', icon: GraduationCap },
  ] satisfies Array<{ id: Route; label: string; icon: typeof Home; soon?: boolean }>

  const renderNavItems = (className: string) => (
    <nav className={className}>
      {navItems.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.id}
            className={`top-nav-item ${
              item.id === 'intro'
                ? route === 'intro' || route === 'introCompose'
                  ? 'active'
                  : ''
                : item.id === 'team'
                  ? route === 'team' || route === 'inviteMember'
                    ? 'active'
                    : ''
                  : route === item.id
                    ? 'active'
                    : ''
            }`}
            onClick={() => setRoute(item.id)}
          >
            <Icon size={20} />
            <span>{item.label}</span>
          </button>
        )
      })}
    </nav>
  )

  if (loading) {
    return <div className="loading-screen">加载中...</div>
  }

  if (!user) {
    return <LoginPage onLogin={(u) => {
      setUser(u as UserType)
      setRoute('home', { replace: true })
    }} />
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-logo">保</div>
          <strong>保险智能获客</strong>
        </div>

        {renderNavItems('top-nav')}

        <div className="header-actions">
          <div className="header-popover-anchor notify-anchor" ref={notifyRef}>
            <button
              className={`icon-btn notify ${openPanel === 'notifications' ? 'active' : ''}`}
              aria-label="通知"
              onClick={() =>
                setOpenPanel((panel) => (panel === 'notifications' ? null : 'notifications'))
              }
            >
              <Bell size={24} />
              {unreadNotifications > 0 && <b>{unreadNotifications}</b>}
            </button>
            {openPanel === 'notifications' && (
              <NotificationPopover
                onUnreadCountChange={setUnreadNotifications}
              />
            )}
          </div>
          <button className="icon-btn" aria-label="设置" onClick={() => setRoute('profile')}>
            <Settings size={25} />
          </button>
          <span className="divider" />
          <div className="header-popover-anchor user-anchor" ref={userMenuRef}>
            <button
              className={`user-menu ${openPanel === 'user' ? 'active' : ''}`}
              onClick={() => setOpenPanel((panel) => (panel === 'user' ? null : 'user'))}
            >
              <span>
                <UserIcon size={22} />
              </span>
              {user?.name || '用户'}
              <ChevronDown size={18} />
            </button>
            {openPanel === 'user' && (
              <UserPopover
                platformRole={platformRole}
                onOpenProfile={() => {
                  setOpenPanel(null)
                  setRoute('profile')
                }}
                onLogout={() => {
                  localStorage.removeItem('token')
                  window.location.reload()
                }}
              />
            )}
          </div>
        </div>
      </header>

      <main className="workspace">
        {route === 'home' && platformRole === 'b_side' && (
          <BrokerWorkspacePage onOpenOrderDetail={(order) => setDrawer({ type: 'order', order })} />
        )}
        {route === 'home' && platformRole !== 'b_side' && (
          <HomePage
            userName={user?.name || '用户'}
            aSideType={user?.aSideType}
            onOpenGuide={() => setGuideStep(1)}
            onOpenInvite={() => setModal('invite')}
            onOpenCustomer={openIntroComposer}
            onOpenOrderDetail={(order) => setDrawer({ type: 'order', order })}
            onOpenTeam={() => setRoute('team')}
            onOpenProgress={() => setRoute('progress')}
            onOpenMessages={() => setRoute('messages')}
            onOpenLearning={() => setRoute('learning')}
            guideVisible={guideVisible}
            onCloseGuide={() => setGuideVisible(false)}
          />
        )}
        {route === 'intro' && <IntroPage onStart={openIntroComposer} onOpenCustomerDetail={(customer) => setDrawer({ type: 'customer', customer })} />}
        {route === 'introCompose' && <IntroComposePage onBack={() => setRoute('intro')} onComplete={() => setRoute('progress')} />}
        {route === 'profile' && <ProfilePage />}
        {route === 'experts' && <ExpertPoolPage onOpenExpertDetail={(expert) => setDrawer({ type: 'expert', expert })} />}
        {route === 'brokerHall' && <BrokerOrderHallPage onOpenOrderDetail={(order) => setDrawer({ type: 'order', order })} />}
        {route === 'admin' && <AdminDashboardPage onOpenOrderDetail={(order) => setDrawer({ type: 'order', order })} />}
        {route === 'progress' && (
          <ProgressPage
            onOpenCustomerDetail={(customer) => setDrawer({ type: 'customer', customer })}
            onOpenExpertDetail={(expert) => setDrawer({ type: 'expert', expert })}
            onOpenOrderDetail={(order) => setDrawer({ type: 'order', order })}
          />
        )}
        {route === 'messages' && <MessagesPage onOpenOrderDetail={(order) => setDrawer({ type: 'order', order })} />}
        {route === 'learning' && <LearningCenterPage />}
        {route === 'team' && <TeamPage onInvite={() => setRoute('inviteMember')} onOpenMemberDetail={(member) => setDrawer({ type: 'member', member })} />}
        {route === 'inviteMember' && <InviteMemberPage onBack={() => setRoute('team')} />}
        {route !== 'home' &&
          route !== 'intro' &&
          route !== 'introCompose' &&
          route !== 'progress' &&
          route !== 'experts' &&
          route !== 'brokerHall' &&
          route !== 'admin' &&
          route !== 'messages' &&
          route !== 'learning' &&
          route !== 'profile' &&
          route !== 'team' &&
          route !== 'inviteMember' && (
          <Placeholder route={route} />
        )}
      </main>

      {modal && <Modal title={modalTitle()} onClose={() => setModal(null)}>{modal === 'invite' && <InviteContent />}</Modal>}

      {guideStep && (
        <GuideFlow
          step={guideStep}
          values={guideForm}
          onChange={(patch) => setGuideForm((current) => ({ ...current, ...patch }))}
          onNext={() => setGuideStep((current) => (current && current < 6 ? ((current + 1) as 1 | 2 | 3 | 4 | 5 | 6) : current))}
          onSkip={() => setGuideStep(null)}
          onClose={() => setGuideStep(null)}
          onFinish={() => setGuideStep(null)}
          onStartIntro={() => {
            setGuideStep(5)
          }}
          onExplore={() => {
            setGuideStep(null)
            setRoute('home')
          }}
        />
      )}

      {drawer && (
        <SideDrawer
          title={
            drawer.type === 'customer'
              ? '客户详情'
              : drawer.type === 'expert'
                ? '顾问详情'
                : drawer.type === 'member'
                  ? '成员详情'
                  : ''
          }
          hideHeader={drawer.type === 'order'}
          onClose={() => setDrawer(null)}
        >
          {drawer.type === 'customer' ? (
            <CustomerDrawerContent customer={drawer.customer} onOpenMessages={() => {
              setDrawer(null)
              setRoute('messages')
            }} />
          ) : drawer.type === 'expert' ? (
            <ExpertDrawerContent expert={drawer.expert} onOpenMessages={() => {
              setDrawer(null)
              setRoute('messages')
            }} />
          ) : drawer.type === 'member' ? (
            <MemberDrawerContent member={drawer.member} />
          ) : (
            <OrderDrawerContent order={drawer.order} onClose={() => setDrawer(null)} />
          )}
        </SideDrawer>
      )}
    </div>
  )
}

type TeamMemberRecord = {
  id: string
  name: string
  avatar: string
  joinDate: string
  level: string
  referrals: number
  deals: number
  contribution: string
  status: '活跃' | '新人'
  phone: string
  email: string
  lastActive: string
  recentOrders: Array<{
    id: string
    type: string
    date: string
    status: '已结算' | '待结算'
    amount: string
  }>
}

type CustomerRecord = {
  id?: string
  name: string
  phone?: string
  need: string
  age: string
  city: string
  gender: string
  family: string
  children?: string
  job: string
  income: string
  assets: string
  products: string
  budget: string
  supplement: string
  returnValue: string
  createdAt?: string
}

type ExpertRecord = {
  id?: string
  name: string
  title: string
  score: string
  clients: string
  response: string
  joinedAt: string
  tags: string[]
  specialties: string[]
  regions: string
  bio: string
}

type ProgressOrderRecord = {
  id: string
  status: string
  createdAt: string
  customer: CustomerRecord
  expert: ExpertRecord | null
  broker?: {
    id: string
    name: string
    email?: string
    phone?: string
    city?: string
  } | null
  premium: string
  needType: string
  products: string
  cooperationType?: string
  urgency?: string
  timeline: Array<{
    title: string
    detail: string
    time: string
    color: 'green' | 'blue' | 'red' | 'gray'
  }>
}

type NotificationItem = {
  id: number
  title: string
  content: string
  time: string
}

function NotificationPopover({ onUnreadCountChange }: { onUnreadCountChange: (count: number) => void }) {
  const [items, setItems] = useState<NotificationItem[]>([])

  const syncUnreadNotifications = useCallback(async () => {
    const data = await getNotifications(true)
    const nextItems = ((data?.list ?? []) as NotificationItem[]).map((n) => ({
      id: n.id,
      title: n.title,
      content: n.content,
      time: n.time,
    }))
    setItems(nextItems)
    onUnreadCountChange(data?.unreadCount ?? nextItems.length)
  }, [onUnreadCountChange])

  useEffect(() => {
    void Promise.resolve().then(syncUnreadNotifications).catch(() => {})
  }, [syncUnreadNotifications])

  if (items.length === 0) {
    return (
      <section className="notification-popover">
        <div className="popover-head"><h3>通知</h3></div>
        <div style={{ padding: '40px', textAlign: 'center', color: '#98a2b3' }}>暂无通知</div>
      </section>
    )
  }

  return (
    <section className="notification-popover">
      <div className="popover-head">
        <h3>通知</h3>
        <button onClick={async () => {
          await markAllAsRead()
          setItems([])
          onUnreadCountChange(0)
        }}>全部已读</button>
      </div>
      <div className="notification-list">
        {items.map((item) => (
          <button key={item.id} className="notification-item" onClick={async () => {
            await markAsRead(item.id)
            await syncUnreadNotifications()
          }}>
            <i className="notification-dot" />
            <span className="notification-icon-wrap">
              <MessageCircle size={28} />
            </span>
            <div className="notification-copy">
              <strong>{item.title}</strong>
              <p>{item.content}</p>
              <time>{item.time}</time>
            </div>
          </button>
        ))}
      </div>
      <button className="popover-foot" onClick={async () => {
        await markAllAsRead()
        setItems([])
        onUnreadCountChange(0)
      }}>查看全部通知 &gt;</button>
    </section>
  )
}

function UserPopover({
  platformRole,
  onOpenProfile,
  onLogout,
}: {
  platformRole: 'a_side' | 'b_side' | 'admin'
  onOpenProfile: () => void
  onLogout: () => void
}) {
  const surfaceLabel = platformRole === 'a_side' ? 'A端推荐人' : platformRole === 'b_side' ? 'B端顾问' : 'Admin'
  return (
    <section className="user-popover">
      <button onClick={onOpenProfile}>个人资料</button>
      <button onClick={onOpenProfile}>账号设置</button>
      <span className="user-popover-label">当前端口：{surfaceLabel}</span>
      <button className="danger" onClick={onLogout}>退出登录</button>
    </section>
  )
}

function HomePage({
  userName,
  aSideType,
  onOpenGuide,
  onOpenInvite,
  onOpenCustomer,
  onOpenOrderDetail,
  onOpenTeam,
  onOpenProgress,
  onOpenMessages,
  onOpenLearning,
  guideVisible,
  onCloseGuide,
}: {
  userName: string
  aSideType?: 'regular_a' | 'small_a' | 'big_a'
  onOpenGuide: () => void
  onOpenInvite: () => void
  onOpenCustomer: () => void
  onOpenOrderDetail: (order: ProgressOrderRecord) => void
  onOpenTeam: () => void
  onOpenProgress: () => void
  onOpenMessages: () => void
  onOpenLearning: () => void
  guideVisible: boolean
  onCloseGuide: () => void
}) {
  const [overview, setOverview] = useState<{
    totalCases: number
    pending: number
    following: number
    completed: number
    estimatedIncome: string
    growth: string
    unreadNotifications: number
    team: {
      memberCount: number
      monthlyReferrals: number
      monthlyOverride: string
      monthlyTotalIncome: string
      personalIncome: string
      teamIncome: string
    } | null
  }>({
    totalCases: 0,
    pending: 0,
    following: 0,
    completed: 0,
    estimatedIncome: '$0',
    growth: '+0%',
    unreadNotifications: 0,
    team: null,
  })
  const [pendingCases, setPendingCases] = useState<Array<{
    id: string
    status: string
    cooperationType: string
    urgency: string
    needType: string | null
    premium: string | null
    createdAt: string
    customerName: string
    customerNeed: string | null
    customerCity: string | null
  }>>([])
  const [dashNotifications, setDashNotifications] = useState<Array<{
    id: number
    type: string
    title: string
    highlight: string
    relatedId: string | null
    items: Array<{ text: string; time: string }>
  }>>([])
  const [inviteStats, setInviteStats] = useState({ inviteCount: 0, inviteEarnings: 0 })

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const overviewData = await getOverview()
        if (!cancelled) {
          setOverview((prev) => ({ ...prev, ...overviewData }))
        }
      } catch { /* keep defaults */ }
      try {
        const matchesData = await getPendingMatches()
        if (!cancelled) {
          setPendingCases(matchesData?.cases ?? [])
        }
      } catch { /* keep empty */ }
      try {
        const notificationsData = await getDashboardNotifications()
        if (!cancelled) {
          // Transform backend format to frontend format
          const list = notificationsData?.list ?? []
          const transformed = list.map((n: { id: number; type: string; title: string; content: string | null; relatedId?: string | null; time: string }) => ({
            id: n.id,
            type: n.type,
            title: n.title,
            highlight: n.type === 'message' ? '新消息' : '通知',
            relatedId: n.relatedId ?? null,
            items: [{ text: n.content || n.title, time: n.time }],
          }))
          setDashNotifications(transformed)
        }
      } catch { /* keep empty */ }
      try {
        const inviteData = await getInviteInfo()
        if (!cancelled && inviteData) {
          setInviteStats({
            inviteCount: inviteData.inviteCount ?? 0,
            inviteEarnings: inviteData.inviteEarnings ?? 0,
          })
        }
      } catch { /* keep defaults */ }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const handleOpenNotification = async (notification: {
    id: number
    type: string
    relatedId: string | null
  }) => {
    try {
      await markAsRead(notification.id)
    } catch { /* navigation should still work */ }

    if ((notification.type === 'order' || notification.type === 'customer') && notification.relatedId) {
      try {
        const order = await getOrder(notification.relatedId)
        onOpenOrderDetail(order)
        return
      } catch { /* fall through to progress page */ }
    }

    if (notification.type === 'message') {
      onOpenMessages()
      return
    }

    if (notification.type === 'team') {
      onOpenTeam()
      return
    }

    onOpenCustomer()
  }

  return (
    <>
      <section className="welcome-row">
        <div>
          <h1>你好，{userName}</h1>
          <p>今天需要关注的事情如下</p>
        </div>
        <div className="welcome-actions">
          <button className="outline-btn" onClick={onOpenGuide}>
            查看新手引导
          </button>
          <button className="blue-btn" onClick={onOpenCustomer}>
            <Plus size={20} />
            介绍新客户
          </button>
        </div>
      </section>

      <section className="invite-strip">
        <span>
          <Gift size={22} />
          <strong>邀请同行，各赚 $100</strong>
          {inviteStats.inviteCount > 0 && <em>已邀请 {inviteStats.inviteCount} 人</em>}
          {inviteStats.inviteEarnings > 0 && <em>已赚 ${inviteStats.inviteEarnings}</em>}
        </span>
        <button type="button" className="invite-strip-action" onClick={onOpenInvite}>
          立即邀请
          <ChevronRight size={20} />
        </button>
      </section>

      {aSideType === 'big_a' && (
        <section className="team-overview-card">
          <div className="team-overview-head">
            <h2>团队概览</h2>
            <span className="team-overview-badge">合伙人专属</span>
          </div>
          <div className="team-overview-stats">
            <div className="team-stat">
              <span><UserIcon size={20} /> 团队成员</span>
              <strong>{overview.team?.memberCount ?? 0} <em>人</em></strong>
            </div>
            <div className="team-stat">
              <span><TrendingUpIcon /> 本月团队介绍</span>
              <strong>{overview.team?.monthlyReferrals ?? 0} <em>位客户</em></strong>
            </div>
            <div className="team-stat">
              <span><DollarIcon /> 本月 override</span>
              <strong className="green">{overview.team?.monthlyOverride ?? '$0'}</strong>
            </div>
            <div className="team-stat">
              <span><DollarIcon /> 本月总收入</span>
              <strong className="green">{overview.team?.monthlyTotalIncome ?? '$0'}</strong>
              <p>个人 {overview.team?.personalIncome ?? '$0'} + 团队 {overview.team?.teamIncome ?? '$0'}</p>
            </div>
          </div>
          <div className="team-overview-links">
            <button onClick={onOpenTeam}>查看团队详情 →</button>
            <button onClick={onOpenTeam}>查看收入明细 →</button>
          </div>
        </section>
      )}

      <section className="dashboard-grid">
        <CaseOverview overview={overview} />
        <NotificationStack notifications={dashNotifications} onOpenNotification={handleOpenNotification} />
        <LearningCard onOpenLearning={onOpenLearning} />
        <PendingCaseCard cases={pendingCases} onOpenProgress={onOpenProgress} />
      </section>

      {guideVisible && (
        <GettingStartedGuide
          onClose={onCloseGuide}
          onStartIntro={onOpenCustomer}
          onOpenMessages={onOpenMessages}
          onOpenLearning={onOpenLearning}
        />
      )}
    </>
  )
}

function CaseGauge({
  segments,
  total,
}: {
  segments: Array<{ value: number; color: string }>
  total: number
}) {
  const cx = 135
  const cy = 128
  const rOuter = 102
  const rInner = 68
  const capR = (rOuter - rInner) / 2
  const arcs = segments.reduce<Array<{ color: string; d: string; tEnd: number }>>(
    (items, segment) => {
      const tStart = items.at(-1)?.tEnd ?? Math.PI
      const sweep = total > 0 ? (segment.value / total) * Math.PI : 0
      const tEnd = tStart - sweep
      return [
        ...items,
        {
          color: segment.color,
          d: describeDonutArc(cx, cy, rInner, rOuter, tStart, tEnd),
          tEnd,
        },
      ]
    },
    [],
  )

  return (
    <svg className="gauge-svg" viewBox="0 0 270 148" aria-hidden>
      {arcs.map((arc) => (
        <path key={arc.color} d={arc.d} fill={arc.color} />
      ))}
      <circle cx={cx - (rOuter + rInner) / 2} cy={cy} r={capR} fill={segments[0]?.color ?? '#8457f3'} />
      <circle cx={cx + (rOuter + rInner) / 2} cy={cy} r={capR} fill={segments.at(-1)?.color ?? '#22c55e'} />
    </svg>
  )
}

function describeDonutArc(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  tStart: number,
  tEnd: number,
) {
  const startOuter = polar(cx, cy, rOuter, tStart)
  const endOuter = polar(cx, cy, rOuter, tEnd)
  const startInner = polar(cx, cy, rInner, tEnd)
  const endInner = polar(cx, cy, rInner, tStart)
  const large = tStart - tEnd > Math.PI ? 1 : 0

  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${endInner.x} ${endInner.y}`,
    'Z',
  ].join(' ')
}

/** 上半圆：t=π 为左端，t=0 为右端 */
function polar(cx: number, cy: number, r: number, t: number) {
  return {
    x: cx + r * Math.cos(t),
    y: cy - r * Math.sin(t),
  }
}

function CaseOverview({
  overview,
}: {
  overview: {
    totalCases: number
    pending: number
    following: number
    completed: number
    estimatedIncome: string
    growth: string
  }
}) {
  const total = overview.pending + overview.following + overview.completed
  const segments = [
    { value: overview.pending, color: '#8457f3' },
    { value: overview.following, color: '#357df3' },
    { value: overview.completed, color: '#22c55e' },
  ]

  return (
    <article className="card case-card">
      <div className="gauge-wrap">
        <div className="gauge">
          <CaseGauge segments={segments} total={total} />
          <div className="gauge-center">
            <span>案件总数</span>
            <strong>{overview.totalCases}</strong>
          </div>
        </div>
        <p className="gauge-growth">↑ {overview.growth} 较上月</p>
      </div>
      <div className="case-side">
        <MetricLine color="purple" label="待接单" value={String(overview.pending)} />
        <MetricLine color="blue" label="跟进中" value={String(overview.following)} />
        <MetricLine color="green" label="已完成" value={String(overview.completed)} />
        <hr />
        <div className="income-block">
          <span>
            预估收入
            <CircleHelp size={16} />
          </span>
          <strong>{overview.estimatedIncome}</strong>
        </div>
      </div>
    </article>
  )
}

function MetricLine({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="metric-line">
      <i className={color} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function NotificationStack({
  notifications,
  onOpenNotification,
}: {
  notifications: Array<{
    id: number
    type: string
    title: string
    highlight: string
    relatedId: string | null
    items: Array<{ text: string; time: string }>
  }>
  onOpenNotification: (notification: { id: number; type: string; relatedId: string | null }) => void
}) {
  const safeNotifications = Array.isArray(notifications) ? notifications : []
  if (safeNotifications.length === 0) {
    return (
      <div className="notice-stack">
        <div className="card notice-card static-card" style={{ justifyContent: 'center', color: '#98a2b3' }}>
          暂无待处理事项
        </div>
      </div>
    )
  }

  return (
    <div className="notice-stack">
      {safeNotifications.map((n, index) => (
        <button className="card notice-card notice-action-card" key={n.id || index} onClick={() => onOpenNotification(n)}>
          <div className={`notice-icon ${n.type === 'message' ? 'purple' : 'blue'}`}>
            {n.type === 'message' ? <Mail size={24} /> : <MessageCircle size={25} />}
          </div>
          <div>
            <h3>
              {n.title} <span className={n.type === 'message' ? 'purple-text' : ''}>{n.highlight}</span>
            </h3>
            {n.items.map((item, i) => (
              <p key={i}>
                {item.text} {item.time && <time>{item.time}</time>}
              </p>
            ))}
          </div>
          <ChevronRight size={24} />
        </button>
      ))}
    </div>
  )
}

function LearningCard({ onOpenLearning }: { onOpenLearning: () => void }) {
  return (
    <article className="card learning-card">
      <div className="card-title-row">
        <h2>学习中心</h2>
        <button className="card-link-text" type="button" onClick={onOpenLearning}>
          查看全部
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="course-banner">
        <span className="continue-badge">继续观看</span>
        <span className="play-button" aria-hidden="true">
          <Play size={44} />
        </span>
        <span className="video-time main">12:30</span>
      </div>
      <div className="watch-progress">
        <span />
      </div>
      <h3 className="course-title">快速上手 - 如何介绍你的第一位客户</h3>
      <p className="course-desc">看看 AI 怎么帮你自动录单 - 你只需要聊两句客户情况</p>
      <div className="mini-course-grid">
        <article>
          <div className="mini-video warm">
            <span>8:15</span>
          </div>
          <strong>客户进度功能介绍</strong>
        </article>
        <article>
          <div className="mini-video mint">
            <span>6:42</span>
          </div>
          <strong>如何设置邀请链接</strong>
        </article>
      </div>
    </article>
  )
}

function PendingCaseCard({
  cases,
  onOpenProgress,
}: {
  cases: Array<{
    id: string
    status: string
    cooperationType: string
    urgency: string
    needType: string | null
    premium: string | null
    customerName: string
    customerCity: string | null
  }>
  onOpenProgress: () => void
}) {
  const safeCases = Array.isArray(cases) ? cases : []
  if (safeCases.length === 0) {
    return (
      <article className="card match-card">
        <div className="card-title-row">
          <h2>等待B端接单</h2>
        </div>
        <div style={{ padding: '40px 20px', textAlign: 'center', color: '#98a2b3' }}>
          暂无等待接单的工单，先去「介绍客户」提交一位客户吧
        </div>
      </article>
    )
  }

  return (
    <article className="card match-card">
      <div className="card-title-row">
        <h2>等待B端接单</h2>
        <button className="card-link-text" onClick={onOpenProgress}>
          更多
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="match-list">
        {safeCases.map((item) => (
          <div className="match-row pending-case-row" key={item.id}>
            <div>
              <strong>{item.customerName}</strong>
              <p>{item.customerCity || '城市待补充'} · {item.needType || '需求待补充'}</p>
            </div>
            <ChevronRight className="match-arrow" size={24} />
            <div>
              <strong className="link-blue">{item.status}</strong>
              <p>{cooperationLabel(item.cooperationType)} · {item.urgency}</p>
            </div>
            <button className="confirm-btn" type="button" onClick={onOpenProgress}>查看</button>
            <span className="more-btn">⋮</span>
          </div>
        ))}
      </div>
    </article>
  )
}

function ExpertPoolPage({ onOpenExpertDetail }: { onOpenExpertDetail: (expert: ExpertRecord) => void }) {
  const specialtyTabs = ['全部', '重疾', '医疗', '家庭', '养老', '教育'] as const
  const [experts, setExperts] = useState<ExpertRecord[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [specialty, setSpecialty] = useState<(typeof specialtyTabs)[number]>('全部')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const data = await getExperts({
          search: searchQuery || undefined,
          specialty: specialty === '全部' ? undefined : specialty,
        })
        if (!cancelled) setExperts(data?.list ?? [])
      } catch {
        if (!cancelled) {
          setExperts([])
          setError('顾问资料暂时无法加载，请稍后重试。')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [searchQuery, specialty])

  return (
    <section className="expert-pool-page">
      <div className="expert-pool-head">
        <div>
          <h1>平台顾问资料</h1>
          <p>这里展示真实 B 端顾问账号资料。工单会先进入大厅，由顾问接单或由 Admin 指派。</p>
        </div>
      </div>

      <article className="card expert-pool-filter">
        <label className="expert-pool-search">
          <Search size={20} />
          <input placeholder="搜索顾问姓名、领域或地区" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
        </label>
        <div className="expert-pool-tabs">
          {specialtyTabs.map((tab) => (
            <button key={tab} className={specialty === tab ? 'active' : ''} onClick={() => setSpecialty(tab)}>
              {tab}
            </button>
          ))}
        </div>
      </article>

      {error && <div className="messages-inline-notice">{error}</div>}

      {loading ? (
        <div className="expert-pool-empty">正在加载顾问资料...</div>
      ) : experts.length === 0 ? (
        <div className="expert-pool-empty">暂无符合条件的顾问</div>
      ) : (
        <div className="expert-pool-grid">
          {experts.map((expert) => (
            <article className="card expert-pool-card" key={expert.id ?? expert.name}>
              <div className="expert-pool-card-head">
                <span className="expert-pool-avatar">
                  <UserIcon size={28} />
                </span>
                <div>
                  <h2>{expert.name}</h2>
                  <p>{expert.title}</p>
                </div>
              </div>
              <div className="expert-pool-tags">
                {expert.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}
              </div>
              <div className="expert-pool-metrics">
                <div>
                  <strong><Star size={16} fill="currentColor" /> {expert.score}</strong>
                  <span>评分</span>
                </div>
                <div>
                  <strong>{expert.clients}</strong>
                  <span>服务客户</span>
                </div>
                <div>
                  <strong>{expert.response}</strong>
                  <span>平均响应</span>
                </div>
              </div>
              <p className="expert-pool-bio">{expert.bio}</p>
              <div className="expert-pool-foot">
                <span>{expert.regions}</span>
                <button type="button" onClick={() => onOpenExpertDetail(expert)}>
                  查看资料
                  <ChevronRight size={18} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

type MarketplaceOrder = {
  id: string
  status: string
  cooperationType: string
  urgency: string
  needType: string
  products: string
  premium: string
  createdAt: string
  customer: {
    ageRange: string
    city: string
    gender: string
    family: string
    children: string
    job: string
    income: string
    assets: string
  }
}

function cooperationLabel(value: string) {
  const labels: Record<string, string> = {
    tier_20: '20% Name Referral',
    tier_50: '50% 主动参与',
    tier_70: '70% 全程参与',
  }
  return labels[value] || '50% 主动参与'
}

function BrokerOrderHallPage({ onOpenOrderDetail }: { onOpenOrderDetail: (order: ProgressOrderRecord) => void }) {
  const [orders, setOrders] = useState<MarketplaceOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')

  const loadOrders = useCallback(async () => {
    setLoading(true)
    setNotice('')
    try {
      const data = await getOrderMarketplace()
      setOrders(data?.list ?? [])
    } catch {
      setOrders([])
      setNotice('工单大厅暂时无法加载。请确认当前账号是B端顾问或管理员。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadOrders()
  }, [loadOrders])

  const handleClaim = async (orderId: string) => {
    setNotice('')
    try {
      const data = await claimOrder(orderId)
      setOrders((items) => items.filter((item) => item.id !== orderId))
      if (data?.order) onOpenOrderDetail(data.order)
    } catch {
      setNotice('接单失败，该工单可能已被其他顾问接走。')
      void loadOrders()
    }
  }

  return (
    <section className="broker-hall-page">
      <div className="broker-hall-head">
        <div>
          <h1>工单大厅</h1>
          <p>B端顾问只能在接单前看到脱敏客户信息；接单后才能查看完整资料，并先联系A端推荐人对齐案情。</p>
        </div>
        <button className="outline-btn" type="button" onClick={() => void loadOrders()}>
          <RefreshCw size={18} />
          刷新
        </button>
      </div>

      {notice && <div className="messages-inline-notice">{notice}</div>}

      {loading ? (
        <div className="broker-hall-empty">正在加载可接工单...</div>
      ) : orders.length === 0 ? (
        <div className="broker-hall-empty">暂无可接工单</div>
      ) : (
        <div className="broker-order-grid">
          {orders.map((order) => (
            <article className="card broker-order-card" key={order.id}>
              <div className="broker-order-top">
                <div>
                  <span>{order.id}</span>
                  <h2>{order.needType || '保险需求待补充'}</h2>
                </div>
                <em className={order.urgency === '紧急' || order.urgency === '高' ? 'hot' : ''}>{order.urgency || '普通'}</em>
              </div>
              <div className="broker-order-meta">
                <span>{cooperationLabel(order.cooperationType)}</span>
                <span>{order.products || '产品类型待补充'}</span>
                <span>{order.premium || '预算待补充'}</span>
              </div>
              <div className="broker-mask-grid">
                <div><span>年龄段</span><strong>{order.customer.ageRange}</strong></div>
                <div><span>城市</span><strong>{order.customer.city || '待补充'}</strong></div>
                <div><span>家庭</span><strong>{order.customer.family || '待补充'}</strong></div>
                <div><span>职业</span><strong>{order.customer.job || '待补充'}</strong></div>
              </div>
              <p className="broker-hall-note">客户姓名与联系方式已脱敏，接单后可查看完整资料。</p>
              <button className="blue-btn broker-claim-btn" type="button" onClick={() => void handleClaim(order.id)}>
                接单
                <ChevronRight size={18} />
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function BrokerWorkspacePage({ onOpenOrderDetail }: { onOpenOrderDetail: (order: ProgressOrderRecord) => void }) {
  const caseStatuses = [
    '已分配顾问',
    '会议已安排',
    '沟通中',
    '客户有顾虑',
    '客户暂时搁置',
    '客户不感兴趣',
    '申请已提交',
    '核保中',
    '需要体检',
    '保单已批准',
    '佣金已结算',
  ] as const
  const tabs = ['全部', '跟进中', '需关注', '已完成'] as const
  const [orders, setOrders] = useState<ProgressOrderRecord[]>([])
  const [activeTab, setActiveTab] = useState<typeof tabs[number]>('全部')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')

  const loadOrders = useCallback(async () => {
    setLoading(true)
    setNotice('')
    try {
      const data = await getOrders({ status: activeTab === '全部' ? undefined : activeTab })
      setOrders(data?.list ?? [])
    } catch {
      setOrders([])
      setNotice('我的工单暂时无法加载，请确认当前账号是B端顾问。')
    } finally {
      setLoading(false)
    }
  }, [activeTab])

  useEffect(() => {
    void loadOrders()
  }, [loadOrders])

  const openOrder = async (orderId: string) => {
    try {
      const order = await getOrder(orderId)
      onOpenOrderDetail(order)
    } catch {
      setNotice('工单详情暂时无法打开。')
    }
  }

  const handleStatusChange = async (orderId: string, status: string) => {
    try {
      const data = await updateOrderStatus(orderId, status)
      setOrders((items) => items.map((item) => item.id === orderId ? (data?.order ?? { ...item, status }) : item))
      setNotice(status === '佣金已结算' ? '状态已更新，佣金记录已生成。' : '状态已更新。')
    } catch {
      setNotice('状态更新失败，请稍后重试。')
    }
  }

  const activeOrders = orders.filter((order) => !['保单已批准', '佣金已结算', '客户不感兴趣'].includes(order.status)).length
  const completedOrders = orders.filter((order) => ['保单已批准', '佣金已结算'].includes(order.status)).length
  const attentionOrders = orders.filter((order) => ['客户有顾虑', '客户暂时搁置', '需要体检'].includes(order.status)).length

  return (
    <section className="broker-workspace-page">
      <div className="broker-workspace-head">
        <div>
          <h1>顾问工作台</h1>
          <p>查看已接工单、完整客户信息和下一步处理动作。</p>
        </div>
        <button className="outline-btn" type="button" onClick={() => void loadOrders()}>
          <RefreshCw size={18} />
          刷新
        </button>
      </div>

      {notice && <div className="messages-inline-notice">{notice}</div>}

      <div className="broker-workspace-stats">
        <div className="card broker-workspace-stat"><span>已接工单</span><strong>{orders.length}</strong></div>
        <div className="card broker-workspace-stat"><span>跟进中</span><strong>{activeOrders}</strong></div>
        <div className="card broker-workspace-stat"><span>需关注</span><strong>{attentionOrders}</strong></div>
        <div className="card broker-workspace-stat"><span>已完成</span><strong>{completedOrders}</strong></div>
      </div>

      <article className="card broker-workspace-panel">
        <div className="progress-tabs">
          {tabs.map((tab) => (
            <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tab}</button>
          ))}
        </div>

        {loading ? (
          <div className="broker-hall-empty">正在加载我的工单...</div>
        ) : orders.length === 0 ? (
          <div className="broker-hall-empty">暂无已接工单，可以去「工单大厅」接单。</div>
        ) : (
          <div className="broker-workspace-list">
            {orders.map((order) => (
              <article className="broker-workspace-row" key={order.id}>
                <div className="broker-workspace-main">
                  <button type="button" onClick={() => void openOrder(order.id)}>{order.id}</button>
                  <strong>{order.customer.name || '客户姓名待补充'}</strong>
                  <p>{order.needType || order.customer.need || '需求待补充'} · {order.customer.city || '城市待补充'} · {order.customer.phone || '电话待补充'}</p>
                </div>
                <span className={`broker-workspace-status ${order.status === '客户有顾虑' || order.status === '需要体检' ? 'warning' : order.status === '佣金已结算' ? 'success' : ''}`}>{order.status}</span>
                <select value={order.status} onChange={(event) => void handleStatusChange(order.id, event.target.value)}>
                  {caseStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
                <button className="admin-link-btn" type="button" onClick={() => void openOrder(order.id)}>查看详情</button>
              </article>
            ))}
          </div>
        )}
      </article>
    </section>
  )
}

function AdminDashboardPage({ onOpenOrderDetail }: { onOpenOrderDetail: (order: ProgressOrderRecord) => void }) {
  const caseStatuses = [
    '已提交',
    '已分配顾问',
    '会议已安排',
    '沟通中',
    '客户有顾虑',
    '客户暂时搁置',
    '客户不感兴趣',
    '申请已提交',
    '核保中',
    '需要体检',
    '保单已批准',
    '佣金已结算',
  ] as const
  const [overview, setOverview] = useState({
    totalOrders: 0,
    unassigned: 0,
    overdue: 0,
    activeBrokers: 0,
    pendingCommissions: 0,
  })
  const [orders, setOrders] = useState<Array<{
    id: string
    status: string
    cooperationType: string
    urgency: string
    premium: string | null
    needType: string | null
    createdAt: string
    customerName: string
    aSideName: string
    bSideName: string | null
  }>>([])
  const [users, setUsers] = useState<Array<{ id: string; name: string; email: string; platform_role: string | null; a_side_type: string | null; status: string }>>([])
  const [brokers, setBrokers] = useState<Array<{ id: string; name: string }>>([])
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [activeTab, setActiveTab] = useState<'工单' | '用户'>('工单')
  const [notice, setNotice] = useState('')

  const loadAdmin = useCallback(async () => {
    setNotice('')
    try {
      const [overviewData, ordersData, usersData, brokersData] = await Promise.all([
        getAdminOverview(),
        getAdminOrders(),
        getAdminUsers(),
        getAdminBrokers(),
      ])
      setOverview(overviewData)
      setOrders(ordersData?.list ?? [])
      setUsers(usersData?.list ?? [])
      setBrokers(brokersData?.list ?? [])
    } catch {
      setNotice('Admin 数据暂时无法加载，请确认当前账号是管理员端。')
    }
  }, [])

  useEffect(() => {
    void loadAdmin()
  }, [loadAdmin])

  const handleOpenOrder = async (orderId: string) => {
    try {
      const order = await getOrder(orderId)
      onOpenOrderDetail(order)
    } catch {
      setNotice('工单详情暂时无法打开。')
    }
  }

  const handleAssign = async (orderId: string) => {
    const brokerId = assignments[orderId]
    if (!brokerId) {
      setNotice('请先选择一个 B端顾问。')
      return
    }
    try {
      await assignAdminOrder(orderId, brokerId)
      await loadAdmin()
      setNotice('工单已分配。')
    } catch {
      setNotice('分配失败，请稍后重试。')
    }
  }

  const handleStatusChange = async (orderId: string, status: string) => {
    try {
      await updateOrderStatus(orderId, status)
      await loadAdmin()
      setNotice(status === '佣金已结算' ? '状态已更新，佣金记录已生成。' : '状态已更新。')
    } catch {
      setNotice('状态更新失败。')
    }
  }

  return (
    <section className="admin-page">
      <div className="admin-head">
        <div>
          <h1>Admin 控制台</h1>
          <p>管理工单、B端顾问分配、SLA 告警和用户信息。</p>
        </div>
        <button className="outline-btn" onClick={() => void loadAdmin()}>
          <RefreshCw size={18} />
          刷新
        </button>
      </div>

      {notice && <div className="messages-inline-notice">{notice}</div>}
      {overview.overdue > 0 && <div className="admin-alert">有 {overview.overdue} 个工单超过 1 小时未接单，需要人工介入。</div>}

      <div className="admin-stats-grid">
        <div className="card admin-stat"><span>全部工单</span><strong>{overview.totalOrders}</strong></div>
        <div className="card admin-stat"><span>待接单</span><strong>{overview.unassigned}</strong></div>
        <div className="card admin-stat"><span>活跃顾问</span><strong>{overview.activeBrokers}</strong></div>
        <div className="card admin-stat"><span>待处理佣金</span><strong>{overview.pendingCommissions}</strong></div>
      </div>

      <article className="card admin-panel">
        <div className="admin-tabs">
          {(['工单', '用户'] as const).map((tab) => (
            <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tab}</button>
          ))}
        </div>

        {activeTab === '工单' ? (
          <div className="admin-order-list">
            {orders.map((order) => (
              <div className="admin-order-row" key={order.id}>
                <div>
                  <button onClick={() => void handleOpenOrder(order.id)}>{order.id}</button>
                  <p>{order.customerName} · {order.needType || '需求待补充'} · A端 {order.aSideName}</p>
                </div>
                <span>{order.status}</span>
                <select value={order.status} onChange={(event) => void handleStatusChange(order.id, event.target.value)}>
                  {caseStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
                <select value={assignments[order.id] ?? ''} onChange={(event) => setAssignments((current) => ({ ...current, [order.id]: event.target.value }))}>
                  <option value="">{order.bSideName ? `当前：${order.bSideName}` : '选择B端顾问'}</option>
                  {brokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.name}</option>)}
                </select>
                <button className="admin-link-btn" onClick={() => void handleAssign(order.id)}>分配</button>
              </div>
            ))}
            {orders.length === 0 && <div className="team-empty-state">暂无工单。</div>}
          </div>
        ) : (
          <div className="admin-user-list">
            {users.map((user) => (
              <div className="admin-user-row" key={user.id}>
                <strong>{user.name}</strong>
                <span>{user.email}</span>
                <span>{user.platform_role || 'a_side'}</span>
                <span>{user.a_side_type || '-'}</span>
                <span>{user.status}</span>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  )
}

function GettingStartedGuide({
  onClose,
  onStartIntro,
  onOpenMessages,
  onOpenLearning,
}: {
  onClose: () => void
  onStartIntro: () => void
  onOpenMessages: () => void
  onOpenLearning: () => void
}) {
  const steps = [
    { label: '介绍第一位客户', icon: MessageCircle, action: onStartIntro },
    { label: '完成一次客户介绍', icon: FileText, action: onStartIntro },
    { label: '设置常用回复', icon: Mail, action: onOpenMessages },
    { label: '观看平台介绍视频', icon: Video, action: onOpenLearning },
  ]

  return (
    <section className="guide-panel">
      <button className="guide-close" aria-label="关闭指南" onClick={onClose}>×</button>
      <div className="guide-copy">
        <h2>快速上手指南</h2>
        <p>完成以下步骤，快速掌握平台使用方法</p>
      </div>
      <div className="guide-steps">
        {steps.map(({ label, icon: Icon, action }) => (
          <button key={label} className="guide-step" onClick={action}>
            <span>
              <Icon size={30} />
            </span>
            <strong>{label}</strong>
          </button>
        ))}
      </div>
    </section>
  )
}

const routeLabels: Record<Route, string> = {
  home: '工作台',
  intro: '介绍客户',
  introCompose: '介绍客户',
  progress: '客户进度',
  experts: '顾问资料',
  brokerHall: '工单大厅',
  admin: 'Admin',
  messages: '消息',
  learning: '学习中心',
  profile: '个人资料',
  team: '我的团队',
  inviteMember: '邀请成员',
  login: '登录',
}

function Placeholder({ route }: { route: Route }) {
  return (
    <section className="placeholder card">
      <BookOpen size={44} />
      <h1>{routeLabels[route]}</h1>
      <p>该页面会沿用当前顶部导航和卡片体系继续补齐。</p>
    </section>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-layer">
      <button className="modal-backdrop" onClick={onClose} aria-label="关闭弹窗" />
      <section className="modal-card">
        <div className="modal-head">
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  )
}

function modalTitle() {
  return '邀请同行'
}

function InviteContent() {
  const [inviteInfo, setInviteInfo] = useState<{ inviteUrl?: string; inviteCode?: string } | null>(null)
  const [qrUrl, setQrUrl] = useState('')
  const [copyStatus, setCopyStatus] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await getInviteInfo()
        if (!cancelled && data) {
          setInviteInfo(data)
        }
      } catch {
        // keep null on error
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const inviteUrl = inviteInfo?.inviteUrl ?? ''

  useEffect(() => {
    if (!inviteUrl) return
    QRCode.toDataURL(inviteUrl, { margin: 1, width: 180 })
      .then(setQrUrl)
      .catch(() => setQrUrl(''))
  }, [inviteUrl])

  const shareInvite = async () => {
    if (!inviteUrl) return
    const text = `加入我的保险智能获客团队：${inviteUrl}`
    if (navigator.share) {
      await navigator.share({ title: '保险智能获客邀请', text, url: inviteUrl })
    } else {
      await navigator.clipboard.writeText(text)
      setCopyStatus('分享文案已复制')
    }
  }

  return (
    <div className="invite-modal-body">
      <div className="invite-block">
        <strong>你的专属邀请链接</strong>
        <div className="invite-link-row">
          <div className="invite-link-box">{inviteUrl || '加载中...'}</div>
          <button className="invite-copy-btn" type="button" disabled={!inviteUrl} onClick={() => {
            if (inviteUrl) void navigator.clipboard.writeText(inviteUrl).then(() => setCopyStatus('邀请链接已复制'))
          }}>
            <Copy size={20} />
            复制
          </button>
        </div>
      </div>
      <div className="invite-qr-card">
        <div className="invite-qr">
          {qrUrl ? <img src={qrUrl} alt="邀请二维码" /> : <div />}
        </div>
        <span>扫码邀请好友</span>
      </div>
      <div className="invite-tip">
        好友通过你的链接注册并完成首次客户会面后，双方各获 $100 奖励
      </div>
      <div className="invite-bottom-actions">
        <button className="invite-primary-btn" type="button" disabled={!inviteUrl} onClick={() => {
          if (inviteUrl) void navigator.clipboard.writeText(inviteUrl).then(() => setCopyStatus('邀请链接已复制'))
        }}>复制链接</button>
        <button className="invite-secondary-btn" type="button" disabled={!inviteUrl} onClick={() => void shareInvite()}>
          <Share2 size={18} />
          分享给好友
        </button>
      </div>
      {copyStatus && <div className="invite-copy-status">{copyStatus}</div>}
    </div>
  )
}

function SideDrawer({
  title,
  children,
  onClose,
  hideHeader = false,
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
  hideHeader?: boolean
}) {
  return (
    <div className="drawer-layer">
      <button className="drawer-backdrop" onClick={onClose} aria-label="关闭抽屉" />
      <aside className="drawer-panel">
        {!hideHeader && (
          <div className="drawer-head">
            <h2>{title}</h2>
            <button onClick={onClose} aria-label="关闭">
              <X size={20} />
            </button>
          </div>
        )}
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  )
}

function parseBudgetToFYC(budget: string): number {
  if (!budget) return 0
  const normalized = budget.replace(/[,，\s]/g, '')
  const match = normalized.match(/(\d+(?:\.\d+)?)/)
  if (!match) return 0
  let amount = Number(match[1])
  if (!Number.isFinite(amount)) return 0
  if (normalized.includes('万')) amount *= 10000
  // FYC = FYP × 50% (industry standard first-year commission rate)
  return Math.round(amount * 0.5)
}

function formatMoney(amount: number): string {
  if (amount >= 10000) {
    return `$${(amount / 10000).toFixed(1)}万`
  }
  return `$${amount}`
}

function CustomerDrawerContent({ customer, onOpenMessages }: { customer: CustomerRecord; onOpenMessages: () => void }) {
  const estimatedReturn = customer.returnValue && customer.returnValue !== '$0'
    ? customer.returnValue
    : formatMoney(parseBudgetToFYC(customer.budget))
  return (
    <>
      <div className="drawer-profile">
        <span className="drawer-avatar">
          <UserIcon size={24} />
        </span>
        <div>
          <strong>{customer.name}</strong>
          <p>创建于 {formatDateTime(customer.createdAt)}</p>
        </div>
      </div>
      <section className="customer-return-card">
        <span>预估总回报</span>
        <strong>{estimatedReturn}</strong>
        <p>{customer.products && customer.products !== '—' ? `意向产品：${customer.products}` : '待确认产品方案'}</p>
      </section>
      <section className="drawer-section">
        <h3>基本信息</h3>
        <div className="info-grid-card">
          <InfoItem label="客户姓名" value={customer.name} />
          <InfoItem label="年龄" value={customer.age} />
          <InfoItem label="性别" value={customer.gender} />
          <InfoItem label="现居城市" value={customer.city} />
          <InfoItem label="婚姻状况" value={customer.family} />
          <InfoItem label="子女情况" value={customer.children ?? '—'} />
          <InfoItem label="职业类型" value={customer.job} />
          <InfoItem label="家庭年收入范围" value={customer.income} />
          <InfoItem label="可投保资产规模" value={customer.assets} />
        </div>
      </section>
      <section className="drawer-section">
        <h3>保险需求</h3>
        <div className="info-grid-card">
          <InfoItem label="需求类型" value={customer.need} />
          <InfoItem label="偏好产品" value={customer.products} />
          <InfoItem label="预算范围" value={customer.budget} />
          <InfoItem label="补充说明" value={customer.supplement} />
        </div>
      </section>
      <button className="drawer-primary-btn" type="button" onClick={onOpenMessages}>
        <Plus size={20} />
        新建对话
      </button>
    </>
  )
}

function ExpertDrawerContent({ expert, onOpenMessages }: { expert: ExpertRecord; onOpenMessages: () => void }) {
  return (
    <>
      <div className="expert-top">
        <span className="expert-avatar">
          <UserIcon size={34} />
        </span>
        <strong>{expert.name}</strong>
        <p>
          {expert.title} <CheckCircle2 size={18} />
        </p>
        <span className="expert-joined">入驻时间: {expert.joinedAt}</span>
      </div>
      <div className="expert-tags">
        {expert.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      <section className="expert-stats-card">
        <div>
          <strong><Star size={18} fill="currentColor" /> {expert.score}</strong>
          <span>综合评分</span>
        </div>
        <div>
          <strong>{expert.clients}</strong>
          <span>已服务客户</span>
        </div>
        <div>
          <strong>{expert.response}</strong>
          <span>平均响应</span>
        </div>
      </section>
      <section className="drawer-section">
        <h3>专业领域</h3>
        <div className="expert-list-card">
          {expert.specialties.map((item) => (
            <p key={item}>
              <Check size={16} />
              {item}
            </p>
          ))}
        </div>
      </section>
      <section className="drawer-section">
        <h3>服务区域</h3>
        <div className="plain-section-copy">{expert.regions}</div>
      </section>
      <section className="drawer-section">
        <h3>个人简介</h3>
        <div className="plain-section-copy">{expert.bio}</div>
      </section>
      <button className="drawer-primary-btn" type="button" onClick={onOpenMessages}>
        <MessageCircle size={20} />
        发送消息
      </button>
    </>
  )
}

function OrderDrawerContent({
  order,
  onClose,
}: {
  order: ProgressOrderRecord
  onClose: () => void
}) {
  const [isCustomerOpen, setIsCustomerOpen] = useState(false)
  const stageMap: Record<string, string> = {
    '待匹配': '已提交',
    '已匹配': '已分配顾问',
    '对接中': '会议已安排',
    '已联系': '沟通中',
    '已面谈': '沟通中',
    '签单中': '申请已提交',
    '已完成': '保单已批准',
    '需关注': '客户有顾虑',
  }
  const stageLabels = ['已提交', '已分配顾问', '会议已安排', '沟通中', '客户有顾虑', '客户暂时搁置', '客户不感兴趣', '申请已提交', '核保中', '需要体检', '保单已批准', '佣金已结算']
  const activeStage = stageMap[order.status] ?? order.status
  const activeIndex = stageLabels.includes(activeStage) ? stageLabels.indexOf(activeStage) : 0
  const stages = stageLabels.map((label, index) => ({
    label,
    done: index <= activeIndex && order.status !== '客户有顾虑' && order.status !== '客户不感兴趣',
    color: order.status === '客户不感兴趣' && index === activeIndex ? 'red' : order.status === '客户有顾虑' && index === activeIndex ? 'red' : index < activeIndex ? 'green' : index === activeIndex ? 'blue' : 'gray',
  }))
  const brokerName = order.broker?.name ?? '待B端顾问接单'
  const orderTip = order.status === '已分配顾问'
    ? `B端顾问${brokerName}已接单，下一步应先联系A端推荐人对齐案情。`
    : order.status === '已提交'
      ? '工单已提交到工单大厅，等待B端顾问抢单或Admin分配。'
      : order.status === '客户有顾虑'
        ? '该工单需要关注，请及时查看处理记录并跟进。'
        : order.status === '佣金已结算'
          ? '该工单佣金已结算，A/B/平台分佣记录已生成。'
          : `当前进度：${order.status}。`

  return (
    <div className="order-drawer">
      <div className="order-drawer-head">
        <div className="order-title-row">
          <h2>{order.id}</h2>
          <span>{order.status}</span>
        </div>
        <p>创建于 {formatDateTime(order.createdAt)}</p>
        <button onClick={onClose} aria-label="关闭">
          <X size={20} />
        </button>
      </div>

      <div className="order-stage-row">
        {stages.map(({ label, done, color }, index) => (
          <div className="order-stage-item" key={label}>
            <div className={`order-stage-dot ${color}`}>
              {done ? <Check size={16} /> : <i />}
            </div>
            {index < stages.length - 1 && <span className={`order-stage-line ${done ? color : 'gray'}`} />}
            <strong className={label === activeStage ? 'active' : ''}>{label}</strong>
          </div>
        ))}
      </div>

      <div className="order-tip-card">{orderTip}</div>

      <section className="drawer-section">
        <h3>工单信息</h3>
        <div className="info-grid-card">
          <InfoItem label="客户姓名" value={order.customer.name} />
          <InfoItem label="B端顾问" value={brokerName} />
          <InfoItem label="保险需求" value={order.needType} />
          <InfoItem label="预估保费" value={order.premium} />
          <InfoItem label="产品类型" value={order.products} />
          <InfoItem label="合作档位" value={cooperationLabel(order.cooperationType ?? 'tier_50')} />
          <InfoItem label="创建时间" value={formatDateTime(order.createdAt)} />
        </div>
      </section>

      <section className="drawer-section">
        <h3 className="order-record-title">
          <CircleHelp size={18} />
          处理记录
        </h3>
        <div className="order-record-list">
          {order.timeline.map((item) => (
            <article key={`${item.title}-${item.time}`} className="order-record-item">
              <i className={`order-record-dot ${item.color}`} />
              <div className="order-record-line" />
              <div className="order-record-copy">
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
                <time>{item.time}</time>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="drawer-section">
        <button
          className="order-customer-card"
          type="button"
          aria-expanded={isCustomerOpen}
          onClick={() => setIsCustomerOpen((open) => !open)}
        >
          <span className="order-customer-icon">
            <UserIcon size={21} />
          </span>
          <span className="order-customer-copy">
            <strong>{order.customer.name}</strong>
            <span>{isCustomerOpen ? '收起完整客户信息' : '点击查看完整客户信息'}</span>
          </span>
          <ChevronRight className={isCustomerOpen ? 'expanded' : ''} size={20} />
        </button>

        {isCustomerOpen && (
          <div className="order-customer-detail">
            <div className="info-grid-card">
              <InfoItem label="客户姓名" value={order.customer.name || '—'} />
              <InfoItem label="联系电话" value={order.customer.phone || '—'} />
              <InfoItem label="年龄" value={order.customer.age || '—'} />
              <InfoItem label="性别" value={order.customer.gender || '—'} />
              <InfoItem label="现居城市" value={order.customer.city || '—'} />
              <InfoItem label="婚姻状况" value={order.customer.family || '—'} />
              <InfoItem label="子女情况" value={order.customer.children || '—'} />
              <InfoItem label="职业类型" value={order.customer.job || '—'} />
              <InfoItem label="家庭年收入范围" value={order.customer.income || '—'} />
              <InfoItem label="可投保资产规模" value={order.customer.assets || '—'} />
              <InfoItem label="需求类型" value={order.customer.need || order.needType || '—'} />
              <InfoItem label="偏好产品" value={order.customer.products || order.products || '—'} />
              <InfoItem label="预算范围" value={order.customer.budget || order.premium || '—'} />
              <InfoItem label="补充说明" value={order.customer.supplement || '—'} />
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function IntroPage({ onStart, onOpenCustomerDetail }: { onStart: () => void; onOpenCustomerDetail: (customer: CustomerRecord) => void }) {
  const [customerStats, setCustomerStats] = useState({ total: 0, following: 0, submitted: 0, monthly: 0 })
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    getCustomers({ search: searchQuery || undefined })
      .then((data) => {
        setCustomerStats({
          total: data.total ?? data.customers?.length ?? 0,
          following: data.following ?? 0,
          submitted: data.submitted ?? 0,
          monthly: data.monthly ?? 0,
        })
        setCustomers((data.customers ?? []).map((customer: any) => ({
          id: customer.id,
          name: customer.name ?? '',
          need: customer.need ?? '—',
          age: customer.age ?? '—',
          city: customer.city ?? '—',
          gender: customer.gender ?? '—',
          family: customer.family ?? '—',
          children: customer.children ?? '—',
          job: customer.job ?? '—',
          income: customer.income ?? '—',
          assets: customer.assets ?? '—',
          products: customer.products ?? '—',
          budget: customer.budget ?? '—',
          supplement: customer.supplement ?? '—',
          returnValue: customer.returnValue ?? '$0',
          createdAt: customer.created_at ?? customer.createdAt,
        })))
      })
      .catch(() => {
        // keep defaults on error
      })
  }, [searchQuery])

  return (
    <section className="intro-page">
      <div className="intro-page-head">
        <div className="intro-heading">
          <h1>介绍客户</h1>
          <p>说说客户情况，AI 自动录单，提交后等待 B 端顾问接单</p>
        </div>
        <button className="blue-btn intro-top-btn" onClick={onStart}>
          <UserRoundPlus size={20} />
          开始介绍客户
        </button>
      </div>

      <article className="card intro-stats-card">
        <div className="intro-stat">
          <span className="intro-stat-icon blue"><MessageCircle size={22} /></span>
          <div>
            <strong>全部</strong>
            <b>{customerStats.total}</b>
          </div>
        </div>
        <i className="intro-stat-divider" />
        <div className="intro-stat">
          <span className="intro-stat-icon blue"><MessageCircle size={22} /></span>
          <div>
            <strong>进行中</strong>
            <b>{customerStats.following}</b>
          </div>
        </div>
        <i className="intro-stat-divider" />
        <div className="intro-stat">
          <span className="intro-stat-icon green"><ClipboardList size={22} /></span>
          <div>
            <strong>已提交</strong>
            <b>{customerStats.submitted}</b>
          </div>
        </div>
        <i className="intro-stat-divider" />
        <div className="intro-stat">
          <span className="intro-stat-icon purple"><TrendingUpIcon /></span>
          <div>
            <strong>本月新增</strong>
            <b>{customerStats.monthly}</b>
          </div>
          </div>
      </article>

      <article className="card intro-list-card">
        <div className="intro-list-head">
          <h2>客户列表 · {customerStats.total} 位</h2>
          <div className="intro-list-tools">
            <label className="intro-search-box">
              <Search size={20} />
              <input placeholder="搜索客户姓名或需求" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
            </label>
            <button className="intro-filter-btn" type="button" onClick={() => setSearchQuery('')}>
              <Filter size={19} />
              重置
            </button>
          </div>
        </div>

        {customers.length > 0 ? (
          <div className="intro-customer-list">
            {customers.map((customer) => (
              <button className="intro-customer-row" key={customer.id ?? customer.name} onClick={() => onOpenCustomerDetail(customer)}>
                <span className="intro-customer-avatar">{customer.name.charAt(0) || '客'}</span>
                <div>
                  <strong>{customer.name}</strong>
                  <p>{customer.need} · {customer.city}</p>
                </div>
                <em>{customer.budget}</em>
                <ChevronRight size={18} />
              </button>
            ))}
          </div>
        ) : (
        <div className="intro-empty-state">
          <div className="intro-empty-icon">
            <MessageCircle size={54} />
          </div>
          <h3>开始你的第一次客户介绍</h3>
          <p>你只需要开个头，AI 会启发你一步步理清客户需求，录单后进入工单大厅。</p>

          <div className="intro-empty-steps">
            <article>
              <span>1</span>
              <strong>AI 帮你梳理</strong>
              <p>AI 会帮助你发现客户的真实需求</p>
            </article>
            <article>
              <span>2</span>
              <strong>B端接单</strong>
              <p>顾问在工单大厅看到脱敏案例后接单</p>
            </article>
            <article>
              <span>3</span>
              <strong>全程可追踪</strong>
              <p>B端顾问配合你跟进客户，每一步进展实时通知你</p>
            </article>
          </div>

          <button className="blue-btn intro-empty-btn" onClick={onStart}>
            <Plus size={18} />
            开始介绍客户
          </button>
        </div>
        )}
      </article>
    </section>
  )
}

function TrendingUpIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 15.5 10 10.5 13.5 14l5.5-5.5M15 8.5h4v4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function DollarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
      <text x="12" y="18" textAnchor="middle" fill="currentColor" fontSize="16" fontWeight="bold">$</text>
    </svg>
  )
}

function stringifyExtractionValue(value: unknown): string | null {
  if (value == null) return null
  if (Array.isArray(value)) {
    return value.map(stringifyExtractionValue).filter(Boolean).join('、') || null
  }
  if (typeof value === 'object') {
    const text = Object.values(value as Record<string, unknown>)
      .map(stringifyExtractionValue)
      .filter(Boolean)
      .join('、')
    return text || null
  }
  const text = String(value).trim()
  return text || null
}

const extractionKeyAliases: Record<string, string> = {
  marital_status: 'family',
  occupation: 'job',
  annual_income: 'income',
  insurable_assets: 'assets',
  insurance_needs: 'need',
  annual_budget: 'budget',
  referral_consent: 'consent',
  refer_to_b_side_advisor: 'consent',
}

function normalizeCustomerExtraction(
  text: string,
  incoming: Record<string, unknown> = {},
  current: Record<string, string | null> = {},
) {
  const next: Record<string, string | null> = { ...current }

  for (const [key, value] of Object.entries(incoming)) {
    const normalizedKey = extractionKeyAliases[key] || key
    const textValue = stringifyExtractionValue(value)
    if (textValue) {
      next[normalizedKey] = textValue
    }
  }

  const t = text

  // 姓名
  const nameMatch = t.match(/客户(?:叫|是|姓)?[\s:：]*([一-龥]{1,4})(?:先生|女士)?/) ||
                    t.match(/([一-龥]{1,4})(?:先生|女士)/)
  if (!next.name && nameMatch) next.name = nameMatch[1]

  // 年龄
  const ageMatch = t.match(/(\d{1,2})\s*[岁周岁]/)
  if (!next.age && ageMatch) next.age = `${ageMatch[1]}岁`

  // 性别（多种说法）
  if (!next.gender) {
    if (/[,，。\s]男[\s,，。]/.test(t) || t.includes('性别男') || t.includes(',男') || t.endsWith('男')) next.gender = '男'
    else if (/[,，。\s]女[\s,，。]/.test(t) || t.includes('性别女') || t.includes(',女') || t.endsWith('女')) next.gender = '女'
    else if (t.includes('先生')) next.gender = '男'
    else if (t.includes('女士')) next.gender = '女'
  }

  // 城市
  const cities = ['上海', '北京', '深圳', '广州', '杭州', '成都', '武汉', '南京', '苏州', '西安', '重庆', '天津',
                  '多伦多', '温哥华', '列治文', '密西沙加', '卡尔加里', '蒙特利尔', '渥太华']
  if (!next.city) {
    next.city = cities.find((city) => t.includes(city)) ?? null
  }

  // 婚姻状况
  if (!next.family) {
    if (t.includes('未婚')) next.family = '未婚'
    else if (t.includes('已婚')) next.family = '已婚'
    else if (t.includes('离婚')) next.family = '离婚'
    else if (t.includes('单身')) next.family = '单身'
    else if (t.includes('丧偶')) next.family = '丧偶'
    else if (t.includes('家庭') || t.includes('夫妻') || t.includes('配偶')) next.family = '已婚'
    else if (/\bmarried\b/i.test(t)) next.family = '已婚'
    else if (/\bsingle\b/i.test(t)) next.family = '未婚'
  }

  // 子女
  if (!next.children) {
    const childMatch = t.match(/(\d+|一|二|两|三|四|五)[个位]?(?:个)?(?:孩子|小孩|子女|娃)/)
    if (childMatch) next.children = `${childMatch[1]}个子女`
    else if (t.includes('儿子') || t.includes('女儿') || t.includes('有孩')) next.children = '有子女，年龄待确认'
    else if (t.includes('无孩') || t.includes('没孩子') || t.includes('无子女')) next.children = '无子女'
  }

  // 联系电话，用于客户保护期锁定。
  if (!next.phone) {
    const phoneMatch = t.match(/(?:手机号|手机|电话|联系电话)?[\s:：]*(\+?\d[\d\s\-()]{7,}\d)/)
    if (phoneMatch) next.phone = phoneMatch[1].trim()
  }

  // 职业（支持"做XX""从事XX""XX行业"等）
  if (!next.job) {
    const jobPatterns = [
      /(?:做|从事|干)[\s:：]*([一-龥]{2,8})(?:工作|行业|领域|岗位)?/,
      /职业[\s:：是为]*([一-龥]{2,8})/,
      /工作[\s:：是为]*([一-龥]{2,8})/,
      /([一-龥]{2,8})(?:工程师|程序员|设计师|开发|经理|主管|总监|销售|运营|产品经理|教师|医生|律师|会计|财务|护士|顾问)/,
    ]
    for (const pattern of jobPatterns) {
      const m = t.match(pattern)
      if (m) { next.job = m[1]; break }
    }
    if (!next.job) {
      const englishJobs = ['accountant', 'engineer', 'lawyer', 'doctor', 'teacher', 'broker', 'consultant', 'developer', 'manager']
      const foundJob = englishJobs.find((item) => new RegExp(`\\b${item}\\b`, 'i').test(t))
      if (foundJob) next.job = foundJob
    }
    // 常见职业关键词兜底
    const keywords = ['IT', '互联网', '金融', '房地产', '教育', '医疗', '制造业', '公务员', '自由职业', '程序员', '设计师', '销售', '运营', '产品经理']
    if (!next.job) {
      const kw = keywords.find((k) => t.includes(k))
      if (kw) next.job = kw
    }
  }

  // 收入（多种说法：月薪、月收入、一个月、工资、年薪、年收入）
  if (!next.income) {
    const incomePatterns = [
      /(?:月薪|月收入|一个月|工资)[\s:：约]*([\d,.]+(?:万|千|k|K)?)/,
      /(?:年薪|年收入)[\s:：约]*([\d,.]+(?:万|千|k|K)?)/,
      /收入[\s:：约]*([\d,.]+(?:万|千|k|K)?)/,
      /annual income[^\d]*([\d,.]+)/i,
      /family annual income[^\d]*([\d,.]+)/i,
    ]
    for (const pattern of incomePatterns) {
      const m = t.match(pattern)
      if (m) {
        const val = m[1].replace(/,/g, '')
        // 如果提到月薪/一个月，自动乘12
        const isMonthly = t.includes('月薪') || t.includes('月收入') || t.includes('一个月') || t.includes('工资')
        if (isMonthly && !val.includes('万') && parseInt(val) < 100000) {
          const monthly = parseInt(val)
          const yearly = monthly * 12
          next.income = yearly >= 10000 ? `${(yearly / 10000).toFixed(1)}万/年` : `${yearly}元/年`
        } else {
          next.income = val.includes('万') || val.includes('k') || val.includes('K') ? `${val}/年` : `${val}元/年`
        }
        break
      }
    }
  }

  // 资产
  if (!next.assets) {
    const assetPatterns = [
      /(?:资产|可投保|投资|存款|储蓄)[\s:：约]*([\d,.]+(?:万|千|k|K)?)/,
      /(?:有|大概|大约|约)([\d,.]+(?:万|千|k|K)?)[\s:：]*(?:资产|存款|储蓄|投资)/,
      /insurable assets[^\d]*([\d,.]+)/i,
    ]
    for (const pattern of assetPatterns) {
      const m = t.match(pattern)
      if (m) { next.assets = m[1]; break }
    }
  }

  // 预算
  if (!next.budget) {
    const budgetPatterns = [
      /(?:预算|保费|每年|一年)[\s:：约]*([\d,.]+(?:万|千|k|K)?)/,
      /(?:愿意|想|打算|计划)(?:花|出|付|投)[\s:：约]*([\d,.]+(?:万|千|k|K)?)/,
      /annual budget[^\d]*([\d,.]+)/i,
    ]
    for (const pattern of budgetPatterns) {
      const m = t.match(pattern)
      if (m) { next.budget = `年预算 ${m[1]}`; break }
    }
  }

  // 需求类型
  if (!next.need) {
    if (t.includes('重疾')) next.need = '重疾险需求'
    else if (t.includes('医疗') || t.includes('健康险')) next.need = '医疗险需求'
    else if (t.includes('养老')) next.need = '养老规划'
    else if (t.includes('教育')) next.need = '教育金保险'
    else if (t.includes('家庭') || t.includes('全家')) next.need = '家庭综合保障'
    else if (t.includes('意外')) next.need = '意外险需求'
    else if (t.includes('寿险') || t.includes('人寿')) next.need = '寿险需求'
    else if (t.includes('车险')) next.need = '车险需求'
  }

  // 意向产品
  if (!next.products) {
    if (t.includes('重疾')) next.products = '重疾险'
    else if (t.includes('医疗') || t.includes('健康险')) next.products = '医疗险'
    else if (t.includes('养老')) next.products = '年金险'
    else if (t.includes('教育')) next.products = '教育金'
    else if (t.includes('家庭') || t.includes('全家')) next.products = '家庭保障方案'
    else if (t.includes('意外')) next.products = '意外险'
    else if (t.includes('寿险') || t.includes('人寿')) next.products = '寿险'
    else if (t.includes('车险')) next.products = '车险'
  }

  return next
}

/** 将 AI 回复中的 Markdown 转换为 HTML */
function formatAIMessage(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^(\s*)[-*]\s+/gm, '$1• ')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>')
}

function IntroComposePage({ onBack, onComplete }: { onBack: () => void; onComplete: () => void }) {
  const [message, setMessage] = useState('')
  const [conversation, setConversation] = useState<Array<{ from: 'user' | 'ai'; text: string }>>([])
  const [extracted, setExtracted] = useState<Record<string, string | null>>({})
  const [suggestionVisible, setSuggestionVisible] = useState(true)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [composeNotice, setComposeNotice] = useState('')
  const [isAILoading, setIsAILoading] = useState(false)
  const [createOrderLoading, setCreateOrderLoading] = useState(false)
  const [orderCreated, setOrderCreated] = useState(false)
  const [cooperationType, setCooperationType] = useState<'tier_20' | 'tier_50' | 'tier_70'>('tier_50')
  const [urgency, setUrgency] = useState<'普通' | '高' | '紧急'>('普通')
  const [consentConfirmed, setConsentConfirmed] = useState(false)
  const chatThreadRef = useRef<HTMLDivElement | null>(null)

  const basicFields = [
    ['客户姓名', extracted.name ?? null],
    ['年龄', extracted.age ?? null],
    ['性别', extracted.gender ?? null],
    ['现居城市', extracted.city ?? null],
    ['婚姻状况', extracted.family ?? null],
    ['子女数量及年龄', extracted.children ?? null],
    ['职业类型', extracted.job ?? null],
    ['家庭年收入范围', extracted.income ?? null],
    ['可投保/投资资产规模', extracted.assets ?? null],
  ] as const

  const chips = ['客户想买重疾险', '家庭保障方案咨询', '车险续保需求'] as const
  const completeCount = basicFields.filter(([, value]) => value != null && value !== '必填 *').length
  const canCreateOrder = completeCount >= 6 && consentConfirmed

  // Auto-scroll to bottom when conversation updates
  useEffect(() => {
    if (chatThreadRef.current) {
      chatThreadRef.current.scrollTop = chatThreadRef.current.scrollHeight
    }
  }, [conversation, isAILoading])

  useEffect(() => {
    createConversation()
      .then((data) => {
        if (data.conversationId) {
          setConversationId(data.conversationId)
        }
      })
      .catch(() => {
        setComposeNotice('AI 服务连接失败，将使用本地模式处理')
      })
  }, [])

  const applyCustomerText = async (text: string) => {
    // Add user message immediately
    setConversation((items) => [...items, { from: 'user', text }])
    setMessage('')
    setSuggestionVisible(false)
    setIsAILoading(true)
    setComposeNotice('')

    if (!conversationId) {
      // fallback to local extraction if no conversation yet
      const nextExtracted = normalizeCustomerExtraction(text, {}, extracted)
      setExtracted(nextExtracted)
      setConversation((items) => [
        ...items,
        { from: 'ai', text: '已收到，我先提取了客户基础信息。还需要确认城市、家庭结构、收入和可投保资产后，就可以生成工单。' },
      ])
      setIsAILoading(false)
      return
    }

    try {
      const result = await sendAIMessage(conversationId, text)
      // Prioritize backend extracted data, fallback to local extraction
      const backendExtracted = result.extracted ?? {}
      const localExtracted = normalizeCustomerExtraction(text, {}, extracted)
      const mergedExtracted: Record<string, string | null> = { ...extracted }

      // Backend data takes priority
      for (const [key, value] of Object.entries(backendExtracted)) {
        const normalizedKey = extractionKeyAliases[key] || key
        const textValue = stringifyExtractionValue(value)
        if (textValue) {
          mergedExtracted[normalizedKey] = textValue
        }
      }
      // Local extraction fills gaps
      for (const [key, value] of Object.entries(localExtracted)) {
        if (!(key in mergedExtracted) || mergedExtracted[key] == null) {
          const textValue = stringifyExtractionValue(value)
          if (textValue) {
            mergedExtracted[key] = textValue
          }
        }
      }

      setExtracted(mergedExtracted)
      setConversation((items) => [
        ...items,
        {
          from: 'ai',
          text:
            result.reply ??
            '已收到，我先提取了客户基础信息。还需要确认城市、家庭结构、收入和可投保资产后，就可以生成工单。',
        },
      ])
    } catch (err: any) {
      const nextExtracted = normalizeCustomerExtraction(text, {}, extracted)
      setExtracted(nextExtracted)
      setConversation((items) => [
        ...items,
        {
          from: 'ai',
          text:
            err?.response?.data?.message ??
            'AI 服务暂时不可用，已使用本地模式提取信息。请稍后重试或继续补充客户信息。',
        },
      ])
    } finally {
      setIsAILoading(false)
    }
  }

  const handleSend = () => {
    const trimmed = message.trim()
    if (trimmed && !isAILoading) {
      void applyCustomerText(trimmed)
    }
  }

  const handleCreateOrder = async () => {
    if (!conversationId || !canCreateOrder || createOrderLoading || orderCreated) return
    setCreateOrderLoading(true)
    try {
      const result = await completeConversation(conversationId, { ...extracted, cooperationType, urgency })
      setOrderCreated(true)
      setComposeNotice(`客户信息已保存，工单 ${result.orderId} 已进入客户进度。`)
      setTimeout(() => onComplete(), 1200)
    } catch (err: any) {
      setComposeNotice(err?.response?.data?.message ?? '保存失败，请稍后重试')
    } finally {
      setCreateOrderLoading(false)
    }
  }

  return (
    <section className="intro-compose-page">
      <div className="intro-compose-head">
        <div>
          <button className="intro-back-btn" onClick={onBack}>
            <ArrowLeft size={22} />
            <span>张先生 - 人寿保险咨询</span>
            <i />
            <em>草稿录入中</em>
          </button>
          <p>说说客户的情况，AI 帮你自动整理信息</p>
        </div>
        <button className="intro-more-btn" aria-label="更多" onClick={() => setComposeNotice('已保存的客户可以在「客户进度」中查看跟进状态。')}>
          <MoreVertical size={22} />
        </button>
      </div>

      <div className="intro-compose-grid">
        <article className="card compose-chat-card">
          {suggestionVisible && (
            <div className="compose-suggestion">
              <Sparkles size={19} />
              <strong>试试这样说： '客户王先生，35岁，想给家人配置重疾险，预算每年1万左右'</strong>
              <button aria-label="关闭提示" onClick={() => setSuggestionVisible(false)}>
                <X size={18} />
              </button>
            </div>
          )}

          <div ref={chatThreadRef} className={conversation.length ? 'compose-chat-thread' : 'compose-empty-panel'}>
            {conversation.length ? (
              <>
                {conversation.map((item, index) => (
                  <div className={`compose-message ${item.from}`} key={`${item.from}-${index}`}>
                    <span>
                      {item.from === 'ai' && <Sparkles size={14} />}
                      {item.from === 'ai' ? 'AI 助手' : '我'}
                    </span>
                    {item.from === 'ai' ? (
                      <p dangerouslySetInnerHTML={{ __html: formatAIMessage(item.text) }} />
                    ) : (
                      <p>{item.text}</p>
                    )}
                  </div>
                ))}
                {isAILoading && (
                  <div className="compose-message ai loading">
                    <span><Sparkles size={14} /> AI 助手</span>
                    <div className="ai-typing-dots">
                      <i />
                      <i />
                      <i />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="compose-empty-icon">
                  <MessageCircle size={56} />
                </div>
                <h2>描述客户情况，AI 帮你录入</h2>
                <p>比如"我有个朋友，40 岁，想给家庭做个保障规划"</p>
                <div className="compose-chip-row">
                  {chips.map((chip) => (
                    <button key={chip} type="button" onClick={() => setMessage(chip)} disabled={isAILoading}>
                      {chip}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {conversation.length > 0 && (
            <div className="compose-chip-row compact">
              {chips.map((chip) => (
                <button key={chip} type="button" onClick={() => setMessage(chip)} disabled={isAILoading}>
                  {chip}
                </button>
              ))}
            </div>
          )}

          <div className="compose-input-bar">
            <button className="compose-icon-btn" aria-label="附件" onClick={() => setComposeNotice('当前版本支持文字录入；附件上传将在资料审核流程中启用。')} disabled={isAILoading}>
              <Paperclip size={20} />
            </button>
            <input
              placeholder={isAILoading ? 'AI 正在思考中...' : '说说客户的情况，比如年龄、家庭、关心什么问题...'}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !isAILoading) handleSend()
              }}
              disabled={isAILoading}
            />
            <button className="compose-round-btn" aria-label="语音" onClick={() => setComposeNotice('语音输入将在移动端麦克风授权后启用；请先使用文字录入。')} disabled={isAILoading}>
              <Mic size={18} />
            </button>
            <button className="compose-round-btn primary" aria-label="发送" onClick={handleSend} disabled={!message.trim() || isAILoading}>
              <SendHorizontal size={18} />
            </button>
          </div>
          {composeNotice && <div className="compose-inline-notice">{composeNotice}</div>}
        </article>

        <article className="card compose-info-card">
          <div className="compose-info-head">
            <div>
              <h2>客户信息卡</h2>
              <span>AI 自动提取</span>
            </div>
            <button onClick={() => setComposeNotice('请继续在左侧对话中补充或修正客户信息，AI 会自动更新信息卡。')}>编辑</button>
          </div>

          <div className="compose-info-section">
            <h3>基本信息</h3>
            <div className="compose-field-grid">
              {basicFields.map(([label, value]) => (
                <div className={`compose-field-item ${value ? 'filled' : ''}`} key={label}>
                  <span>{label} *</span>
                  <strong>{value ?? '待补充'}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="compose-info-section collapsed">
            <h3>补充信息</h3>
          </div>

          <div className="compose-submit-controls">
            <label>
              佣金档位
              <select value={cooperationType} onChange={(event) => setCooperationType(event.target.value as 'tier_20' | 'tier_50' | 'tier_70')}>
                <option value="tier_20">20% Name Referral</option>
                <option value="tier_50">50% 主动参与</option>
                <option value="tier_70">70% 全程参与</option>
              </select>
            </label>
            <label>
              紧急程度
              <select value={urgency} onChange={(event) => setUrgency(event.target.value as '普通' | '高' | '紧急')}>
                <option value="普通">普通</option>
                <option value="高">高</option>
                <option value="紧急">紧急</option>
              </select>
            </label>
            <label className="compose-consent-row">
              <input type="checkbox" checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)} />
              <span>客户已同意我将需求转介给平台 B端保险顾问</span>
            </label>
          </div>

          <div className="compose-info-footer">
            <span>已完成 {completeCount}/9 项必填信息{!consentConfirmed ? ' · 需合规确认' : ''}</span>
            <button disabled={!canCreateOrder || createOrderLoading || orderCreated} onClick={handleCreateOrder}>
              {createOrderLoading ? (
                <>
                  <i className="btn-spinner" />
                  保存中...
                </>
              ) : orderCreated ? (
                '已提交'
              ) : (
                <>
                  保存客户信息 <ChevronRight size={18} />
                </>
              )}
            </button>
          </div>
        </article>
      </div>
    </section>
  )
}

function ProgressPage({
  onOpenCustomerDetail,
  onOpenExpertDetail,
  onOpenOrderDetail,
}: {
  onOpenCustomerDetail: (customer: CustomerRecord) => void
  onOpenExpertDetail: (expert: ExpertRecord) => void
  onOpenOrderDetail: (order: ProgressOrderRecord) => void
}) {
  const [activeTab, setActiveTab] = useState<'全部' | '跟进中' | '已完成' | '需关注'>('全部')
  const [orders, setOrders] = useState<ProgressOrderRecord[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [detailError, setDetailError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await getOrders({ search: searchQuery || undefined })
        if (!cancelled && data?.list) {
          setOrders(data.list)
        }
      } catch {
        // keep empty on error
      }
    }
    load()
    return () => { cancelled = true }
  }, [searchQuery])

  const displayOrders = orders

  const tabStatusMap: Record<string, string[]> = {
    '全部': ['已提交', '已分配顾问', '会议已安排', '沟通中', '客户有顾虑', '客户暂时搁置', '客户不感兴趣', '申请已提交', '核保中', '需要体检', '保单已批准', '佣金已结算'],
    '跟进中': ['已分配顾问', '会议已安排', '沟通中', '申请已提交', '核保中', '需要体检'],
    '已完成': ['保单已批准', '佣金已结算'],
    '需关注': ['客户有顾虑', '客户暂时搁置', '客户不感兴趣'],
  }

  const filteredOrders = displayOrders.filter((o) => tabStatusMap[activeTab].includes(o.status))

  const handleOpenOrderDetail = async (orderId: string) => {
    setDetailError('')
    try {
      const order = await getOrder(orderId)
      onOpenOrderDetail(order)
    } catch {
      setDetailError('工单详情暂时无法打开，请稍后重试。')
    }
  }

  return (
    <section className="progress-page">
      <div className="progress-page-head">
        <div>
          <h1>客户进度</h1>
          <p>查看你介绍的客户，B端顾问跟进到哪一步了</p>
        </div>
      </div>

      <article className="card progress-filter-card">
        <div className="progress-tabs">
          {(['全部', '跟进中', '已完成', '需关注'] as const).map((tab) => (
            <button
              key={tab}
              className={`${activeTab === tab ? 'active' : ''} ${tab === '需关注' ? 'dot' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="progress-tools">
          <label className="progress-search-box">
            <Search size={20} />
            <input placeholder="搜索客户或顾问" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
          </label>
          <button className="progress-filter-btn" type="button" onClick={() => setSearchQuery('')}>
            <Filter size={19} />
            重置
          </button>
        </div>
      </article>

      <article className="card progress-table-card">
        {detailError && <div className="messages-inline-notice">{detailError}</div>}
        <div className="progress-table-head">
          <span>客户信息</span>
          <span>B端顾问</span>
          <span>状态</span>
          <span>预估保费</span>
          <span>介绍时间</span>
          <span>详情</span>
        </div>
        {filteredOrders.length === 0 ? (
          <div className="progress-table-empty">暂无工单数据，先去「介绍客户」创建一位吧</div>
        ) : (
          filteredOrders.map((o: any) => (
            <div className="progress-table-row" key={o.id}>
              <div className="progress-customer-cell">
                <button type="button" onClick={() => onOpenCustomerDetail(o.customer)}>
                  {o.customer?.name || o.customerName}
                </button>
                <p>{o.needType}</p>
              </div>
              <div className="progress-expert-cell">
                <span>
                  <UserIcon size={20} />
                </span>
                {o.expert ? (
                  <button type="button" onClick={() => onOpenExpertDetail(o.expert)}>
                    {o.expert.name}
                  </button>
                ) : (
                  <strong>待匹配</strong>
                )}
              </div>
              <div>
                <span className={`progress-status-pill status-${o.status === '需关注' ? 'warning' : o.status === '已完成' ? 'success' : o.status === '跟进中' ? 'info' : 'default'}`}>
                  {o.status}
                </span>
              </div>
              <div className="progress-premium-cell">{o.premium}</div>
              <div className="progress-time-cell">{formatDateTime(o.createdAt)}</div>
              <div className="progress-link-cell">
                <button type="button" onClick={() => void handleOpenOrderDetail(o.id)}>
                  查看详情
                </button>
              </div>
            </div>
          ))
        )}
      </article>
    </section>
  )
}

function MessagesPage({ onOpenOrderDetail }: { onOpenOrderDetail: (order: ProgressOrderRecord) => void }) {
  const quickReplies = ['好的，收到', '客户的联系方式是...', '请问目前进展如何?'] as const
  const [draft, setDraft] = useState('')
  const [contacts, setContacts] = useState<any[]>([])
  const [activeContact, setActiveContact] = useState<string | null>(null)
  const [chatMessages, setChatMessages] = useState<any[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [contactTab, setContactTab] = useState<'全部' | '未读' | '已标记'>('全部')
  const [chatNotice, setChatNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await getContacts()
        if (!cancelled && data && data.length > 0) {
          setContacts(data)
          setActiveContact(data[0]?.id ?? null)
        }
      } catch {
        // keep empty on error
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!activeContact) return
    let cancelled = false
    async function load() {
      try {
        const data = await getMessages(activeContact!)
        if (!cancelled) {
          setChatMessages(data ?? [])
        }
      } catch {
        // keep empty on error
      }
    }
    load()
    return () => { cancelled = true }
  }, [activeContact])

  const activeContactData = contacts.find((c) => c.id === activeContact)
  const filteredContacts = contacts.filter((contact) => {
    const matchesSearch = !searchQuery || `${contact.name}${contact.lastMessage}${contact.orderTopic}`.includes(searchQuery)
    const matchesTab =
      contactTab === '全部' ||
      (contactTab === '未读' && Number(contact.unreadCount ?? 0) > 0) ||
      (contactTab === '已标记' && contact.starred)
    return matchesSearch && matchesTab
  })

  const handleSendMessage = async () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })

    if (activeContact) {
      try {
        await sendMessageApi(activeContact, trimmed, activeContactData?.orderTopic)
      } catch {
        // fallback: add locally
      }
    }

    setChatMessages((items) => [...items, { from: 'me', text: trimmed, time }])
    setContacts((items) => items.map((contact) => (
      contact.id === activeContact
        ? { ...contact, lastMessage: trimmed, time, customerStatus: contact.orderTopic ? '等待顾问回复' : contact.customerStatus }
        : contact
    )))
    setDraft('')
  }

  const handleOpenRelatedOrder = async () => {
    if (!activeContactData?.orderTopic) return
    try {
      const order = await getOrder(activeContactData.orderTopic)
      onOpenOrderDetail(order)
    } catch {
      setChatNotice('关联工单暂时无法打开，请稍后重试。')
    }
  }

  return (
    <section className="messages-page">
      <div className="messages-page-head">
        <h1>消息</h1>
        <p>和 A/B 对接方的沟通记录都在这里</p>
      </div>

      <article className="card messages-shell">
        <aside className="messages-sidebar">
          <label className="messages-search-box">
            <Search size={20} />
            <input placeholder="搜索联系人..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
          </label>

          <div className="messages-tabs">
            {(['全部', '未读', '已标记'] as const).map((tab) => (
              <button key={tab} className={contactTab === tab ? 'active' : ''} onClick={() => setContactTab(tab)}>{tab}</button>
            ))}
          </div>

          {filteredContacts.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#98a2b3' }}>
              暂无联系人
            </div>
          ) : (
            filteredContacts.map((contact) => (
              <button
                key={contact.id}
                className={`messages-contact ${activeContact === contact.id ? 'active' : ''}`}
                onClick={() => setActiveContact(contact.id)}
              >
                <span className="messages-contact-avatar">
                  <UserIcon size={22} />
                </span>
                <div className="messages-contact-main">
                  <div className="messages-contact-row">
                    <strong>{contact.name}</strong>
                    <time>{contact.time}</time>
                  </div>
                  <p>{contact.orderTopic ?? ''}</p>
                  <em>{contact.lastMessage}</em>
                </div>
              </button>
            ))
          )}
        </aside>

        <section className="messages-chat">
          {contacts.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gridRow: '1 / -1', color: '#98a2b3' }}>
              暂无消息，先去「介绍客户」创建一位吧
            </div>
          ) : (
            <>
              <div className="messages-chat-head">
                <div className="messages-chat-profile">
                  <span>
                    <UserIcon size={22} />
                  </span>
                  <strong>{activeContactData?.name ?? ''}</strong>
                </div>
                <div className="messages-chat-actions">
                  <button aria-label="通话" onClick={() => setChatNotice(`已发起与 ${activeContactData?.name ?? '顾问'} 的电话沟通请求。`)}>
                    <PhoneCall size={22} />
                  </button>
                  <button aria-label="更多" onClick={() => setChatNotice(activeContactData ? `联系人：${activeContactData.name}，关联工单：${activeContactData.orderTopic || '暂无'}` : '')}>
                    <MoreVertical size={22} />
                  </button>
                </div>
              </div>

              {chatNotice && <div className="messages-inline-notice">{chatNotice}</div>}

              <div className="messages-customer-card">
                <div>
                  <span>关联客户</span>
                  <div className="messages-customer-line">
                    <strong>{activeContactData?.customerName ?? '—'}</strong>
                    <em>{activeContactData?.customerStatus ?? ''}</em>
                  </div>
                  <p>{activeContactData?.customerSummary ?? ''}</p>
                </div>
                <button onClick={() => void handleOpenRelatedOrder()}>
                  查看客户详情
                  <ChevronRight size={18} />
                </button>
              </div>

              <div className="messages-chat-body">
                <div className="messages-day-divider">
                  <i />
                  <span>今天</span>
                  <i />
                </div>

                {chatMessages.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#98a2b3', padding: '40px 0' }}>
                    暂无消息记录
                  </div>
                ) : (
                  chatMessages.map((item, index) => (
                    <div className={`message-row ${item.from === 'me' ? 'right' : 'left'}`} key={`${item.time}-${index}`}>
                      {item.from !== 'me' && (
                        <span className="message-avatar">
                          <UserIcon size={18} />
                        </span>
                      )}
                      <div>
                        <div className={`message-bubble ${item.from === 'me' ? 'self' : ''}`}>{item.text}</div>
                        <time>{item.time}</time>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="messages-quick-replies">
                <span>快捷回复</span>
                <div>
                  {quickReplies.map((reply) => (
                    <button key={reply} onClick={() => setDraft(reply)}>{reply}</button>
                  ))}
                </div>
              </div>

              <div className="messages-input-row">
                <button className="messages-clip-btn" aria-label="附件" onClick={() => setChatNotice('当前会话支持文字沟通；附件发送将在资料审核流程中启用。')}>
                  <Paperclip size={20} />
                </button>
                <input
                  placeholder="输入消息..."
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleSendMessage()
                  }}
                />
                <button className="messages-round-btn" aria-label="语音" onClick={() => setChatNotice('语音消息将在移动端麦克风授权后启用；请先发送文字消息。')}>
                  <Mic size={18} />
                </button>
                <button className="messages-send-btn" aria-label="发送" onClick={handleSendMessage} disabled={!draft.trim()}>
                  <SendHorizontal size={18} />
                </button>
              </div>
            </>
          )}
        </section>
      </article>
    </section>
  )
}

function TeamPage({ onInvite, onOpenMemberDetail }: { onInvite: () => void; onOpenMemberDetail: (member: TeamMemberRecord) => void }) {
  const [activeTab, setActiveTab] = useState<'成员' | '收益明细'>('成员')
  const [searchQuery, setSearchQuery] = useState('')
  const [members, setMembers] = useState<TeamMemberRecord[]>([])
  const [earnings, setEarnings] = useState<any[]>([])
  const [overview, setOverview] = useState({ memberCount: 0, monthlyReferrals: 0, monthlyOverride: '$0' })

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const overviewData = await getTeamOverview()
        if (!cancelled) {
          setOverview({
            memberCount: overviewData.memberCount ?? 0,
            monthlyReferrals: overviewData.monthlyReferrals ?? 0,
            monthlyOverride: overviewData.monthlyOverride ?? '$0',
          })
        }
      } catch {
        // keep empty overview on error
      }
      try {
        const data = await getTeamMembers()
        if (!cancelled) {
          setMembers(data ?? [])
        }
      } catch {
        if (!cancelled) setMembers([])
      }
      try {
        const earningsData = await getTeamEarnings()
        if (!cancelled) {
          setEarnings(earningsData ?? [])
        }
      } catch {
        if (!cancelled) setEarnings([])
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const filteredMembers = members.filter((m) => m.name.includes(searchQuery))

  return (
    <section className="team-page">
      <div className="team-page-head">
        <button className="team-back-btn" onClick={() => window.history.back()}>
          <ArrowLeft size={18} />
          返回工作台
        </button>
        <div className="team-page-title-row">
          <div>
            <h1>我的团队</h1>
            <p className="team-page-subtitle">这里展示你邀请加入的介绍人团队；客户工单由 B 端顾问池接单或由 Admin 指派。</p>
          </div>
          <button className="team-invite-btn" onClick={onInvite}>
            <UserRoundPlus size={18} />
            邀请新成员
          </button>
        </div>
      </div>

      <div className="team-stats-row">
        <div className="team-stat-card">
          <span><UserIcon size={20} /> 团队成员</span>
          <strong>{overview.memberCount} <em>人</em></strong>
        </div>
        <div className="team-stat-card">
          <span><TrendingUpIcon /> 本月团队介绍</span>
          <strong>{overview.monthlyReferrals} <em>位客户</em></strong>
        </div>
        <div className="team-stat-card">
          <span><DollarIcon /> 本月 override</span>
          <strong className="green">{overview.monthlyOverride}</strong>
        </div>
      </div>

      <article className="card team-table-card">
        <div className="team-tabs">
          {(['成员', '收益明细'] as const).map((tab) => (
            <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>
              {tab}
              {tab === '收益明细' && <i className="team-tab-dot" />}
            </button>
          ))}
        </div>

        {activeTab === '成员' && (
          <>
            <label className="team-search-box">
              <Search size={18} />
              <input placeholder="搜索成员姓名" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </label>
            <div className="team-table">
              <div className="team-table-head">
                <span>成员姓名</span>
                <span>加入时间</span>
                <span>级别</span>
                <span>介绍数</span>
                <span>成交数</span>
                <span>贡献收入</span>
                <span>状态</span>
              </div>
              {filteredMembers.length === 0 ? (
                <div className="team-empty-state">暂无团队成员。这里不会显示 B 端顾问，客户工单会进入工单大厅等待接单。</div>
              ) : filteredMembers.map((m) => (
                <div className="team-table-row" key={m.id} onClick={() => onOpenMemberDetail(m)}>
                  <div className="team-member-cell">
                    <span className="team-avatar">{m.avatar}</span>
                    <strong>{m.name}</strong>
                  </div>
                  <span>{m.joinDate}</span>
                  <span>{m.level}</span>
                  <span>{m.referrals}</span>
                  <span>{m.deals}</span>
                  <span className="team-contribution">{m.contribution}</span>
                  <span className={`team-status-pill ${m.status === '活跃' ? 'active' : 'new'}`}>{m.status}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {activeTab === '收益明细' && (
          <div className="team-table">
            <div className="team-table-head">
              <span>成员姓名</span>
              <span>订单号</span>
              <span>客户类型</span>
              <span>Override 收益</span>
              <span>日期</span>
              <span>状态</span>
            </div>
            {earnings.length === 0 ? (
              <div className="team-empty-state">暂无收益明细。</div>
            ) : earnings.map((e, i) => (
              <div className="team-table-row" key={i}>
                <div className="team-member-cell">
                  <span className="team-avatar">{e.avatar}</span>
                  <strong>{e.member}</strong>
                </div>
                <span>{e.orderId}</span>
                <span>{e.type}</span>
                <span className="team-contribution">{e.override}</span>
                <span>{e.date}</span>
                <span className={`team-status-pill ${e.status === '已结算' ? 'active' : 'pending'}`}>{e.status}</span>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  )
}

function InviteMemberPage({ onBack }: { onBack: () => void }) {
  const [inviteInfo, setInviteInfo] = useState<{ inviteUrl?: string; inviteCode?: string; inviterName?: string } | null>(null)
  const [qrUrl, setQrUrl] = useState('')
  const [shareStatus, setShareStatus] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await getInviteInfo()
        if (!cancelled && data) {
          setInviteInfo(data)
        }
      } catch {
        // keep null on error
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const inviteUrl = inviteInfo?.inviteUrl ?? ''
  const inviterName = inviteInfo?.inviterName ?? ''

  useEffect(() => {
    if (!inviteUrl) return
    QRCode.toDataURL(inviteUrl, { margin: 1, width: 220 })
      .then(setQrUrl)
      .catch(() => setQrUrl(''))
  }, [inviteUrl])

  const shareInvite = async (channel: '微信' | '邮件') => {
    if (!inviteUrl) return
    const text = `${inviterName || '我'} 邀请你加入保险智能获客团队：${inviteUrl}`
    if (channel === '邮件') {
      window.location.href = `mailto:?subject=${encodeURIComponent('加入保险智能获客团队')}&body=${encodeURIComponent(text)}`
      return
    }
    await navigator.clipboard.writeText(text)
    setShareStatus('微信分享文案已复制')
  }

  return (
    <section className="invite-member-page">
      <button className="team-back-btn" onClick={onBack}>
        <ArrowLeft size={18} />
        返回我的团队
      </button>
      <h1>邀请新成员</h1>
      <p>分享邀请链接，邀请新成员加入你的团队，共同发展保险业务。</p>

      <div className="invite-member-card">
        <h3>专属邀请链接</h3>
        <div className="invite-link-row">
          <div className="invite-link-box">{inviteUrl || '加载中...'}</div>
          <button className="invite-copy-btn orange" type="button" disabled={!inviteUrl} onClick={() => {
            if (inviteUrl) void navigator.clipboard.writeText(inviteUrl).then(() => setShareStatus('邀请链接已复制'))
          }}>
            <Copy size={18} />
            复制链接
          </button>
        </div>
        <div className="invite-share-row">
          <button className="invite-share-btn" disabled={!inviteUrl} onClick={() => void shareInvite('微信')}><Share2 size={16} /> 微信分享</button>
          <button className="invite-share-btn" disabled={!inviteUrl} onClick={() => void shareInvite('邮件')}><Share2 size={16} /> 邮件分享</button>
        </div>
        {shareStatus && <div className="invite-copy-status">{shareStatus}</div>}
      </div>

      <div className="invite-member-card">
        <h3>邀请二维码</h3>
        <div className="invite-qr-placeholder">
          <div className="invite-qr-box">{qrUrl ? <img src={qrUrl} alt="邀请二维码" /> : '加载中...'}</div>
        </div>
        <p className="invite-qr-tip">扫描二维码，快速加入团队</p>
      </div>

      <div className="invite-member-card preview-card">
        <h3>邀请页面预览</h3>
        <div className="invite-preview-box">
          <div className="invite-preview-inner">
            <div className="invite-preview-logo">保</div>
            <h2>加入我的团队</h2>
            <p>{inviterName || '—'} 邀请你加入团队，共同发展保险业务</p>
            <div className="invite-preview-benefits">
              <h4>团队优势</h4>
              <ul>
                <li>专业培训与资源支持</li>
                <li>共享客户资源与案例</li>
                <li>持续的业务指导与帮助</li>
              </ul>
            </div>
            <button className="invite-preview-join" onClick={() => {
              if (inviteUrl) window.open(inviteUrl, '_blank', 'noopener,noreferrer')
            }}>立即加入</button>
          </div>
        </div>
        <p className="invite-preview-note">以上为受邀者看到的页面预览</p>
      </div>

      <div className="invite-member-card info-card">
        <h3>邀请说明</h3>
        <ul>
          <li>每位团队成员都有专属的邀请链接，可追踪邀请来源</li>
          <li>新成员通过链接注册后，自动加入你的团队</li>
          <li>团队成员的业绩会为你带来 override 收益</li>
          <li>你可以在「我的团队」中查看所有成员及其业绩</li>
        </ul>
      </div>
    </section>
  )
}

function MemberDrawerContent({ member }: { member: TeamMemberRecord }) {
  return (
    <div className="member-drawer">
      <div className="member-drawer-header">
        <span className="member-drawer-avatar">{member.avatar}</span>
        <div>
          <h3>{member.name}</h3>
          <p>加入时间：{member.joinDate}</p>
          <span className={`team-status-pill ${member.status === '活跃' ? 'active' : 'new'}`}>{member.level}</span>
        </div>
      </div>

      <div className="member-drawer-section">
        <div className="member-drawer-info-row">
          <span>手机号码</span>
          <strong>{member.phone}</strong>
        </div>
        <div className="member-drawer-info-row">
          <span>邮箱地址</span>
          <strong>{member.email}</strong>
        </div>
      </div>

      <div className="member-drawer-section">
        <h4>业绩统计</h4>
        <div className="member-drawer-stats">
          <div>
            <span>总介绍数</span>
            <strong>{member.referrals}</strong>
          </div>
          <div>
            <span>成交数</span>
            <strong>{member.deals}</strong>
          </div>
        </div>
        <div className="member-drawer-total">
          <span>累计贡献收入</span>
          <strong className="green">{member.contribution}</strong>
        </div>
      </div>

      <div className="member-drawer-section">
        <div className="member-drawer-info-row">
          <span>最近活动</span>
          <strong>{member.lastActive}</strong>
        </div>
        <div className="member-drawer-info-row">
          <span>当前状态</span>
          <span className={`team-status-pill ${member.status === '活跃' ? 'active' : 'new'}`}>{member.status}</span>
        </div>
      </div>

      {member.recentOrders.length > 0 && (
        <div className="member-drawer-section">
          <h4>最近订单</h4>
          <div className="member-drawer-orders">
            {member.recentOrders.map((order) => (
              <div className="member-order-item" key={order.id}>
                <div>
                  <strong>{order.id}</strong>
                  <span className={`team-status-pill ${order.status === '已结算' ? 'active' : 'pending'}`}>{order.status}</span>
                </div>
                <p>{order.type}</p>
                <div className="member-order-footer">
                  <span>{order.date}</span>
                  <strong className="green">{order.amount}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function LearningCenterPage() {
  const courses = [
    { title: '快速上手：介绍第一位客户', duration: '12:30', desc: '学习如何用 AI 录入客户、补齐信息并生成工单。' },
    { title: '客户进度与顾问协作', duration: '8:15', desc: '理解工单状态、顾问消息和进度跟进。' },
    { title: '邀请链接与团队增长', duration: '6:42', desc: '设置邀请链接，追踪团队成员与收益。' },
  ]
  const [activeCourse, setActiveCourse] = useState('')

  return (
    <section className="learning-center-page">
      <div className="learning-center-head">
        <h1>学习中心</h1>
        <p>平台教程、客户介绍方法和团队增长指南。</p>
      </div>
      <div className="learning-course-grid">
        {courses.map((course) => (
          <article className="card learning-course-card" key={course.title}>
            <div className="course-banner small">
              <span className="play-button" aria-hidden="true"><Play size={34} /></span>
              <span className="video-time main">{course.duration}</span>
            </div>
            <h2>{course.title}</h2>
            <p>{course.desc}</p>
            <button className="blue-btn" type="button" onClick={() => setActiveCourse(course.title)}>
              {activeCourse === course.title ? '学习中' : '开始学习'}
            </button>
          </article>
        ))}
      </div>
      {activeCourse && <div className="learning-status">已开始学习：{activeCourse}</div>}
    </section>
  )
}

function ProfilePage() {
  const [profile, setProfile] = useState<Record<string, any> | null>(null)
  const [notificationSettings, setNotificationSettings] = useState<Record<string, boolean> | null>(null)
  const [inviteStats, setInviteStats] = useState({ inviteCount: 0, inviteEarnings: 0 })

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await getProfile()
        if (!cancelled) {
          setProfile(data)
        }
      } catch {
        // keep null on error
      }
      try {
        const settings = await getNotificationSettings()
        if (!cancelled) {
          setNotificationSettings(settings)
        }
      } catch {
        // keep null on error
      }
      try {
        const inviteData = await getInviteInfo()
        if (!cancelled && inviteData) {
          setInviteStats({
            inviteCount: inviteData.inviteCount ?? 0,
            inviteEarnings: inviteData.inviteEarnings ?? 0,
          })
        }
      } catch {
        // keep defaults on error
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const displayName = profile?.name ?? ''
  const displayEmail = profile?.email ?? ''
  const displayPhone = profile?.phone ?? ''
  const displayCity = profile?.city ?? ''

  const basicInfo: [string, string][] = [
    ['姓名', displayName || '—'],
    ['手机', displayPhone || '—'],
    ['邮箱', displayEmail || '—'],
    ['所在地区', displayCity || '—'],
  ]

  const notifications: [string, boolean][] = notificationSettings
    ? [
        ['客户匹配成功通知', notificationSettings.matchSuccess ?? true],
        ['顾问反馈通知', notificationSettings.expertFeedback ?? true],
        ['回报到账通知', notificationSettings.payoutReceived ?? true],
        ['平台公告', notificationSettings.platformAnnouncement ?? false],
      ]
    : [
        ['客户匹配成功通知', true],
        ['顾问反馈通知', true],
        ['回报到账通知', true],
        ['平台公告', false],
      ]

  const handleToggleNotification = async (key: string, currentValue: boolean) => {
    const next = { ...notificationSettings, [key]: !currentValue }
    setNotificationSettings(next)
    try {
      await updateNotificationSettings(next)
    } catch {
      // revert on error
      setNotificationSettings((prev) => prev)
    }
  }

  const handleUpdateProfile = async (field: string, value: string) => {
    const next = { ...profile, [field]: value }
    setProfile(next)
    try {
      await updateProfile(next)
    } catch {
      // revert on error
      setProfile((prev) => prev)
    }
  }

  const qualifications: string[] = profile?.qualifications ?? []

  const handleAddCertification = async () => {
    const name = window.prompt('添加资质名称')
    if (!name?.trim()) return
    await addCertification(name.trim())
    setProfile((current) => ({
      ...current,
      qualifications: [...(current?.qualifications ?? []), name.trim()],
    }))
  }

  const handleChangePassword = async () => {
    const oldPassword = window.prompt('请输入当前密码')
    if (!oldPassword) return
    const newPassword = window.prompt('请输入新密码（至少 6 位）')
    if (!newPassword || newPassword.length < 6) {
      window.alert('新密码至少需要 6 位')
      return
    }
    try {
      await changePassword(oldPassword, newPassword)
      window.alert('密码已更新')
    } catch {
      window.alert('原密码不正确，修改失败')
    }
  }

  return (
    <section className="profile-page">
      <h1>个人中心</h1>

      <article className="card profile-hero-card">
        <div className="profile-avatar-wrap">
          <span className="profile-avatar">
            <UserIcon size={50} />
          </span>
          <i className="profile-edit-badge">
            <FileText size={14} />
          </i>
        </div>
        <strong>{displayName || '—'}</strong>
        <p>{displayEmail || '—'}</p>
        <div className="profile-tags">
          {qualifications.length > 0 ? (
            qualifications.map((q) => <span key={q}>{q}</span>)
          ) : (
            <span style={{ color: '#98a2b3', fontWeight: 400 }}>暂无资质标签</span>
          )}
        </div>
      </article>

      <article className="card profile-card">
        <div className="profile-card-head">
          <h2>基本信息</h2>
        </div>
        <div className="profile-info-list">
          {basicInfo.map(([label, value]) => (
            <div className="profile-info-row" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <em onClick={() => {
                const newValue = window.prompt(`编辑 ${label}`, String(value))
                if (newValue !== null) {
                  const fieldMap: Record<string, string> = { '姓名': 'name', '手机': 'phone', '邮箱': 'email', '所在地区': 'city' }
                  void handleUpdateProfile(fieldMap[String(label)] ?? String(label).toLowerCase(), newValue)
                }
              }}>编辑</em>
            </div>
          ))}
        </div>
      </article>

      <article className="card profile-card">
        <div className="profile-card-head">
          <h2>专业资质</h2>
          <p>展示你的专业背景，帮助平台更精准地理解你的客户来源和服务范围。</p>
        </div>
        <div className="profile-skill-row">
          {qualifications.length > 0 ? (
            qualifications.map((q) => (
              <span className="skill-pill" key={q}>{q} <i>×</i></span>
            ))
          ) : (
            <span style={{ color: '#98a2b3' }}>暂无资质</span>
          )}
          <button className="add-skill-btn" onClick={() => void handleAddCertification()}>+ 添加资质</button>
        </div>
      </article>

      <article className="card profile-card">
        <div className="profile-card-head">
          <h2>通知设置</h2>
        </div>
        <div className="profile-notify-list">
          {notifications.map(([label, on]) => (
            <div className="profile-notify-row" key={label}>
              <span>{label}</span>
              <i
                className={`toggle-pill ${on ? 'on' : ''}`}
                onClick={() => {
                  const keyMap: Record<string, string> = {
                    '客户匹配成功通知': 'matchSuccess',
                    '顾问反馈通知': 'expertFeedback',
                    '回报到账通知': 'payoutReceived',
                    '平台公告': 'platformAnnouncement',
                  }
                  void handleToggleNotification(keyMap[String(label)] ?? String(label), on)
                }}
              >
                <b />
              </i>
            </div>
          ))}
        </div>
      </article>

      <article className="card profile-card">
        <div className="profile-link-row">
          <div>
            <h2>邀请链接</h2>
            <p>{inviteStats.inviteCount > 0 ? `你已邀请 ${inviteStats.inviteCount} 位伙伴加入平台。` : '暂无邀请记录'}</p>
          </div>
          <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>去管理 <ChevronRight size={18} /></button>
        </div>
      </article>

      <article className="card profile-card">
        <div className="profile-card-head">
          <h2>账户安全</h2>
        </div>
        <div className="security-links">
          <button onClick={() => void handleChangePassword()}>修改密码</button>
          <span>|</span>
          <button onClick={() => window.alert('当前账号已通过安全令牌登录，暂无异常登录记录。')}>登录记录</button>
          <span>|</span>
          <button className="danger" onClick={() => {
            localStorage.removeItem('token')
            window.location.reload()
          }}>退出登录</button>
        </div>
      </article>
    </section>
  )
}

function GuideFlow({
  step,
  values,
  onChange,
  onNext,
  onSkip,
  onClose,
  onFinish,
  onStartIntro,
  onExplore,
}: {
  step: 1 | 2 | 3 | 4 | 5 | 6
  values: {
    name: string
    phone: string
    email: string
    city: string
    career: string
    clients: string
  }
  onChange: (patch: Partial<typeof values>) => void
  onNext: () => void
  onSkip: () => void
  onClose: () => void
  onFinish: () => void
  onStartIntro: () => void
  onExplore: () => void
}) {
  const careerOptions = [
    '房产经纪',
    '会计师 / CPA',
    '移民顾问',
    '贷款经纪',
    '车房险经纪 (P&C)',
    '兼职寿险经纪',
    '商业银行客户经理',
    '私人银行客户经理',
    '律师',
    '医生',
    '咨询顾问',
    '其他',
  ]
  const clientOptions = ['高净值（净资产 $1M+）', '中等富裕（$200K-$1M）', '中小企业主', '客户群体多样']
  const canSubmitProfile = values.name && values.phone && values.email && values.city
  const canFinish = values.career && values.clients
  const [guideNotice, setGuideNotice] = useState('')

  return (
    <div className="guide-flow-layer">
      <div className="guide-flow-topbar">
        <div className="guide-flow-brand">保险智能获客</div>
        <button className="guide-flow-skip" onClick={onSkip}>跳过</button>
      </div>
      <div className={`guide-flow-body step-${step}`}>
        {step === 1 && (
          <div className="guide-screen intro-screen">
            <h1>你身边有人需要保障规划？<br />介绍给我们，剩下的不用你管。</h1>
            <p>你是专业人士，不是保险销售。<br />客户信任你的判断，但保障规划不是你的主业。<br />现在你可以把客户需求提交给平台 B 端顾问，自己专注本职工作。</p>
            <div className="guide-compare-grid">
              <div className="compare-card old">
                <strong>以前：微信群里介绍</strong>
                <ul>
                  <li>不知道介绍给谁合适</li>
                  <li>介绍完就没了下文</li>
                  <li>客户体验不好怪到你头上</li>
                  <li>帮了忙但没有任何回报</li>
                </ul>
              </div>
              <div className="compare-card new">
                <strong>现在：用平台介绍</strong>
                <ul>
                  <li>客户需求进入工单大厅</li>
                  <li>每一步进展实时通知你</li>
                  <li>认证顾问接单，你的声誉有保障</li>
                  <li>成功介绍就有回报</li>
                </ul>
              </div>
            </div>
            <button className="guide-next-link" onClick={onNext}>下一步 &gt;</button>
          </div>
        )}

        {step === 2 && (
          <div className="guide-screen income-screen">
            <h1>每一次成功介绍，都是你的收入</h1>
            <p>你负责介绍，B端顾问负责服务，回报自动结算到你的账户</p>
            <div className="income-demo-card">
              <span>收益示例</span>
              <div className="income-demo-main">
                <div>
                  <strong>你介绍了一位客户</strong>
                  <p>王先生，45 岁企业主<br />想给家庭做保障规划</p>
                </div>
                <div className="income-demo-value">
                  <span>方案规模</span>
                  <strong>$50,000</strong>
                </div>
              </div>
              <div className="income-demo-footer">
                <span>你的回报</span>
                <strong>$2,500</strong>
              </div>
            </div>
            <div className="income-stats">
              <div><span>回报规则</span><strong>按工单方案结算</strong></div>
              <div><span>进度同步</span><strong>实时通知</strong></div>
            </div>
            <button className="guide-next-link" onClick={onNext}>下一步 &gt;</button>
          </div>
        )}

        {step === 3 && (
          <div className="guide-screen ai-screen">
            <h1>你说两句，AI 和顾问接着推进</h1>
            <p>不用填表、不用懂保险、不用跟进客户</p>
            <div className="speech-card">
              <span>你做的（2 分钟）</span>
              <strong>"我有个朋友王先生，45 岁做生意的，想给家庭做个保障规划"</strong>
              <p>就说这么多就够了，AI 会接着帮你问。</p>
            </div>
            <ArrowDown size={22} />
            <div className="task-card">
              <span>AI 自动完成</span>
              <ul>
                <li>启发你梳理客户需求</li>
                <li>自动整理客户档案</li>
                <li>生成可接单的工单</li>
              </ul>
            </div>
            <ArrowDown size={22} />
            <div className="task-card expert">
              <span>B端顾问主动完成</span>
              <ul>
                <li>24 小时内联系客户</li>
                <li>面谈制定方案</li>
                <li>全程进度同步给你</li>
              </ul>
            </div>
            <div className="time-copy">
              <strong>你的时间成本：2 分钟。</strong>
              <p>其余由 AI 辅助整理，B端顾问推进服务。</p>
            </div>
            <button className="guide-next-link" onClick={onNext}>下一步 &gt;</button>
          </div>
        )}

        {step === 4 && (
          <div className="guide-screen expert-screen">
            <h1>你的客户，交给合适的顾问</h1>
            <p>每一位 B 端顾问经过平台认证，你的声誉有保障</p>
            <div className="expert-metrics">
              <div><strong>真实</strong><span>B端顾问账号</span></div>
              <div><strong>可审计</strong><span>接单记录</span></div>
              <div><strong>2h</strong><span>最快响应</span></div>
              <div><strong>可追踪</strong><span>全流程进度</span></div>
            </div>
            <div className="expert-mini-cards">
              <article><span>李</span><strong>李明</strong><p>重疾险 | 10年</p><em>★ 4.8</em></article>
              <article><span>陈</span><strong>陈华</strong><p>家庭规划 | 8年</p><em>★ 4.9</em></article>
              <article><span>赵</span><strong>赵敏</strong><p>医疗险 | 8年</p><em>★ 4.7</em></article>
            </div>
            <div className="secure-card">
              <ul>
                <li>所有顾问经过资质审核和背景调查</li>
                <li>客户信息严格保密，仅接单顾问可见</li>
                <li>全流程可追踪，每一步进展实时通知</li>
              </ul>
            </div>
            <div className="expert-cta-copy">准备好了吗？最快 2 分钟完成</div>
            <div className="expert-cta-row">
              <button className="blue-btn guide-primary-btn" onClick={onStartIntro}>介绍我的第一位客户</button>
              <button className="guide-text-btn" onClick={onExplore}>或 先看看平台</button>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="guide-screen form-screen">
            <h1>完善你的个人信息</h1>
            <p>帮助我们为你提供更精准的服务</p>
            <div className="profile-upload">
              <div className="avatar-wrapper">
                <span><UserIcon size={30} /></span>
                <button className="upload-edit-btn" onClick={() => setGuideNotice('头像上传将在账号资料页统一管理。')}>
                  <Pencil size={14} />
                </button>
              </div>
              <button className="upload-text-btn" onClick={() => setGuideNotice('头像上传将在账号资料页统一管理。')}>上传头像</button>
            </div>
            {guideNotice && <div className="guide-inline-notice">{guideNotice}</div>}
            <div className="guide-form-card">
              <label>
                姓名
                <input value={values.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="请输入你的姓名" />
              </label>
              <label>
                手机号码
                <div className="phone-row">
                  <span className="country-code">+1 🇨🇦</span>
                  <input value={values.phone} onChange={(e) => onChange({ phone: e.target.value })} placeholder="请输入手机号" />
                </div>
              </label>
              <label>
                邮箱
                <input value={values.email} onChange={(e) => onChange({ email: e.target.value })} placeholder="请输入邮箱地址" />
              </label>
              <label>
                所在地区
                <input value={values.city} onChange={(e) => onChange({ city: e.target.value })} placeholder="请选择你的城市" />
              </label>
            </div>
            <div className="guide-form-footer">5 / 6</div>
            <button className={`guide-submit-btn ${canSubmitProfile ? 'ready' : ''}`} onClick={onNext} disabled={!canSubmitProfile}>继续</button>
          </div>
        )}

        {step === 6 && (
          <div className="guide-screen survey-screen">
            <h1>告诉我们更多</h1>
            <p>帮助 AI 更好地理解你的工作方式</p>
            <div className="survey-card">
              <h3>你的主业是？</h3>
              <div className="choice-grid">
                {careerOptions.map((option) => (
                  <button
                    key={option}
                    className={`choice-chip ${values.career === option ? 'selected' : ''}`}
                    onClick={() => onChange({ career: option })}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <h3>你接触最多的客户类型？</h3>
              <div className="choice-grid compact">
                {clientOptions.map((option) => (
                  <button
                    key={option}
                    className={`choice-chip ${values.clients === option ? 'selected' : ''}`}
                    onClick={() => onChange({ clients: option })}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            <div className="guide-step-dots top">
              {Array.from({ length: 6 }, (_, i) => (
                <i key={i} className={step === i + 1 ? 'active' : ''} />
              ))}
            </div>
            <button className={`guide-submit-btn ${canFinish ? 'ready' : ''}`} onClick={onFinish} disabled={!canFinish}>完成，开始使用</button>
          </div>
        )}
      </div>
      {step < 5 && (
        <div className="guide-step-dots">
          {Array.from({ length: 6 }, (_, i) => (
            <i key={i} className={step === i + 1 ? 'active' : ''} />
          ))}
        </div>
      )}
      {step >= 5 && <button className="guide-close-btn" onClick={onClose} aria-label="关闭引导"><X size={18} /></button>}
    </div>
  )
}
