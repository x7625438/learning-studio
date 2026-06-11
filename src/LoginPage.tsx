import { useEffect, useState } from 'react'
import { User, Lock, Mail, Eye, EyeOff, Sparkles, Users, Briefcase, Crown, UserPlus, UserCheck } from 'lucide-react'
import { login, register } from './api/auth.js'

interface LoginPageProps {
  onLogin: (user: { id: string; email: string; name: string; role: '介绍人' | '合伙人' }) => void
}

type PlatformRole = 'a_side' | 'b_side' | null
type ASideType = 'big_a' | 'small_a' | 'regular_a' | null

export default function LoginPage({ onLogin }: LoginPageProps) {
  const initialInviteCode = new URLSearchParams(window.location.search).get('inviteCode') || ''
  const [isLogin, setIsLogin] = useState(!initialInviteCode)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [inviteCode] = useState(initialInviteCode)
  const [platformRole, setPlatformRole] = useState<PlatformRole>(null)
  const [aSideType, setASideType] = useState<ASideType>(null)
  const [form, setForm] = useState({
    email: '',
    password: '',
    name: '',
    phone: '',
    city: '',
    profession: '',
    insuranceHoldings: '',
    insuranceCoverageRange: '',
    awarenessLevel: '',
    isLicensed: false,
  })

  // 如果有邀请码，自动锁定为小A
  const isInvited = Boolean(inviteCode)
  const effectiveASideType = isInvited ? 'small_a' : aSideType

  useEffect(() => {
    if (inviteCode) {
      setIsLogin(false)
      setPlatformRole('a_side')
      setASideType('small_a')
    }
  }, [inviteCode])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const formData = new FormData(e.currentTarget as HTMLFormElement)
    const submitted = {
      email: String(formData.get('email') || form.email),
      password: String(formData.get('password') || form.password),
      name: String(formData.get('name') || form.name),
      phone: String(formData.get('phone') || form.phone),
      city: String(formData.get('city') || form.city),
      profession: String(formData.get('profession') || form.profession),
      insuranceHoldings: String(formData.get('insuranceHoldings') || form.insuranceHoldings),
      insuranceCoverageRange: String(formData.get('insuranceCoverageRange') || form.insuranceCoverageRange),
      awarenessLevel: String(formData.get('awarenessLevel') || form.awarenessLevel),
      isLicensed: formData.get('isLicensed') === 'on' || form.isLicensed,
    }

    try {
      if (isLogin) {
        const data = await login(submitted.email, submitted.password)
        localStorage.setItem('token', data.token)
        onLogin(data.user)
      } else {
        // Validate role selection
        if (!platformRole) {
          setError('请选择注册角色类型')
          setLoading(false)
          return
        }
        if (platformRole === 'a_side' && !effectiveASideType) {
          setError('请选择A端类型（大A、小A或普通A）')
          setLoading(false)
          return
        }
        const data = await register({
          email: submitted.email,
          password: submitted.password,
          name: submitted.name,
          phone: submitted.phone,
          city: submitted.city,
          profession: submitted.profession,
          insuranceHoldings: submitted.insuranceHoldings,
          insuranceCoverageRange: submitted.insuranceCoverageRange,
          awarenessLevel: submitted.awarenessLevel,
          isLicensed: submitted.isLicensed,
          platformRole,
          aSideType: effectiveASideType || undefined,
          inviteCode: inviteCode || undefined,
        })
        localStorage.setItem('token', data.token)
        onLogin(data.user)
      }
    } catch (err: any) {
      setError(err.response?.data?.error || '操作失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-logo">保</div>
          <h1>保险智能获客</h1>
          <p>把客户介绍给对的人，你只管做专业的事</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="login-error">{error}</div>}

          {!isLogin && (
            <>
              {isInvited && <div className="login-invite-note">你正在通过团队邀请注册，注册后将作为小A加入邀请人的团队。</div>}
              <label>
                <User size={18} />
                <input
                  placeholder="姓名"
                  name="name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                />
              </label>

              {/* 角色选择 */}
              <div style={{ marginTop: '8px' }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#374151', marginBottom: '10px' }}>
                  选择你的角色
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                  <button
                    type="button"
                    className={`role-select-btn ${platformRole === 'a_side' ? 'active' : ''}`}
                    onClick={() => { setPlatformRole('a_side'); if (isInvited) setASideType('small_a') }}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '14px 8px',
                      borderRadius: '10px',
                      border: platformRole === 'a_side' ? '2px solid #1a365d' : '1px solid #e5e7eb',
                      background: platformRole === 'a_side' ? '#eff6ff' : '#fff',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    <Users size={24} color={platformRole === 'a_side' ? '#1a365d' : '#9ca3af'} />
                    <span style={{ fontSize: '13px', fontWeight: 600, color: platformRole === 'a_side' ? '#1a365d' : '#4b5563' }}>A端推荐人</span>
                    <span style={{ fontSize: '11px', color: '#6b7280' }}>介绍客户赚佣金</span>
                  </button>
                  <button
                    type="button"
                    className={`role-select-btn ${platformRole === 'b_side' ? 'active' : ''}`}
                    onClick={() => { setPlatformRole('b_side'); setASideType(null) }}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '14px 8px',
                      borderRadius: '10px',
                      border: platformRole === 'b_side' ? '2px solid #1a365d' : '1px solid #e5e7eb',
                      background: platformRole === 'b_side' ? '#eff6ff' : '#fff',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    <Briefcase size={24} color={platformRole === 'b_side' ? '#1a365d' : '#9ca3af'} />
                    <span style={{ fontSize: '13px', fontWeight: 600, color: platformRole === 'b_side' ? '#1a365d' : '#4b5563' }}>B端保险顾问</span>
                    <span style={{ fontSize: '11px', color: '#6b7280' }}>持牌专业接单</span>
                  </button>
                </div>

                {/* A端子类型选择 */}
                {platformRole === 'a_side' && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>
                      {isInvited ? '通过邀请注册，角色已锁定为：' : '选择你的A端类型：'}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                      <button
                        type="button"
                        disabled={isInvited}
                        onClick={() => setASideType('big_a')}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '10px 6px',
                          borderRadius: '8px',
                          border: aSideType === 'big_a' ? '2px solid #1a365d' : '1px solid #e5e7eb',
                          background: aSideType === 'big_a' ? '#eff6ff' : '#fff',
                          cursor: isInvited ? 'not-allowed' : 'pointer',
                          opacity: isInvited ? 0.5 : 1,
                        }}
                      >
                        <Crown size={18} color={aSideType === 'big_a' ? '#1a365d' : '#9ca3af'} />
                        <span style={{ fontSize: '12px', fontWeight: 600, color: aSideType === 'big_a' ? '#1a365d' : '#4b5563' }}>大A</span>
                        <span style={{ fontSize: '10px', color: '#6b7280' }}>合伙人</span>
                      </button>
                      <button
                        type="button"
                        disabled={isInvited}
                        onClick={() => setASideType('small_a')}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '10px 6px',
                          borderRadius: '8px',
                          border: effectiveASideType === 'small_a' ? '2px solid #1a365d' : '1px solid #e5e7eb',
                          background: effectiveASideType === 'small_a' ? '#eff6ff' : '#fff',
                          cursor: isInvited ? 'not-allowed' : 'pointer',
                          opacity: isInvited ? 0.5 : 1,
                        }}
                      >
                        <UserPlus size={18} color={effectiveASideType === 'small_a' ? '#1a365d' : '#9ca3af'} />
                        <span style={{ fontSize: '12px', fontWeight: 600, color: effectiveASideType === 'small_a' ? '#1a365d' : '#4b5563' }}>小A</span>
                        <span style={{ fontSize: '10px', color: '#6b7280' }}>团队成员</span>
                      </button>
                      <button
                        type="button"
                        disabled={isInvited}
                        onClick={() => setASideType('regular_a')}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '10px 6px',
                          borderRadius: '8px',
                          border: aSideType === 'regular_a' ? '2px solid #1a365d' : '1px solid #e5e7eb',
                          background: aSideType === 'regular_a' ? '#eff6ff' : '#fff',
                          cursor: isInvited ? 'not-allowed' : 'pointer',
                          opacity: isInvited ? 0.5 : 1,
                        }}
                      >
                        <UserCheck size={18} color={aSideType === 'regular_a' ? '#1a365d' : '#9ca3af'} />
                        <span style={{ fontSize: '12px', fontWeight: 600, color: aSideType === 'regular_a' ? '#1a365d' : '#4b5563' }}>普通A</span>
                        <span style={{ fontSize: '10px', color: '#6b7280' }}>独立推荐</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          <label>
            <Mail size={18} />
            <input
              type="email"
              placeholder="邮箱"
              name="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
            />
          </label>

          <label className="password-label">
            <Lock size={18} />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="密码"
              name="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              required
              minLength={8}
            />
            <button
              type="button"
              className="toggle-password"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </label>

          {!isLogin && (
            <>
            <label>
              <Sparkles size={18} />
              <input
                placeholder="手机号（可选）"
                name="phone"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </label>
            <label>
              <Sparkles size={18} />
              <input
                placeholder="所在城市（可选）"
                name="city"
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              />
            </label>
            <label>
              <Sparkles size={18} />
              <input
                placeholder="职业（如：会计师、律师、地产经纪）"
                name="profession"
                value={form.profession}
                onChange={(e) => setForm((f) => ({ ...f, profession: e.target.value }))}
              />
            </label>
            <label>
              <Sparkles size={18} />
              <select
                name="insuranceHoldings"
                value={form.insuranceHoldings}
                onChange={(e) => setForm((f) => ({ ...f, insuranceHoldings: e.target.value }))}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '14px' }}
              >
                <option value="">持有保险情况（可选）</option>
                <option value="none">无</option>
                <option value="basic">基础（仅有政府医保）</option>
                <option value="some">有一些（1-2份商业险）</option>
                <option value="comprehensive">较全面（3份以上）</option>
              </select>
            </label>
            <label>
              <Sparkles size={18} />
              <select
                name="awarenessLevel"
                value={form.awarenessLevel}
                onChange={(e) => setForm((f) => ({ ...f, awarenessLevel: e.target.value }))}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '14px' }}
              >
                <option value="">保险认知水平（可选）</option>
                <option value="low">较低 - 不太了解保险</option>
                <option value="medium">中等 - 有一些了解</option>
                <option value="high">较高 - 比较熟悉保险</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px' }}>
              <input
                type="checkbox"
                name="isLicensed"
                checked={form.isLicensed}
                onChange={(e) => setForm((f) => ({ ...f, isLicensed: e.target.checked }))}
                style={{ width: '18px', height: '18px' }}
              />
              <span style={{ fontSize: '14px', color: '#374151' }}>我持有保险牌照</span>
            </label>
            </>
          )}

          <button type="submit" className="login-submit" disabled={loading}>
            {loading ? '请稍候...' : isLogin ? '登录' : '注册'}
          </button>
        </form>

        <div className="login-footer">
          {isLogin ? (
            <>
              还没有账号？<button onClick={() => setIsLogin(false)}>立即注册</button>
            </>
          ) : (
            <>
              已有账号？<button onClick={() => setIsLogin(true)}>去登录</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
