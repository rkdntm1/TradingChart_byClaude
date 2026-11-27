import { useEffect, useState } from 'react'
import Chart from './components/Chart'
import Watchlist from './components/Watchlist'
import { useMarketData } from './hooks/useMarketData'
import { formatPrice, formatVolumeKrw, INTERVALS, type Interval } from './lib/upbit'
import './App.css'

function usePersisted<T extends string>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T) || initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* storage unavailable */
    }
  }, [key, value])
  return [value, setValue] as const
}

export default function App() {
  const [market, setMarket] = usePersisted<string>('chartview:market', 'KRW-BTC')
  const [interval, setInterval] = usePersisted<Interval>('chartview:interval', '15m')
  const { markets, tickers } = useMarketData()

  const info = markets.find((m) => m.market === market)
  const t = tickers[market]
  const cls = !t || t.change === 'EVEN' ? '' : t.change === 'RISE' ? 'up' : 'down'
  const sign = t && t.signed_change_price > 0 ? '+' : ''

  useEffect(() => {
    document.title = t ? `${formatPrice(t.trade_price)} ${market.replace('KRW-', '')} · ChartView` : 'ChartView'
  }, [t, market])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          ChartView
        </div>
        <div className="symbol">
          <span className="symbol-name">{info?.korean_name ?? market}</span>
          <span className="symbol-code">{market.replace('KRW-', '')}/KRW</span>
          {t && (
            <>
              <span className={`symbol-price ${cls}`}>{formatPrice(t.trade_price)}</span>
              <span className={`symbol-change ${cls}`}>
                {sign}
                {(t.signed_change_rate * 100).toFixed(2)}% {sign}
                {formatPrice(t.signed_change_price)}
              </span>
            </>
          )}
        </div>
        {t && (
          <div className="stats">
            <div>
              고가<b className="up">{formatPrice(t.high_price)}</b>
            </div>
            <div>
              저가<b className="down">{formatPrice(t.low_price)}</b>
            </div>
            <div>
              거래대금(24H)<b>{formatVolumeKrw(t.acc_trade_price_24h)}</b>
            </div>
          </div>
        )}
      </header>

      <main className="main">
        <div className="toolbar">
          {INTERVALS.map((iv) => (
            <button key={iv.id} className={`tb-btn ${iv.id === interval ? 'on' : ''}`} onClick={() => setInterval(iv.id)}>
              {iv.label}
            </button>
          ))}
        </div>
        <Chart market={market} interval={interval} />
      </main>

      <Watchlist markets={markets} tickers={tickers} selected={market} onSelect={setMarket} />
    </div>
  )
}
