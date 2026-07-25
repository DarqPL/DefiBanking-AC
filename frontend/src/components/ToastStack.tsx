import { useEffect, useRef, useState } from 'react'

export type ToastItem = {
  id: string
  message: string
  tone: 'status' | 'success' | 'error'
}

type ToastStackProps = {
  items: ToastItem[]
  onDismiss: (id: string) => void
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const [dragX, setDragX] = useState(0)
  const startXRef = useRef<number | null>(null)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => onDismiss(item.id), 30_000)
    return () => window.clearTimeout(timeoutId)
  }, [item.id, onDismiss])

  return (
    <div
      className={`toast toast-${item.tone}`}
      role={item.tone === 'error' ? 'alert' : 'status'}
      style={{ transform: dragX === 0 ? undefined : `translateX(${dragX}px)` }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('button')) return

        startXRef.current = event.clientX
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (startXRef.current === null) return
        setDragX(event.clientX - startXRef.current)
      }}
      onPointerUp={() => {
        if (Math.abs(dragX) > 72) {
          onDismiss(item.id)
          return
        }

        setDragX(0)
        startXRef.current = null
      }}
      onPointerCancel={() => {
        setDragX(0)
        startXRef.current = null
      }}
    >
      <span className="toast-dot" aria-hidden="true" />
      <p>{item.message}</p>
      <button
        type="button"
        aria-label="Dismiss notification"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onDismiss(item.id)}
      >
        X
      </button>
    </div>
  )
}

export function ToastStack({ items, onDismiss }: ToastStackProps) {
  if (items.length === 0) return null

  return (
    <div className="toast-stack" aria-live="polite" aria-relevant="additions text">
      {items.map((item) => (
        <Toast key={item.id} item={item} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
