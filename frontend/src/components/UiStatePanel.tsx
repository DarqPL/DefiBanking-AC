type UiStatePanelKind = 'loading' | 'empty' | 'error' | 'info'

type UiStatePanelProps = {
  kind: UiStatePanelKind
  title: string
  message: string
  actionLabel?: string
  onAction?: () => void
}

export function UiStatePanel({ kind, title, message, actionLabel, onAction }: UiStatePanelProps) {
  const role = kind === 'loading' ? 'status' : kind === 'error' ? 'alert' : undefined

  return (
    <div className={`ui-state-panel ui-state-panel-${kind}`} role={role} aria-live={kind === 'loading' ? 'polite' : undefined}>
      <span className="ui-state-icon" aria-hidden="true">
        {kind === 'loading' ? '' : kind === 'error' ? '!' : 'i'}
      </span>
      <div>
        <h3>{title}</h3>
        <p>{message}</p>
        {actionLabel && onAction && (
          <button className="secondary-button compact-button" type="button" onClick={onAction}>
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  )
}
