import { useState, useEffect, useRef, type FormEvent } from 'react'

interface Props {
  onSearch: (query: string) => void
  placeholder?: string
  initialValue?: string
}

export default function KnowledgeSearch({ onSearch, placeholder = '搜索知识记忆...', initialValue = '' }: Props) {
  const [value, setValue] = useState(initialValue)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    setValue(initialValue)
  }, [initialValue])

  const debouncedSearch = (query: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      onSearch(query.trim())
    }, 350)
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (timerRef.current) clearTimeout(timerRef.current)
    onSearch(value.trim())
  }

  return (
    <form onSubmit={handleSubmit} className="relative">
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          debouncedSearch(e.target.value)
        }}
        placeholder={placeholder}
        className="w-full rounded-xl border border-stone-200 bg-white pl-10 pr-4 py-2.5 text-sm text-stone-800 placeholder:text-stone-400 focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none transition"
      />
    </form>
  )
}
