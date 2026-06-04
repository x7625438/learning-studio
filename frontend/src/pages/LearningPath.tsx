import { FormEvent, useEffect, useRef, useState } from 'react'
import { EmptyState, PageShell, SectionCard } from '../components/PageShell'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { useLearningPathStore, useNotificationStore } from '../store'
import { API_ENDPOINTS } from '../utils/api-client'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export default function LearningPath() {
  const { current, generate, fetchCurrent, deletePath } = useLearningPathStore()
  const { addNotification } = useNotificationStore()
  const [topic, setTopic] = useState('')
  const [currentLevel, setCurrentLevel] = useState('beginner')
  const [goal, setGoal] = useState('exam')
  const [hoursPerWeek, setHoursPerWeek] = useState(6)
  const [targetWeeks, setTargetWeeks] = useState(4)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchCurrent().catch(() => undefined)
  }, [fetchCurrent])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!topic.trim() || isGenerating) return
    setIsGenerating(true)
    try {
      await generate({ topic, currentLevel, goal, hoursPerWeek, targetWeeks })
      setChatMessages([]) // 清空之前的对话
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleChatSubmit(event: FormEvent) {
    event.preventDefault()
    if (!chatInput.trim() || isSending || !current?.id) return

    const userMessage = chatInput.trim()
    setChatInput('')
    setChatMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setIsSending(true)

    try {
      const response = await fetch(`${API_ENDPOINTS.LEARNING_PATH}/${current.id}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({ message: userMessage }),
      })

      if (!response.ok) {
        throw new Error('发送失败')
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let aiResponse = ''

      if (reader) {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value)
          const lines = chunk.split('\n')

          for (const line of lines) {
            if (line.startsWith('data:')) {
              const data = line.slice(5).trim()
              if (data && data !== '[DONE]') {
                try {
                  const parsed = JSON.parse(data)
                  if (parsed.type === 'text') {
                    aiResponse += parsed.content
                    setChatMessages((prev) => {
                      const newMessages = [...prev]
                      const lastMsg = newMessages[newMessages.length - 1]
                      if (lastMsg && lastMsg.role === 'assistant') {
                        lastMsg.content = aiResponse
                      } else {
                        newMessages.push({ role: 'assistant', content: aiResponse })
                      }
                      return newMessages
                    })
                  }
                } catch (e) {
                  // 忽略解析错误
                }
              }
            }
          }
        }
      }
    } catch (error) {
      addNotification({ type: 'error', message: '发送消息失败' })
    } finally {
      setIsSending(false)
    }
  }

  async function handleDeletePath() {
    if (!current?.id) return
    if (!confirm('确定要删除当前学习路径吗？此操作无法撤销。')) return

    setIsDeleting(true)
    try {
      await deletePath(current.id)
      setChatMessages([])
      addNotification({ type: 'success', message: '学习路径已删除' })
    } catch (error) {
      addNotification({ type: 'error', message: '删除失败，请重试' })
    } finally {
      setIsDeleting(false)
    }
  }

  const weeks = current?.weeks || current?.weeks_data || []

  return (
    <PageShell
      eyebrow="P2-2 Path"
      title="学习路径生成器"
      description="根据你的目标和时间，生成可执行的周计划。"
    >
      <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
        <SectionCard title="告诉我你的学习目标" description="生成后会成为当前路径，后续可同步到日历与里程碑。">
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="text-sm font-semibold text-stone-600">想学什么</span>
              <input className="field mt-2" placeholder="例如：考研数学一 / 机器学习 / 英语阅读" value={topic} onChange={(event) => setTopic(event.target.value)} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-stone-600">当前水平</span>
              <select className="field mt-2" value={currentLevel} onChange={(event) => setCurrentLevel(event.target.value)}>
                <option value="zero">零基础</option>
                <option value="beginner">入门</option>
                <option value="intermediate">中等</option>
                <option value="advanced">进阶</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-stone-600">学习目的</span>
              <select className="field mt-2" value={goal} onChange={(event) => setGoal(event.target.value)}>
                <option value="exam">考试提分</option>
                <option value="project">做项目</option>
                <option value="deep_understanding">深入理解</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-semibold text-stone-600">每周学习时长（小时）</span>
                <input className="field mt-2" type="number" min={1} max={168} value={hoursPerWeek} onChange={(event) => setHoursPerWeek(Number(event.target.value))} />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-stone-600">目标周数</span>
                <input className="field mt-2" type="number" min={1} max={52} value={targetWeeks} onChange={(event) => setTargetWeeks(Number(event.target.value))} />
              </label>
            </div>
            <button className="warm-button w-full disabled:cursor-not-allowed disabled:opacity-60" disabled={isGenerating}>
              {isGenerating ? 'AI 规划中...' : '生成周计划'}
            </button>
          </form>
        </SectionCard>
        <div className="space-y-5">
          <SectionCard title={current?.topic || '当前路径'}>
            {weeks.length ? (
              <>
                <div className="mb-4 flex justify-end">
                  <button
                    className="ghost-button text-red-600 hover:bg-red-50"
                    onClick={handleDeletePath}
                    disabled={isDeleting}
                  >
                    {isDeleting ? '删除中...' : '删除路径'}
                  </button>
                </div>
                <div className="space-y-4">
                  {weeks.map((week) => (
                    <article key={week.weekNumber} className="rounded-3xl bg-white/75 p-5">
                      <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-800">Week {week.weekNumber}</p>
                      <h3 className="mt-2 text-xl font-semibold text-stone-900">{week.title}</h3>
                      <p className="mt-3 text-sm text-stone-600">主题：{week.topics.join(' / ')}</p>
                      <p className="mt-2 text-sm text-stone-600">练习：{week.exercises.join(' / ')}</p>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <EmptyState title="还没有学习路径" description="先填写目标。系统不会预设路径，避免误导你的计划。" />
            )}
          </SectionCard>

          {weeks.length > 0 && (
            <SectionCard title="与 AI 对话调整路径" description="告诉我你的想法，我会帮你量身定制学习计划">
              <div className="space-y-4">
                <div className="max-h-96 space-y-3 overflow-y-auto rounded-2xl bg-stone-50 p-4">
                  {chatMessages.length === 0 ? (
                    <p className="text-center text-sm text-stone-400">
                      例如："第2周太难了，能简化一下吗？" 或 "我想加入深度学习的内容"
                    </p>
                  ) : (
                    chatMessages.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`rounded-2xl p-3 ${
                          msg.role === 'user'
                            ? 'ml-8 bg-emerald-100 text-emerald-900'
                            : 'mr-8 bg-white text-stone-700'
                        }`}
                      >
                        {msg.role === 'assistant' ? (
                          <MarkdownRenderer content={msg.content} className="text-sm" />
                        ) : (
                          <span className="text-sm">{msg.content}</span>
                        )}
                      </div>
                    ))
                  )}
                  <div ref={chatEndRef} />
                </div>
                <form onSubmit={handleChatSubmit} className="flex gap-2">
                  <input
                    className="field flex-1"
                    placeholder="说说你的想法..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    disabled={isSending}
                  />
                  <button
                    type="submit"
                    className="warm-button"
                    disabled={isSending || !chatInput.trim()}
                  >
                    {isSending ? '发送中...' : '发送'}
                  </button>
                </form>
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    </PageShell>
  )
}
