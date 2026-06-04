import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store'

export default function Register() {
  const navigate = useNavigate()
  const register = useAuthStore((state) => state.register)
  const isLoading = useAuthStore((state) => state.isLoading)
  const [form, setForm] = useState({ username: '', password: '' })

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    await register(form.username, form.password)
    navigate('/')
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form onSubmit={handleSubmit} className="paper-card w-full max-w-md p-8">
        <p className="text-sm font-bold uppercase tracking-[0.24em] text-emerald-800">Start</p>
        <h1 className="ink-heading mt-3 text-4xl">创建学习档案</h1>
        <p className="mt-2 text-stone-600">注册后会自动生成你的学习档案和默认目标。</p>
        <div className="mt-8 space-y-4">
          <input className="field" placeholder="用户名" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
          <input className="field" type="password" placeholder="至少 6 位密码" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
        </div>
        <button disabled={isLoading} className="warm-button mt-6 w-full">
          {isLoading ? '创建中...' : '注册并进入'}
        </button>
        <p className="mt-5 text-center text-sm text-stone-500">
          已有账号？
          <Link to="/login" className="font-semibold text-emerald-900">
            登录
          </Link>
        </p>
      </form>
    </main>
  )
}
