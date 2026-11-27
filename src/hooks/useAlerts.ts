import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  directionFor,
  isHit,
  loadAlerts,
  playChime,
  saveAlerts,
  showSystemNotification,
  unlockSound,
  type PriceAlert,
} from '../lib/alerts'
import { formatPrice, priceUnit, type Ticker } from '../lib/market'

export interface AlertToast {
  id: string
  alert: PriceAlert
  name: string
}

/**
 * Price alerts checked against the live ticker stream (which already covers
 * every market on every source), so alerts fire for any coin, not just the one on screen.
 */
export function useAlerts(
  tickers: Record<string, Ticker>,
  nameOf: (market: string) => string,
  onOpenMarket: (market: string) => void,
) {
  const [alerts, setAlerts] = useState<PriceAlert[]>(loadAlerts)
  const [toasts, setToasts] = useState<AlertToast[]>([])

  useEffect(() => saveAlerts(alerts), [alerts])

  useEffect(() => {
    const fired: { alert: PriceAlert; price: number }[] = []
    for (const a of alerts) {
      if (a.triggeredAt) continue
      const t = tickers[a.market]
      if (t && isHit(a, t.trade_price)) fired.push({ alert: a, price: t.trade_price })
    }
    if (!fired.length) return

    const now = Date.now()
    const done = fired.map(({ alert, price }) => ({ ...alert, triggeredAt: now, triggeredPrice: price }))
    setAlerts((prev) => prev.map((a) => done.find((d) => d.id === a.id && !a.triggeredAt) ?? a))
    setToasts((prev) => [...prev, ...done.map((a) => ({ id: a.id, alert: a, name: nameOf(a.market) }))])

    playChime()
    for (const a of done) {
      const arrow = a.direction === 'above' ? '▲ 상승 돌파' : '▼ 하락 돌파'
      showSystemNotification(
        `${nameOf(a.market)} ${arrow}`,
        `목표가 ${formatPrice(a.price, a.market)}${priceUnit(a.market)} · 현재가 ${formatPrice(a.triggeredPrice!, a.market)}${priceUnit(a.market)}${a.note ? `\n${a.note}` : ''}`,
        () => onOpenMarket(a.market),
      )
    }
  }, [tickers, alerts, nameOf, onOpenMarket])

  const addAlert = useCallback((market: string, price: number, current: number, note?: string) => {
    unlockSound() // called from a click, so the browser lets us play the chime later
    const alert: PriceAlert = {
      id: crypto.randomUUID(),
      market,
      price,
      direction: directionFor(price, current),
      note: note?.trim() || undefined,
      createdAt: Date.now(),
    }
    setAlerts((prev) => [...prev, alert])
    return alert
  }, [])

  const removeAlert = useCallback((id: string) => setAlerts((prev) => prev.filter((a) => a.id !== id)), [])
  const clearHistory = useCallback(() => setAlerts((prev) => prev.filter((a) => !a.triggeredAt)), [])
  const dismissToast = useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), [])

  const active = useMemo(() => alerts.filter((a) => !a.triggeredAt).sort((a, b) => b.createdAt - a.createdAt), [alerts])
  const history = useMemo(
    () => alerts.filter((a) => a.triggeredAt).sort((a, b) => b.triggeredAt! - a.triggeredAt!),
    [alerts],
  )

  return { active, history, addAlert, removeAlert, clearHistory, toasts, dismissToast }
}
