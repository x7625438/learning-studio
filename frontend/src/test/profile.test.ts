import { describe, expect, it } from 'vitest'
import { formatStudyHours } from '../utils/time-format'

describe('Profile study time display', () => {
  it('shows minutes for totals under one hour', () => {
    expect(formatStudyHours(1 / 60)).toBe('1 分钟')
  })

  it('shows seconds for totals under one minute', () => {
    expect(formatStudyHours(16 / 3600)).toBe('16 秒')
  })

  it('shows hours for totals of at least one hour', () => {
    expect(formatStudyHours(1.25)).toBe('1.3h')
  })
})
