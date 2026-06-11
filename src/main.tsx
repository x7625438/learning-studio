import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-error">
          <div>
            <strong>页面加载失败</strong>
            <p>系统遇到异常，请刷新页面重试。</p>
            {import.meta.env.DEV && <code>{this.state.error.message}</code>}
            <button type="button" onClick={() => window.location.reload()}>刷新页面</button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
