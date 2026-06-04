import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState, PageShell, ProgressBar, SectionCard, StatCard } from '../components/PageShell'
import apiClient, { API_ENDPOINTS } from '../utils/api-client'
import { formatStudySeconds } from '../utils/time-format'
import { useProfileStore } from '../store'

export default function Home() {
  const { dashboard, fetchDashboard } = useProfileStore()

  useEffect(() => {
    fetchDashboard().catch(() => undefined)
  }, [fetchDashboard])

  const profile = dashboard?.profile
  const weeklyTarget = profile?.weeklyStudyHoursTarget || 30
  const weeklyPercent = profile
    ? Math.round(((profile.totalStudyHours || 0) / weeklyTarget) * 100)
    : 0
  const hasGoal = Boolean(profile?.goal || profile?.currentStage)

  async function deleteWeakPoint(id: string) {
    await apiClient.delete(`${API_ENDPOINTS.WEAK_POINTS}/${id}`)
    await fetchDashboard()
  }

  return (
    <PageShell
      eyebrow="Dashboard"
      title="今日学习"
      description="从计时、提问、阅读和练习开始记录；这里不会替你编造学习进度。"
      action={<Link className="warm-button" to="/qa">开始提问</Link>}
    >
      <div className="grid gap-5 lg:grid-cols-[1.4fr_0.8fr]">
        <SectionCard className="min-h-[300px]">
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard label="今日学习" value={formatStudySeconds(dashboard?.today.studySeconds)} />
            <StatCard label="今日练习" value={dashboard?.today.practiceCount ?? 0} />
            <StatCard label="连续学习" value={`${profile?.streakDays ?? 0} 天`} />
          </div>

          <div className="mt-6 rounded-3xl bg-emerald-950 p-6 text-amber-50">
            <p className="text-sm text-amber-100/70">当前目标</p>
            {hasGoal ? (
              <>
                <h2 className="mt-2 text-3xl font-bold">{profile?.goal || '未填写目标'}</h2>
                <p className="mt-3 text-amber-50/70">{profile?.currentStage || '未填写阶段'}</p>
              </>
            ) : (
              <>
                <h2 className="mt-2 text-3xl font-bold">尚未设置学习目标</h2>
                <p className="mt-3 text-amber-50/70">去学习档案写下目标，后续记录会围绕它聚合。</p>
              </>
            )}
            <div className="mt-6">
              <div className="mb-2 flex justify-between text-sm">
                <span>累计进度</span>
                <span>{weeklyPercent}%</span>
              </div>
              <ProgressBar value={weeklyPercent} />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="继续学习" description="选择一个真实动作，平台会从这里开始记录你的学习。">
          <div className="grid gap-3">
            <Link className="rounded-3xl bg-white/75 p-4 font-semibold text-stone-800 transition hover:bg-amber-50" to="/calendar">
              开始学习计时
            </Link>
            <Link className="rounded-3xl bg-white/75 p-4 font-semibold text-stone-800 transition hover:bg-amber-50" to="/textbook">
              上传教材并提问
            </Link>
            <Link className="rounded-3xl bg-white/75 p-4 font-semibold text-stone-800 transition hover:bg-amber-50" to="/practice">
              生成自适应试卷
            </Link>
          </div>
        </SectionCard>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <SectionCard title="待复习薄弱点" description="薄弱点来自所有学习功能的汇总：问答、教材、论文、写作、练习和计时主题。">
          <div className="space-y-3">
            {(dashboard?.weakPoints || []).slice(0, 4).map((point) => (
              <div key={point.id} className="rounded-3xl border border-stone-200 bg-white/70 p-4">
                <div className="flex items-center justify-between">
                  <Link to="/practice" className="font-semibold text-stone-800 hover:underline">{point.knowledgeName}</Link>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-stone-500">{point.masteryScore}%</span>
                    <button className="text-xs text-stone-400 underline hover:text-red-600" onClick={() => deleteWeakPoint(point.id)}>
                      删除
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-xs text-stone-400">来源：{point.source}</p>
                <div className="mt-3">
                  <ProgressBar value={point.masteryScore} />
                </div>
              </div>
            ))}
            {!dashboard?.weakPoints.length && (
              <EmptyState title="暂无薄弱点" description="完成真实问答、阅读或训练后，这里才会出现复习项。" />
            )}
          </div>
        </SectionCard>

        <SectionCard title="最近学习" description="这里按功能和学习材料聚合显示，不再逐条展示系统默认提问。">
          <div className="space-y-3">
            {(dashboard?.recentHistory || []).map((item) => (
              <div key={item.id} className="rounded-3xl bg-white/70 p-4">
                <p className="text-sm font-semibold text-stone-700">{item.summary}</p>
                <p className="mt-1 text-xs text-stone-500">
                  {item.sourceType} · {item.createdAt}
                </p>
              </div>
            ))}
            {!dashboard?.recentHistory.length && (
              <EmptyState title="还没有学习记录" description="从计时、问答、教材或论文阅读开始。" />
            )}
          </div>
        </SectionCard>
      </div>
    </PageShell>
  )
}
