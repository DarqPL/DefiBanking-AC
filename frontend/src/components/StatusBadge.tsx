type StatusBadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

type StatusBadgeProps = {
  children: string
  tone?: StatusBadgeTone
}

export function StatusBadge({ children, tone = 'neutral' }: StatusBadgeProps) {
  return <span className={`status-badge status-badge-${tone}`}>{children}</span>
}
