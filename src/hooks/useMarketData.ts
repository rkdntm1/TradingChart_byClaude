import { useEffect, useState } from 'react'
import { fetchMarkets, fetchTickers, isValidTicker, subscribe, type Market, type Ticker } from '../lib/bithumb'

/** All KRW markets plus live 24h tickers for each (batched to one render per frame). */
export function useMarketData() {
  const [markets, setMarkets] = useState<Market[]>([])
  const [tickers, setTickers] = useState<Record<string, Ticker>>({})

  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    let cancelled = false
    let pending: Record<string, Ticker> = {}
    let frame = 0

    const flush = () => {
      frame = 0
      const batch = pending
      pending = {}
      setTickers((prev) => ({ ...prev, ...batch }))
    }

    let retryTimer: ReturnType<typeof setTimeout> | undefined

    const start = async () => {
      try {
        const list = await fetchMarkets()
        if (cancelled) return
        setMarkets(list)
        const codes = list.map((m) => m.market)
        const initial = await fetchTickers(codes)
        if (cancelled) return
        setTickers(Object.fromEntries(initial.map((t) => [t.code, t])))
        unsubscribe = subscribe<Ticker>('ticker', codes, (t) => {
          if (!isValidTicker(t)) return
          pending[t.code] = t
          if (!frame) frame = requestAnimationFrame(flush)
        })
      } catch {
        // fetch already retried with backoff; keep trying slowly rather than staying empty
        if (!cancelled) retryTimer = setTimeout(start, 10000)
      }
    }
    start()

    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      cancelAnimationFrame(frame)
      unsubscribe?.()
    }
  }, [])

  return { markets, tickers }
}
