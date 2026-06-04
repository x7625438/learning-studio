import { FormEvent, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const login = useAuthStore((state) => state.login)
  const isLoading = useAuthStore((state) => state.isLoading)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    await login(username, password)
    navigate((location.state as { from?: string } | null)?.from || '/')
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form onSubmit={handleSubmit} className="paper-card w-full max-w-md p-8">
        <p className="text-sm font-bold uppercase tracking-[0.24em] text-emerald-800">Welcome back</p>
        <h1 className="ink-heading mt-3 text-4xl">登录学习空间</h1>
        <p className="mt-2 text-stone-600">继续你的档案、薄弱点和学习路径。</p>
        <div className="mt-8 space-y-4">
          <input className="field" placeholder="用户名" value={username} onChange={(event) => setUsername(event.target.value)} />
          <input className="field" type="password" placeholder="密码" value={password} onChange={(event) => setPassword(event.target.value)} />
        </div>
        <button disabled={isLoading} className="warm-button mt-6 w-full">
          {isLoading ? '登录中...' : '登录'}
        </button>
        <p className="mt-5 text-center text-sm text-stone-500">
          还没有账号？
          <Link to="/register" className="font-semibold text-emerald-900">
            注册
          </Link>
        </p>
      </form>
    </main>
  )
}
