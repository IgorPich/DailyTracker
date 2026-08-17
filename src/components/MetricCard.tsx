import type { LucideIcon } from 'lucide-react'

interface MetricCardProps {
  label: string
  value: string
  unit?: string
  detail?: string
  icon: LucideIcon
  tone?: 'default' | 'positive' | 'negative'
}

export function MetricCard({ label, value, unit, detail, icon: Icon, tone = 'default' }: MetricCardProps) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <div className="metric-card__top">
        <span>{label}</span>
        <Icon size={17} strokeWidth={1.8} />
      </div>
      <div className="metric-card__value">
        {value} {unit && <small>{unit}</small>}
      </div>
      {detail && <p>{detail}</p>}
    </article>
  )
}
