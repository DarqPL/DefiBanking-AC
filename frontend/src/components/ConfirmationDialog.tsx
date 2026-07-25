import { useEffect, useId, useRef, type ReactNode } from 'react'

type ConfirmationDialogProps = {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
  children?: ReactNode
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  tone = 'default',
  children,
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return undefined

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    queueMicrotask(() => cancelButtonRef.current?.focus())

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onCancel, open])

  if (!open) return null

  return (
    <div className="dialog-backdrop" role="presentation" onClick={(event) => event.target === event.currentTarget && onCancel()}>
      <section
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <div className="section-header">
          <p className="eyebrow">Review action</p>
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>

        {children && <div className="dialog-content">{children}</div>}

        <div className="dialog-actions">
          <button ref={cancelButtonRef} className="secondary-button" type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={tone === 'danger' ? 'secondary-button danger-button' : 'primary-button'} type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
