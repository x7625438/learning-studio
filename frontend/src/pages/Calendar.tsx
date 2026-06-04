import { useEffect, useState } from 'react'
import { PageShell, ProgressBar, SectionCard, StatCard } from '../components/PageShell'
import apiClient, { API_ENDPOINTS } from '../utils/api-client'
import { formatStudySeconds } from '../utils/time-format'
import { useCalendarStore } from '../store'

const weekDays = ['一', '二', '三', '四', '五', '六', '日']

export default function Calendar() {
  const { heatmap, weekly, timerStartedAt, timerTopic, fetchCalendar, startTimer, stopTimer, resetTimer } = useCalendarStore()
  const [topic, setTopic] = useState(timerTopic)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    fetchCalendar().catch(() => undefined)
  }, [fetchCalendar])

  useEffect(() => {
    if (!timerStartedAt) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [timerStartedAt])

  const elapsedSeconds = timerStartedAt ? Math.floor((now - timerStartedAt) / 1000) : 0
  const studyPercent = weekly ? Math.round((weekly.totalStudyMinutes / weekly.targetStudyMinutes) * 100) : 0
  const practicePercent = weekly ? Math.round((weekly.practiceCount / weekly.targetPracticeCount) * 100) : 0
  const cells = buildMonthCells(heatmap)

  async function finishTimer() {
    if (!timerStartedAt) return
    const seconds = Math.max(1, elapsedSeconds)
    await apiClient.post(`${API_ENDPOINTS.CALENDAR}/timer/finish`, { seconds, topic })
    stopTimer()
    setNow(Date.now())
    await fetchCalendar()
  }

  function handleStartTimer() {
    startTimer(topic)
    setNow(Date.now())
  }

  function handleResetTimer() {
    resetTimer()
    setTopic('自主学习')
    setNow(Date.now())
  }

  return (
    <PageShell eyebrow="P1-4 Calendar" title="学习日历与里程碑" description="学习时长只在你手动开始计时后记录。">
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <SectionCard title="月度热力图">
          <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold text-stone-500">
            {weekDays.map((day) => <div key={day}>{day}</div>)}
          </div>
          <div className="mt-3 grid grid-cols-7 gap-2">
            {cells.map((cell, index) =>
              cell ? (
                <div
                  key={cell.date}
                  title={`${cell.date}: ${formatStudySeconds(cell.studySeconds)}`}
                  className={`relative aspect-square rounded-2xl border border-stone-200 p-2 text-xs ${
                    cell.intensity === 0
                      ? 'bg-white/70'
                      : cell.intensity === 1
                        ? 'bg-emerald-100'
                        : cell.intensity === 2
                          ? 'bg-emerald-300'
                          : 'bg-emerald-700 text-white'
                  }`}
                >
                  <span>{Number(cell.date.slice(-2))}</span>
                </div>
              ) : (
                <div key={`blank-${index}`} className="aspect-square rounded-2xl" />
              )
            )}
          </div>
        </SectionCard>
        <div className="space-y-5">
          <SectionCard title="学习计时">
            <label className="block">
              <span className="text-sm font-semibold text-stone-600">本次学习主题</span>
              <input className="field mt-2" value={topic} onChange={(event) => setTopic(event.target.value)} />
            </label>
            <p className="mt-5 text-5xl font-semibold text-stone-950">{formatDuration(elapsedSeconds)}</p>
            <div className="mt-5 flex gap-3">
              {!timerStartedAt ? (
                <button className="warm-button flex-1" onClick={handleStartTimer}>开始计时</button>
              ) : (
                <button className="warm-button flex-1" onClick={finishTimer}>结束并记录</button>
              )}
              <button className="ghost-button" onClick={handleResetTimer}>重置</button>
            </div>
          </SectionCard>

          <SectionCard title="本周目标">
            <div className="space-y-5">
              <StatCard label="学习时长" value={formatStudySeconds(weekly?.totalStudySeconds)} />
              <ProgressBar value={studyPercent} />
              <StatCard label="练习数量" value={weekly?.practiceCount ?? 0} />
              <ProgressBar value={practicePercent} />
              <StatCard label="专注天数" value={`${weekly?.focusDays ?? 0}/${weekly?.targetFocusDays ?? 5}`} />
            </div>
          </SectionCard>
        </div>
      </div>
    </PageShell>
  )
}

function buildMonthCells(
  heatmap: { date: string; intensity: 0 | 1 | 2 | 3; studyMinutes: number; studySeconds: number }[]
) {
  if (!heatmap.length) return []
  const first = new Date(`${heatmap[0].date}T00:00:00`)
  const mondayBasedOffset = (first.getDay() + 6) % 7
  return [...Array(mondayBasedOffset).fill(null), ...heatmap]
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}
