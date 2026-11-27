import { useEffect, useMemo, useState } from 'react'
import { registerMarkets, SOURCES, type Market, type SourceId, type Ticker } from '../lib/market'

/**
 * Markets and live 24h tickers from every data source (Bithumb KRW + Binance
 * USDT). Each source loads independently, so one failing doesn't block the
 * other. Ticker updates are batched to one render per animation frame.
 */
export function useMarketData() {
  const [bySource, setBySource] = useState<Partial<Record<SourceId, Market[]>>>({})
  const [tickers, setTickers] = useState<Record<string, Ticker>>({})

  useEffect(() => {
    let cancelled = false
    let pending: Record<string, Ticker> = {}
    let frame = 0
    const cleanups: (() => void)[] = []
    const timers: ReturnType<typeof setTimeout>[] = []

    const flush = () => {
      frame = 0
      const batch = pending
      pending = {}
      setTickers((prev) => ({ ...prev, ...batch }))
    }
    const push = (t: Ticker) => {
      pending[t.code] = t
      if (!frame) frame = requestAnimationFrame(flush)
    }

    for (const source of SOURCES) {
      const start = async () => {
        try {
          const list = await source.fetchMarkets()
          if (cancelled) return
          registerMarkets(list)
          setBySource((prev) => ({ ...prev, [source.id]: list }))
          const initial = await source.fetchTickers(list)
          if (cancelled) return
          setTickers((prev) => ({ ...prev, ...Object.fromEntries(initial.map((t) => [t.code, t])) }))
          cleanups.push(source.subscribeTickers(list, push))
        } catch {
          // requests already retried with backoff; keep trying slowly rather than staying empty
          if (!cancelled) timers.push(setTimeout(start, 10000))
        }
      }
      start()
    }

    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
      cancelAnimationFrame(frame)
      cleanups.forEach((c) => c())
    }
  }, [])

  // Binance has no Korean names: borrow them from Bithumb by base symbol (BTC → 비트코인).
  const markets = useMemo(() => {
    const korean = new Map((bySource.bithumb ?? []).map((m) => [m.base, m.korean_name]))
    const binance = (bySource.binance ?? []).map((m) => ({ ...m, korean_name: korean.get(m.base) ?? m.base }))
    return [...(bySource.bithumb ?? []), ...binance, ...(bySource.us ?? [])]
  }, [bySource])

  return { markets, tickers }
}
