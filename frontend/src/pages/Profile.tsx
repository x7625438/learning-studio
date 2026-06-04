import { FormEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmptyState, PageShell, ProgressBar, SectionCard, StatCard } from '../components/PageShell'
import UserProfileDocEditor from '../components/UserProfileDocEditor'
import apiClient, { API_ENDPOINTS } from '../utils/api-client'
import { formatStudyHours } from '../utils/time-format'
import { useAuthStore, useNotificationStore, useProfileStore } from '../store'

export default function Profile() {
  const navigate = useNavigate()
  const { dashboard, fetchDashboard, updateProfile } = useProfileStore()
  const logout = useAuthStore((state) => state.logout)
  const addNotification = useNotificationStore((state) => state.addNotification)
  const [goal, setGoal] = useState('')
  const [currentStage, setCurrentStage] = useState('')
  const [selfIntroduction, setSelfIntroduction] = useState('')
  const [learningPreferences, setLearningPreferences] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isProfileDocOpen, setIsProfileDocOpen] = useState(false)

  useEffect(() => {
    fetchDashboard().catch(() => undefined)
  }, [fetchDashboard])

  useEffect(() => {
    setGoal(dashboard?.profile.goal || '')
    setCurrentStage(dashboard?.profile.currentStage || '')
    setSelfIntroduction(dashboard?.profile.selfIntroduction || '')
    setLearningPreferences(dashboard?.profile.learningPreferences || '')
  }, [dashboard])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (isSaving) return
    setIsSaving(true)
    try {
      await updateProfile({
        goal: goal.trim() || null,
        currentStage: currentStage.trim() || null,
        selfIntroduction: selfIntroduction.trim() || null,
        learningPreferences: learningPreferences.trim() || null,
      })
      addNotification({ type: 'success', message: '档案已保存' })
    } finally {
      setIsSaving(false)
    }
  }

  async function deleteWeakPoint(id: string) {
    await apiClient.delete(`${API_ENDPOINTS.WEAK_POINTS}/${id}`)
    await fetchDashboard()
  }

  async function deleteAccount() {
    if (confirmText !== '注销账号' || isDeleting) return
    setIsDeleting(true)
    await apiClient.delete(`${API_ENDPOINTS.AUTH}/me`)
    logout()
    navigate('/register', { replace: true })
  }

  return (
    <PageShell
      eyebrow="Profile"
      title="学习档案"
      description="档案只记录真实产生的目标、互动、练习和薄弱点。新账号默认是空的。"
    >
      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <SectionCard title="基本信息" description="手动设置目标；学习时长、连续天数和薄弱点由系统根据真实行为累计。">
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-sm font-semibold text-blue-900 mb-1">🤖 AI个性化档案</p>
                <p className="text-xs text-blue-700">
                  让AI更了解你的学习风格、性格特点和兴趣爱好，提供更个性化的回答
                </p>
              </div>
              <button
                onClick={() => setIsProfileDocOpen(true)}
                className="ml-3 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
              >
                编辑档案
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="text-sm font-semibold text-stone-600">学习目标</span>
              <input
                className="field mt-2"
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="例如：两个月内完成高数期末复习"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-stone-600">当前阶段</span>
              <input
                className="field mt-2"
                value={currentStage}
                onChange={(event) => setCurrentStage(event.target.value)}
                placeholder="例如：刚开始整理知识点"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-stone-600">自我介绍</span>
              <textarea
                className="field mt-2 min-h-28 resize-y"
                value={selfIntroduction}
                onChange={(event) => setSelfIntroduction(event.target.value)}
                placeholder="例如：我是大一学生，数学基础一般，容易在抽象定义和计算细节之间断开。"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-stone-600">希望的学习方式</span>
              <textarea
                className="field mt-2 min-h-28 resize-y"
                value={learningPreferences}
                onChange={(event) => setLearningPreferences(event.target.value)}
                placeholder="例如：先给直觉解释，再给例题；不要一次讲太多，希望多追问我。"
              />
            </label>
            <button className="warm-button disabled:cursor-not-allowed disabled:opacity-60" disabled={isSaving}>
              {isSaving ? '保存中...' : '保存档案'}
            </button>
          </form>
        </SectionCard>

        <SectionCard title="学习数据">
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard label="累计学习" value={formatStudyHours(dashboard?.profile.totalStudyHours)} />
            <StatCard label="连续天数" value={`${dashboard?.profile.streakDays ?? 0} 天`} />
            <StatCard label="本周目标" value={`${dashboard?.profile.weeklyStudyHoursTarget ?? 30}h`} />
          </div>
          {!dashboard?.recentHistory.length && (
            <div className="mt-5">
              <EmptyState title="还没有学习行为" description="计时、提问、上传材料或完成练习后，档案会开始积累。" />
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard className="mt-5" title="薄弱点雷达" description="薄弱点来自真实学习记录；答错会降低掌握度，答对会回升。">
        {dashboard?.weakPoints.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {dashboard.weakPoints.map((point) => (
              <div key={point.id} className="rounded-3xl border border-stone-200 bg-white/70 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-stone-800">{point.knowledgeName}</h3>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-stone-600">{point.priority}</span>
                    <button className="text-xs text-stone-400 underline hover:text-red-600" onClick={() => deleteWeakPoint(point.id)}>
                      删除
                    </button>
                  </div>
                </div>
                <div className="mt-4">
                  <ProgressBar value={point.masteryScore} />
                </div>
                <p className="mt-2 text-sm text-stone-500">
                  错误 {point.errorCount} · 正确 {point.correctCount}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="暂无薄弱点" description="系统不会给新账号预置薄弱点；完成真实学习后再生成。" />
        )}
      </SectionCard>

      <SectionCard className="mt-5 border-red-200 bg-red-50/60" title="危险操作" description="注销后会删除当前账号及其学习档案、问答、上传材料记录、练习记录和图谱数据，无法恢复。">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <label className="block">
            <span className="text-sm font-semibold text-red-700">输入“注销账号”确认</span>
            <input
              className="field mt-2 border-red-200 bg-white"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder="注销账号"
            />
          </label>
          <button
            className="rounded-full bg-red-700 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            disabled={confirmText !== '注销账号' || isDeleting}
            onClick={deleteAccount}
          >
            {isDeleting ? '注销中...' : '永久注销账号'}
          </button>
        </div>
      </SectionCard>

      <UserProfileDocEditor isOpen={isProfileDocOpen} onClose={() => setIsProfileDocOpen(false)} />
    </PageShell>
  )
}
