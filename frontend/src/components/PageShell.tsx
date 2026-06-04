import { ReactNode } from 'react'

export function PageShell({
  eyebrow,
  title,
  description,
  action,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-sm font-bold uppercase tracking-[0.24em] text-emerald-800">{eyebrow}</p>
          <h1 className="ink-heading text-4xl md:text-5xl">{title}</h1>
          <p className="mt-3 max-w-2xl text-stone-600">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

export function SectionCard({
  title,
  description,
  children,
  className = '',
}: {
  title?: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`paper-card p-5 md:p-6 ${className}`}>
      {title && <h2 className="ink-heading text-xl">{title}</h2>}
      {description && <p className="mt-1 text-sm text-stone-500">{description}</p>}
      <div className={title || description ? 'mt-5' : ''}>{children}</div>
    </section>
  )
}

export function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-3xl border border-stone-200/80 bg-white/70 p-4">
      <p className="text-sm text-stone-500">{label}</p>
      <p className="mt-2 text-3xl font-bold text-emerald-950">{value}</p>
      {hint && <p className="mt-1 text-xs text-stone-500">{hint}</p>}
    </div>
  )
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-stone-200">
      <div className="h-full rounded-full bg-emerald-800" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-stone-300 bg-white/50 p-8 text-center">
      <p className="font-semibold text-stone-800">{title}</p>
      <p className="mt-2 text-sm text-stone-500">{description}</p>
    </div>
  )
}
