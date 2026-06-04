import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../App'

describe('routing', () => {
  it('renders login when unauthenticated', () => {
    localStorage.removeItem('auth_token')
    window.history.pushState({}, '', '/qa')
    render(<App />)
    expect(screen.getByText('登录学习空间')).toBeTruthy()
  })

  it('renders register route', () => {
    window.history.pushState({}, '', '/register')
    render(<App />)
    expect(screen.getByText('创建学习档案')).toBeTruthy()
  })
})
