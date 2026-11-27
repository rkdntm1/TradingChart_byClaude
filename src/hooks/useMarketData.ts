import { useEffect, useState } from 'react'
import { fetchMarkets, fetchTickers, subscribe, type Market, type Ticker } from '../lib/upbit'

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

    fetchMarkets()
      .then(async (list) => {
        if (cancelled) return
        setMarkets(list)
        const codes = list.map((m) => m.market)
        const initial = await fetchTickers(codes)
        if (cancelled) return
        setTickers(Object.fromEntries(initial.map((t) => [t.code, t])))
        unsubscribe = subscribe<Ticker>('ticker', codes, (t) => {
          pending[t.code] = t
          if (!frame) frame = requestAnimationFrame(flush)
        })
      })
      .catch(() => {})

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      unsubscribe?.()
    }
  }, [])

  return { markets, tickers }
}
