export function formatStudyHours(totalHours?: number) {
  return formatStudySeconds(Math.round((totalHours ?? 0) * 3600))
}

export function formatStudySeconds(totalSeconds?: number) {
  const seconds = Math.max(0, Math.round(totalSeconds ?? 0))
  if (seconds < 60) return `${seconds} 秒`
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟`
  return `${(seconds / 3600).toFixed(1)}h`
}
