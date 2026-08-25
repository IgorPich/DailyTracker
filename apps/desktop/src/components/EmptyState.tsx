import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function EmptyState({ icon: Icon, title, description, action }: {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon"><Icon size={22} /></span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  )
}
