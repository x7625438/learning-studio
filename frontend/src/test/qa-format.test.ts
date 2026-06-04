import { describe, expect, it } from 'vitest'
import { formatAiAnswer } from '../utils/textbook-format'

describe('QA answer formatting', () => {
  it('formats markdown math into readable root notation', () => {
    const input = `
## 1. 均方误差 (MSE)
$$L = \\frac{1}{n}\\sum_{i=1}^{n}(y_i - \\hat{y}_i)^2$$

这一项还可能写成 sqrt(h/5) 或 $\\sqrt{3}$。
    `

    const output = formatAiAnswer(input)

    expect(output).not.toContain('sqrt(h/5)')
    expect(output).toContain('√(h/5)')
    expect(output).toContain('√3')
    expect(output).not.toContain('$$')
  })

  it('formats plain inline latex commands without dollar delimiters', () => {
    const input = 'R(\\theta)=\\frac1N\\sum_i \\ell\\big(f(x_i;\\theta),y_i\\big)'
    const output = formatAiAnswer(input)

    expect(output).toContain('R(\u03b8)=1/N')
    expect(output).toContain('\u2211_i')
    expect(output).toContain('\u2113')
    expect(output).not.toContain('\\theta')
    expect(output).not.toContain('\\frac')
    expect(output).not.toContain('\\sum')
    expect(output).not.toContain('\\ell')
    expect(output).not.toContain('\\big')
  })
})
