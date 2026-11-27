import { useEffect } from 'react'
import type { AlertToast } from '../hooks/useAlerts'
import { formatPrice } from '../lib/bithumb'

interface Props {
  toasts: AlertToast[]
  onDismiss: (id: string) => void
  onOpen: (market: string) => void
}

const LIFETIME_MS = 10000

function Toast({ toast, onDismiss, onOpen }: { toast: AlertToast; onDismiss: (id: string) => void; onOpen: (m: string) => void }) {
  useEffect(() => {
    const id = setTimeout(() => onDismiss(toast.id), LIFETIME_MS)
    return () => clearTimeout(id)
  }, [toast.id, onDismiss])

  const a = toast.alert
  const up = a.direction === 'above'
  return (
    <div
      className={`toast ${up ? 'toast-up' : 'toast-down'}`}
      role="alert"
      onClick={() => {
        onOpen(a.market)
        onDismiss(toast.id)
      }}
    >
      <div className="toast-title">
        🔔 {toast.name} <span className={up ? 'up' : 'down'}>{up ? '▲ 상승 돌파' : '▼ 하락 돌파'}</span>
      </div>
      <div className="toast-body">
        목표가 {formatPrice(a.price)} · 현재가 {formatPrice(a.triggeredPrice!)}
        {a.note && <div className="toast-note">{a.note}</div>}
      </div>
      <button
        className="ap-x toast-x"
        aria-label="닫기"
        onClick={(e) => {
          e.stopPropagation()
          onDismiss(toast.id)
        }}
      >
        ✕
      </button>
    </div>
  )
}

export default function Toasts({ toasts, onDismiss, onOpen }: Props) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} onOpen={onOpen} />
      ))}
    </div>
  )
}
