import { useCallback, useEffect, useMemo, useState } from 'react'
import AlertPanel from './components/AlertPanel'
import Chart from './components/Chart'
import ChartErrorBoundary from './components/ChartErrorBoundary'
import Toasts from './components/Toasts'
import { useAlerts } from './hooks/useAlerts'
import { INDICATORS, normalizeParams, type IndicatorId, type IndicatorParams } from './lib/chartIndicators'
import IndicatorSettings from './components/IndicatorSettings'
import ShortcutHelp from './components/ShortcutHelp'
import { intervalKey, isPlainKey, isTypingTarget } from './lib/shortcuts'
import Watchlist from './components/Watchlist'
import { useMarketData } from './hooks/useMarketData'
import { LAYOUTS, useChartLayout, type LayoutId } from './hooks/useChartLayout'
import {
  baseOf,
  formatPrice,
  formatVolume,
  INTERVALS,
  pairLabel,
  priceDecimals,
  US_SESSION_LABEL,
  usSession,
} from './lib/market'
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

const EMPTY: number[] = []

/** True while the viewport is phone/tablet sized (matches the CSS breakpoint). */
function useNarrow(query = '(max-width: 900px)') {
  const [narrow, setNarrow] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return narrow
}

/** Small schematic of each layout for the toolbar buttons. */
function LayoutIcon({ id }: { id: LayoutId }) {
  const box = { x: 1.5, y: 2.5, w: 15, h: 13 }
  const lines =
    id === '2h' ? ['M9 2.5v13'] : id === '2v' ? ['M1.5 9h15'] : id === '4' ? ['M9 2.5v13', 'M1.5 9h15'] : []
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="1.5" />
      {lines.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

export default function App() {
  // Up to four charts; the active one is what the header, market list, toolbar and shortcuts control.
  const { layout, setLayout, count, cells, activeIndex, setActive, market, interval, setMarket, setInterval } =
    useChartLayout()
  // Phones: only the active chart is mounted (no hidden charts holding data connections).
  const narrow = useNarrow()
  const [indicatorStr, setIndicatorStr] = usePersisted<string>('chartview:indicators', 'ma,rsi')
  const indicators = useMemo(
    () => indicatorStr.split(',').filter((s): s is IndicatorId => INDICATORS.some((d) => d.id === s)),
    [indicatorStr],
  )
  const toggleIndicator = (id: IndicatorId) =>
    setIndicatorStr((prev) => {
      const cur = prev.split(',').filter(Boolean)
      return (cur.includes(id) ? cur.filter((i) => i !== id) : [...cur, id]).join(',')
    })
  const { markets, tickers, addUsMarket, removeUsMarket } = useMarketData()

  const nameOf = useCallback(
    (code: string) => markets.find((m) => m.market === code)?.korean_name ?? baseOf(code),
    [markets],
  )
  const { active, history, addAlert, removeAlert, clearHistory, toasts, dismissToast } = useAlerts(
    tickers,
    nameOf,
    setMarket,
  )
  const [alertsOpen, setAlertsOpen] = useState(false)

  // Indicator periods etc., saved as JSON and validated on load.
  const [indicatorParams, setIndicatorParams] = useState<IndicatorParams>(() => {
    try {
      return normalizeParams(JSON.parse(localStorage.getItem('chartview:indicator-params') ?? 'null'))
    } catch {
      return normalizeParams(null)
    }
  })
  const applyIndicatorParams = useCallback((p: IndicatorParams) => {
    setIndicatorParams(p)
    try {
      localStorage.setItem('chartview:indicator-params', JSON.stringify(p))
    } catch {
      /* storage unavailable */
    }
  }, [])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  const [helpOpen, setHelpOpen] = useState(false)
  const closeHelp = useCallback(() => setHelpOpen(false), [])

  // Global shortcuts: 1–9 interval, "/" search, "?" help. (Chart and Watchlist handle their own keys.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e) || !isPlainKey(e)) return
      if (e.key === '?') {
        e.preventDefault()
        setHelpOpen((o) => !o)
      } else if (e.key === '/') {
        e.preventDefault()
        const search = document.querySelector<HTMLInputElement>('.search')
        search?.focus()
        search?.select()
      } else if (/^[1-9]$/.test(e.key)) {
        const iv = INTERVALS[Number(e.key) - 1]
        if (iv) setInterval(iv.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setInterval])
  const closeAlerts = useCallback(() => setAlertsOpen(false), [])
  const alertPricesByMarket = useMemo(() => {
    const map: Record<string, number[]> = {}
    for (const a of active) (map[a.market] ??= []).push(a.price)
    return map
  }, [active])
  const addAlertFor = (code: string, price: number) => {
    const cur = tickers[code]?.trade_price
    // Chart clicks give arbitrary decimals; round to the coin's price precision.
    if (cur !== undefined) addAlert(code, +price.toFixed(priceDecimals(code, cur)), cur)
  }

  /** US stocks: false while closed or on a holiday (no trade in 30 minutes during a session). */
  const isMarketOpen = (code: string) => {
    if (!code.startsWith('US-')) return true
    const s = usSession()
    const ts = tickers[code]?.timestamp
    const stale = ts !== undefined && Date.now() - ts > 30 * 60 * 1000
    return s !== 'closed' && !stale
  }

  const info = markets.find((m) => m.market === market)
  const t = tickers[market]
  const cls = !t || t.change === 'EVEN' ? '' : t.change === 'RISE' ? 'up' : 'down'
  const sign = t && t.signed_change_price > 0 ? '+' : ''

  // US stocks: is the market trading right now? A session with no trade in the
  // last 30 minutes is shown as a holiday (exchange holidays aren't in our clock).
  const isUs = market.startsWith('US-')
  const session = isUs ? usSession() : null
  const staleMs = t?.timestamp ? Date.now() - t.timestamp : null
  const holiday = session && session !== 'closed' && staleMs !== null && staleMs > 30 * 60 * 1000
  const lastTrade = t?.timestamp
    ? new Date(t.timestamp).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  useEffect(() => {
    document.title = t ? `${formatPrice(t.trade_price, market)} ${pairLabel(market)} · ChartView` : 'ChartView'
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
          <span className="symbol-code">{pairLabel(market)}</span>
          {session && (
            <span
              className={`mkt-status ${holiday ? 'closed' : session}`}
              title={lastTrade ? `최근 체결 ${lastTrade} (한국 시간)` : undefined}
            >
              {holiday ? '휴장·거래 없음' : US_SESSION_LABEL[session]}
              {lastTrade && <small> · 최근 체결 {lastTrade}</small>}
            </span>
          )}
          {t && (
            <>
              <span className={`symbol-price ${cls}`}>{formatPrice(t.trade_price, market)}</span>
              <span className={`symbol-change ${cls}`}>
                {sign}
                {(t.signed_change_rate * 100).toFixed(2)}% {sign}
                {formatPrice(t.signed_change_price, market, t.trade_price)}
              </span>
            </>
          )}
        </div>
        <div className="top-right">
          {t && (
            <div className="stats">
              <div>
                고가<b className="up">{formatPrice(t.high_price, market)}</b>
              </div>
              <div>
                저가<b className="down">{formatPrice(t.low_price, market)}</b>
              </div>
              <div>
                거래대금(24H)<b>{formatVolume(t.acc_trade_price_24h, market)}</b>
              </div>
            </div>
          )}
          <button
            className={`bell ${alertsOpen ? 'on' : ''}`}
            data-alert-toggle
            aria-label={`가격 알림 (대기 ${active.length}개)`}
            title="가격 알림"
            onClick={() => setAlertsOpen((o) => !o)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            {active.length > 0 && <span className="badge">{active.length}</span>}
          </button>
        </div>
      </header>
      {alertsOpen && (
        <AlertPanel
          key={market}
          market={market}
          marketName={nameOf(market)}
          ticker={t}
          tickers={tickers}
          active={active}
          history={history}
          nameOf={nameOf}
          onAdd={(price, note) => t && addAlert(market, price, t.trade_price, note)}
          onRemove={removeAlert}
          onClearHistory={clearHistory}
          onOpenMarket={setMarket}
          onClose={closeAlerts}
        />
      )}
      <Toasts toasts={toasts} onDismiss={dismissToast} onOpen={setMarket} />
      {helpOpen && <ShortcutHelp onClose={closeHelp} />}

      <main className="main">
        <div className="toolbar">
          {INTERVALS.map((iv, i) => (
            <button
              key={iv.id}
              className={`tb-btn ${iv.id === interval ? 'on' : ''}`}
              title={intervalKey(i) ? `${iv.label} (${intervalKey(i)})` : iv.label}
              onClick={() => setInterval(iv.id)}
            >
              {iv.label}
            </button>
          ))}
          <span className="sep" />
          {INDICATORS.map((d) => (
            <button
              key={d.id}
              className={`tb-btn ${indicators.includes(d.id) ? 'on' : ''}`}
              onClick={() => toggleIndicator(d.id)}
            >
              {d.label}
            </button>
          ))}
          <button
            className={`tb-btn ${settingsOpen ? 'on' : ''}`}
            data-settings-toggle
            title="지표 기간 설정"
            aria-label="지표 설정"
            onClick={() => setSettingsOpen((o) => !o)}
          >
            ⚙ 설정
          </button>
          {settingsOpen && (
            <IndicatorSettings params={indicatorParams} onApply={applyIndicatorParams} onClose={closeSettings} />
          )}
          <span className="layout-btns" role="group" aria-label="차트 배치">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                className={`tb-btn layout-btn ${layout === l.id ? 'on' : ''}`}
                title={l.label}
                aria-label={l.label}
                aria-pressed={layout === l.id}
                onClick={() => setLayout(l.id)}
              >
                <LayoutIcon id={l.id} />
              </button>
            ))}
          </span>
          <button
            className="tb-btn kbd-btn"
            title="키보드 단축키 (?)"
            aria-label="키보드 단축키"
            onClick={() => setHelpOpen(true)}
          >
            ⌨
          </button>
        </div>
        <div className={`chart-grid layout-${layout}`}>
          {cells.slice(0, count).map((c, i) => {
            if (narrow && i !== activeIndex) return null
            const tk = tickers[c.market]
            const tone = !tk || tk.change === 'EVEN' ? '' : tk.change === 'RISE' ? 'up' : 'down'
            return (
              <div
                key={i}
                className={`chart-cell ${i === activeIndex ? 'active' : ''}`}
                onPointerDownCapture={() => i !== activeIndex && setActive(i)}
              >
                {count > 1 && (
                  <div className="cell-head" title="클릭하면 이 차트를 선택합니다">
                    <b>{nameOf(c.market)}</b>
                    <span>{pairLabel(c.market)}</span>
                    <span>· {INTERVALS.find((iv) => iv.id === c.interval)?.label}</span>
                    {tk && <span className={`cell-price ${tone}`}>{formatPrice(tk.trade_price, c.market)}</span>}
                  </div>
                )}
                <ChartErrorBoundary resetKey={c.market + '|' + c.interval}>
                <Chart
                  market={c.market}
                  interval={c.interval}
                  indicators={indicators}
                  indicatorParams={indicatorParams}
                  alertPrices={alertPricesByMarket[c.market] ?? EMPTY}
                  onAlertAt={(price) => addAlertFor(c.market, price)}
                  marketOpen={isMarketOpen(c.market)}
                  active={i === activeIndex}
                />
                </ChartErrorBoundary>
              </div>
            )
          })}
        </div>
      </main>

      <Watchlist
        markets={markets}
        tickers={tickers}
        selected={market}
        onSelect={setMarket}
        onAddUs={(symbol, name) => addUsMarket(symbol, name)?.market ?? null}
        onRemoveUs={(code) => {
          removeUsMarket(code)
          if (code === market) setMarket('US-AAPL')
        }}
      />
    </div>
  )
}
