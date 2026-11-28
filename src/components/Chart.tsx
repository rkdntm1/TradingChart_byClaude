import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  PriceScaleMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import {
  bucketStart,
  formatPrice,
  INTERVAL_SEC,
  KST_OFFSET,
  priceDecimals,
  sourceOf,
  type Candle,
  type Interval,
} from '../lib/market'
import { buildIndicator, INDICATORS, type IndicatorGroup, type IndicatorId } from '../lib/chartIndicators'
import {
  colorOf,
  DRAW_COLORS,
  DrawingsPrimitive,
  loadDrawings,
  POINTS_NEEDED,
  saveDrawings,
  type Drawing,
  type Point,
  type ToolId,
} from '../lib/drawings'
import DrawingToolbar from './DrawingToolbar'

export const UP = '#e8473f'
export const DOWN = '#3b74f0'

const toTime = (utcSec: number) => (utcSec + KST_OFFSET) as UTCTimestamp

interface Props {
  market: string
  interval: Interval
  indicators: IndicatorId[]
  /** Active alert prices for this market, drawn as dashed lines. */
  alertPrices: number[]
  /** False while the market is closed (US stocks off-hours or on a holiday): hides the bar countdown. */
  marketOpen?: boolean
  /** Called when the user places an alert with the chart's alert tool. */
  onAlertAt: (price: number) => void
}

interface Legend {
  bar: Candle
  /** Index into the loaded bars (for indicator values). */
  index: number
  prevClose?: number
}

type ScaleMode = 'normal' | 'log' | 'percent'

const SCALE_MODE: Record<ScaleMode, PriceScaleMode> = {
  normal: PriceScaleMode.Normal,
  log: PriceScaleMode.Logarithmic,
  percent: PriceScaleMode.Percentage,
}

function readPref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback
  } catch {
    return fallback
  }
}

function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable */
  }
}

const legendAt = (bars: Candle[], i: number): Legend => ({ bar: { ...bars[i] }, index: i, prevClose: bars[i - 1]?.close })

/** "12:34" / "1:02:03" / "2일 03:04:05" until the current bar closes. */
function fmtCountdown(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  const clock = h || d ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
  return d ? `${d}일 ${clock}` : clock
}

export default function Chart({ market, interval, indicators, alertPrices, onAlertAt, marketOpen = true }: Props) {
  const onAlertAtRef = useRef(onAlertAt)
  onAlertAtRef.current = onAlertAt
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const candlesRef = useRef<Candle[]>([])
  const groupsRef = useRef<IndicatorGroup[]>([])
  const hoveringRef = useRef(false)
  const [scaleMode, setScaleMode] = useState<ScaleMode>(() => readPref<ScaleMode>('chartview:scale', 'normal'))
  const [magnet, setMagnet] = useState(() => readPref<string>('chartview:magnet', 'off') === 'on')
  const magnetRef = useRef(magnet)
  magnetRef.current = magnet
  const [awayFromLatest, setAwayFromLatest] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [groups, setGroups] = useState<IndicatorGroup[]>([])
  const [precision, setPrecision] = useState(0)
  const [legend, setLegend] = useState<Legend | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  // Drawing tools
  const primRef = useRef<DrawingsPrimitive | null>(null)
  const intervalRef = useRef(interval)
  intervalRef.current = interval
  const marketRef = useRef(market)
  marketRef.current = market
  const [tool, setTool] = useState<ToolId>('cursor')
  const toolRef = useRef(tool)
  toolRef.current = tool
  const [drafting, setDrafting] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawCount, setDrawCount] = useState(0)

  const persist = () => {
    const prim = primRef.current!
    saveDrawings(marketRef.current, prim.drawings)
    setDrawCount(prim.drawings.length)
  }

  const select = (id: string | null) => {
    primRef.current!.selectedId = id
    setSelectedId(id)
    primRef.current!.update()
  }

  const chooseTool = (next: ToolId) => {
    const prim = primRef.current!
    prim.draft = null
    setDrafting(false)
    if (next !== 'cursor') select(null)
    setTool(next)
    prim.update()
  }

  const deleteSelected = () => {
    const prim = primRef.current!
    if (!prim.selectedId) return
    prim.drawings = prim.drawings.filter((d) => d.id !== prim.selectedId)
    select(null)
    persist()
  }

  const [, setStyleVersion] = useState(0)
  const selectedDrawing = selectedId ? primRef.current?.drawings.find((d) => d.id === selectedId) : undefined
  const updateStyle = (patch: Pick<Drawing, 'color' | 'dashed'>) => {
    const prim = primRef.current!
    const d = prim.drawings.find((dr) => dr.id === prim.selectedId)
    if (!d) return
    Object.assign(d, patch)
    persist()
    setStyleVersion((v) => v + 1)
    prim.update()
  }

  const clearAll = () => {
    const prim = primRef.current!
    if (!prim.drawings.length || !window.confirm('이 종목의 모든 드로잉을 삭제할까요?')) return
    prim.drawings = []
    select(null)
    persist()
  }

  // Create the chart once.
  useEffect(() => {
    const el = containerRef.current!
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: getComputedStyle(el).getPropertyValue('--text-dim').trim() || '#8a8f98',
        fontFamily: 'inherit',
      },
      grid: {
        vertLines: { color: 'rgba(128,128,128,0.08)' },
        horzLines: { color: 'rgba(128,128,128,0.08)' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 6 },
      localization: { locale: 'ko-KR', priceFormatter: (p: number) => formatPrice(p, marketRef.current) },
    })
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
    })
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } })
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: 'vol',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    })
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })

    const prim = new DrawingsPrimitive(
      () => candlesRef.current,
      () => intervalRef.current,
      (p, ref) => formatPrice(p, marketRef.current, ref),
    )
    candles.attachPrimitive(prim)
    primRef.current = prim

    // Drawing: first click places the start point, second click finishes.
    // We listen to raw pointer events because the chart's own click event drops
    // a second click that lands inside its double-click window.
    const onPoint = (x: number, y: number) => {
      const current = toolRef.current
      if (current === 'cursor') {
        const id = prim.findAt(x, y)
        prim.selectedId = id
        setSelectedId(id)
        prim.update()
        return
      }
      const raw = prim.fromXY(x, y)
      if (!raw) return
      const pt = magnetRef.current ? prim.snap(raw, y) : raw
      if (current === 'alert') {
        onAlertAtRef.current?.(pt.price)
        toolRef.current = 'cursor'
        setTool('cursor')
        return
      }
      if (!prim.draft) {
        prim.draft = { id: crypto.randomUUID(), type: current, points: POINTS_NEEDED[current] === 1 ? [pt] : [pt, pt] }
        if (POINTS_NEEDED[current] > 1) {
          setDrafting(true)
          prim.update()
          return
        }
      } else {
        prim.draft.points[1] = pt
      }
      const done = prim.draft
      prim.drawings = [...prim.drawings, done]
      prim.draft = null
      prim.selectedId = done.id
      setSelectedId(done.id)
      setDrafting(false)
      toolRef.current = 'cursor' // a trailing dblclick must not start a new drawing
      setTool('cursor')
      saveDrawings(marketRef.current, prim.drawings)
      setDrawCount(prim.drawings.length)
      prim.update()
    }

    /** Pointer position relative to the main price pane, or null when outside it. */
    const local = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      // Only the main price pane (not the price axis or indicator panes).
      if (x < 0 || y < 0 || x > chart.timeScale().width() || y > chart.paneSize(0).height) return null
      return { x, y }
    }

    // Editing: in cursor mode, dragging a selected drawing's handle moves that
    // point; dragging the drawing's body moves the whole drawing.
    let down: { x: number; y: number } | null = null
    let drag: {
      id: string
      index: number | null // control point index, or null to move the whole drawing
      orig: Point[]
      start: { logical: number; price: number }
      moved: boolean
    } | null = null
    const setChartInteractive = (on: boolean) => chart.applyOptions({ handleScroll: on, handleScale: on })

    const onPointerDown = (e: PointerEvent) => {
      down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null
      if (!down || toolRef.current !== 'cursor') return
      const pos = local(e)
      if (!pos) return
      const handle = prim.handleAt(pos.x, pos.y)
      const id = handle !== null ? prim.selectedId : prim.findAt(pos.x, pos.y)
      const d = prim.drawings.find((dr) => dr.id === id)
      const start = prim.rawAt(pos.x, pos.y)
      if (!d || !start) return
      drag = { id: d.id, index: handle, orig: d.points.map((p) => ({ ...p })), start, moved: false }
      if (prim.selectedId !== d.id) {
        prim.selectedId = d.id
        setSelectedId(d.id)
      }
      setChartInteractive(false) // don't pan the chart while dragging a drawing
      el.setPointerCapture(e.pointerId)
      prim.update()
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!drag) return
      const d = prim.drawings.find((dr) => dr.id === drag!.id)
      if (!d) return
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      if (drag.index !== null) {
        const raw = prim.fromXY(x, y)
        if (!raw) return
        const pt = magnetRef.current ? prim.snap(raw, y) : raw
        d.points = d.points.map((p, i) => (i === drag!.index ? pt : p))
      } else {
        const cur = prim.rawAt(x, y)
        if (!cur) return
        d.points = prim.shift(drag.orig, Math.round(cur.logical - drag.start.logical), cur.price - drag.start.price)
      }
      drag.moved = true
      prim.update()
    }

    const onPointerUp = (e: PointerEvent) => {
      if (drag) {
        const moved = drag.moved
        drag = null
        setChartInteractive(true)
        if (moved) {
          down = null
          saveDrawings(marketRef.current, prim.drawings)
          return
        }
      }
      if (!down || e.button !== 0) return
      const dragged = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 // panning, not a click
      down = null
      if (dragged) return
      const pos = local(e)
      if (pos) onPoint(pos.x, pos.y)
    }
    el.addEventListener('pointerdown', onPointerDown, true)
    el.addEventListener('pointermove', onPointerMove, true)
    el.addEventListener('pointerup', onPointerUp, true)
    el.addEventListener('pointercancel', onPointerUp, true)

    chart.subscribeCrosshairMove((param) => {
      if (prim.draft && param.point && (param.paneIndex ?? 0) === 0) {
        const pt = prim.fromXY(param.point.x, param.point.y)
        if (pt) {
          prim.draft.points[1] = pt
          prim.update()
        }
      }
      const bars = candlesRef.current
      hoveringRef.current = param.time !== undefined
      if (!bars.length) return
      let i = bars.length - 1
      if (param.time !== undefined) {
        const t = (param.time as number) - KST_OFFSET
        const j = bars.findIndex((b) => b.time === t)
        if (j >= 0) i = j
      }
      setLegend(legendAt(bars, i))
    })

    // Show a "jump to latest" button once the newest bar scrolls out of view.
    let away = false
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      const n = candlesRef.current.length
      const next = !!range && n > 0 && range.to < n - 3
      if (next !== away) {
        away = next
        setAwayFromLatest(next)
      }
    })

    chartRef.current = chart
    candleRef.current = candles
    volumeRef.current = volume
    return () => {
      el.removeEventListener('pointerdown', onPointerDown, true)
      el.removeEventListener('pointermove', onPointerMove, true)
      el.removeEventListener('pointerup', onPointerUp, true)
      el.removeEventListener('pointercancel', onPointerUp, true)
      chart.remove()
      chartRef.current = null
      primRef.current = null
      groupsRef.current = []
    }
  }, [])

  // Price scale: normal / logarithmic / percentage.
  useEffect(() => {
    candleRef.current?.priceScale().applyOptions({ mode: SCALE_MODE[scaleMode] })
    writePref('chartview:scale', scaleMode)
  }, [scaleMode])

  // Magnet: crosshair snaps to OHLC, and drawings snap when placed or dragged.
  useEffect(() => {
    chartRef.current?.applyOptions({ crosshair: { mode: magnet ? CrosshairMode.Magnet : CrosshairMode.Normal } })
    writePref('chartview:magnet', magnet ? 'on' : 'off')
  }, [magnet])

  // Clock for the bar-close countdown.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Active price alerts for this market as dashed price lines.
  useEffect(() => {
    const series = candleRef.current!
    const lines = alertPrices.map((price) =>
      series.createPriceLine({
        price,
        color: '#f5b301',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '알림',
      }),
    )
    return () => lines.forEach((l) => series.removePriceLine(l))
  }, [alertPrices])

  // Each market keeps its own drawings.
  useEffect(() => {
    const prim = primRef.current!
    prim.drawings = loadDrawings(market)
    prim.draft = null
    prim.selectedId = null
    setSelectedId(null)
    setDrafting(false)
    setDrawCount(prim.drawings.length)
    prim.update()
  }, [market])

  // Keyboard: Esc cancels, Delete/Backspace removes the selected drawing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return
      if (e.key === 'Escape') {
        chooseTool('cursor')
        select(null)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // (Re)build indicator series whenever the selection or price precision changes.
  useEffect(() => {
    const chart = chartRef.current!
    for (const g of groupsRef.current) g.series.forEach((s) => chart.removeSeries(s))
    while (chart.panes().length > 1) chart.removePane(chart.panes().length - 1)

    // Keep a stable order regardless of click order.
    const ordered = INDICATORS.filter((d) => indicators.includes(d.id))
    let nextPane = 1
    const built = ordered.map((d) => buildIndicator(d.id, chart, d.pane === 'overlay' ? 0 : nextPane++, precision))
    const panes = chart.panes()
    // Relative sizes (not pixels) so the split survives window resizes:
    // price pane ≈ 4 parts, each indicator pane 1 part.
    panes[0]?.setStretchFactor(4)
    for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1)

    groupsRef.current = built
    setGroups(built)
    built.forEach((g) => g.render(candlesRef.current, false))
  }, [indicators, precision])

  // Load data + live updates whenever the market or interval changes.
  useEffect(() => {
    const chart = chartRef.current!
    const candleSeries = candleRef.current!
    const volumeSeries = volumeRef.current!
    let cancelled = false
    let loadingMore = false
    let reachedStart = false

    const volBar = (c: Candle) => ({
      time: toTime(c.time),
      value: c.volume,
      color: c.close >= c.open ? UP + '66' : DOWN + '66',
    })
    const ohlcBar = (c: Candle) => ({ time: toTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close })

    const renderAll = () => {
      const bars = candlesRef.current
      candleSeries.setData(bars.map(ohlcBar))
      volumeSeries.setData(bars.map(volBar))
      groupsRef.current.forEach((g) => g.render(bars, false))
    }

    // Live trades can arrive dozens of times a second; draw at most once per frame.
    let frame = 0
    let newBar = false
    const renderLast = () => {
      frame = 0
      const bars = candlesRef.current
      const last = bars[bars.length - 1]
      candleSeries.update(ohlcBar(last))
      volumeSeries.update(volBar(last))
      groupsRef.current.forEach((g) => g.render(bars, !newBar))
      newBar = false
      // Keep the OHLC legend on the live candle unless the user is hovering another bar.
      if (!hoveringRef.current) setLegend(legendAt(bars, bars.length - 1))
    }
    const scheduleRender = (isNewBar: boolean) => {
      newBar ||= isNewBar
      if (!frame) frame = requestAnimationFrame(renderLast)
    }

    setStatus('loading')
    candlesRef.current = []
    renderAll()

    const source = sourceOf(market)
    source
      .fetchCandles(market, interval)
      .then((bars) => {
        if (cancelled) return
        candlesRef.current = bars
        const precision = priceDecimals(market, bars[bars.length - 1]?.close ?? 1)
        candleSeries.applyOptions({
          priceFormat: { type: 'price', precision, minMove: 1 / 10 ** precision },
        })
        setPrecision(precision)
        renderAll()
        chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - 120), to: bars.length + 6 })
        setLegend(bars.length ? legendAt(bars, bars.length - 1) : null)
        setStatus('ready')
      })
      .catch(() => !cancelled && setStatus('error'))

    // Load older candles when the user scrolls to the left edge.
    const onRange = (range: { from: number; to: number } | null) => {
      if (!range || range.from > 15 || loadingMore || reachedStart) return
      const bars = candlesRef.current
      if (!bars.length) return
      loadingMore = true
      source
        .fetchCandles(market, interval, bars[0].time)
        .then((older) => {
          if (cancelled) return
          const fresh = older.filter((c) => c.time < bars[0].time)
          if (!fresh.length) {
            reachedStart = true
            return
          }
          const visible = chart.timeScale().getVisibleLogicalRange()
          candlesRef.current = [...fresh, ...candlesRef.current]
          renderAll()
          if (visible) {
            chart.timeScale().setVisibleLogicalRange({
              from: visible.from + fresh.length,
              to: visible.to + fresh.length,
            })
          }
        })
        .catch(() => {})
        .finally(() => {
          // brief pause to respect exchange rate limits
          setTimeout(() => (loadingMore = false), 300)
        })
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange)

    // Live updates. Coins stream trades and we build the current candle;
    // US stocks deliver ready-made bars (polled), which we merge by time.
    const onTrade = (t: { code: string; trade_price: number; trade_volume: number; trade_timestamp: number }) => {
      const bars = candlesRef.current
      if (cancelled || !bars.length || t.code !== market) return
      const start = bucketStart(t.trade_timestamp, interval, source.candleTzOffset)
      const last = bars[bars.length - 1]
      if (start < last.time) return
      if (start > last.time) {
        bars.push({ time: start, open: t.trade_price, high: t.trade_price, low: t.trade_price, close: t.trade_price, volume: t.trade_volume })
        scheduleRender(true)
      } else {
        last.high = Math.max(last.high, t.trade_price)
        last.low = Math.min(last.low, t.trade_price)
        last.close = t.trade_price
        last.volume += t.trade_volume
        scheduleRender(false)
      }
    }
    const onBar = (bar: Candle) => {
      const bars = candlesRef.current
      if (cancelled || !bars.length) return
      const last = bars[bars.length - 1]
      if (bar.time > last.time) {
        bars.push(bar)
        scheduleRender(true)
      } else if (bar.time === last.time) {
        bars[bars.length - 1] = bar
        scheduleRender(false)
      } else {
        // An earlier bar was revised (e.g. finalized late): patch it and redraw everything.
        const i = bars.findIndex((b) => b.time === bar.time)
        if (i >= 0) {
          bars[i] = bar
          renderAll()
        }
      }
    }
    const unsubscribe = source.subscribeBars
      ? source.subscribeBars(market, interval, onBar)
      : (source.subscribeTrades?.(market, onTrade) ?? (() => {}))

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      unsubscribe()
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange)
    }
  }, [market, interval])

  const bar = legend?.bar
  const up = bar ? bar.close >= bar.open : true
  const change = bar && legend?.prevClose ? ((bar.close - legend.prevClose) / legend.prevClose) * 100 : null
  const legendIndex = legend?.index ?? -1

  // Time left in the current bar. US stocks only while trading (App also catches
  // holidays from the last trade time) and only for intraday bars.
  const source = sourceOf(market)
  const isUs = source.id === 'us'
  const countdownSec =
    !marketOpen || (isUs && ['4h', '1D', '1W'].includes(interval))
      ? null
      : bucketStart(now, interval, source.candleTzOffset) + INTERVAL_SEC[interval] - now / 1000

  // Top offset (px) of each indicator pane, for its own legend.
  const paneTop = (pane: number) => {
    const c = chartRef.current
    if (!c) return 0
    let top = 0
    for (let k = 0; k < pane; k++) top += c.paneSize(k).height + 1
    return top
  }
  const fmtValue = (v: number | null, kind: 'price' | 'plain', ref?: number) =>
    v === null ? '-' : kind === 'price' ? formatPrice(v, market, ref) : v.toFixed(2)
  const refPrice = bar?.close
  return (
    <div className="chart-wrap">
      <DrawingToolbar
        tool={tool}
        onTool={chooseTool}
        canDelete={selectedId !== null}
        onDelete={deleteSelected}
        canClear={drawCount > 0}
        onClear={clearAll}
        magnet={magnet}
        onToggleMagnet={() => setMagnet((m) => !m)}
      />
      <div className={`chart-area ${tool !== 'cursor' ? 'drawing' : ''}`}>
      {tool !== 'cursor' && (
        <div className="draw-hint">
          {drafting
            ? '끝 지점을 클릭하세요'
            : tool === 'alert'
              ? '알림을 받을 가격을 클릭하세요'
              : tool === 'hline'
                ? '가격 위치를 클릭하세요'
                : '시작 지점을 클릭하세요'}{' '}
          · Esc 취소
        </div>
      )}
      {tool === 'cursor' && selectedDrawing && (
        <div className="draw-props" role="toolbar" aria-label="드로잉 스타일">
          {selectedDrawing.type !== 'fib' && (
            <>
              {DRAW_COLORS.map((c) => (
                <button
                  key={c}
                  className={`swatch ${colorOf(selectedDrawing) === c ? 'on' : ''}`}
                  style={{ background: c }}
                  title={c}
                  aria-label={`색상 ${c}`}
                  onClick={() => updateStyle({ color: c })}
                />
              ))}
              <span className="draw-sep-v" />
              <button
                className={`tb-btn ${!selectedDrawing.dashed ? 'on' : ''}`}
                onClick={() => updateStyle({ dashed: false })}
              >
                실선
              </button>
              <button
                className={`tb-btn ${selectedDrawing.dashed ? 'on' : ''}`}
                onClick={() => updateStyle({ dashed: true })}
              >
                점선
              </button>
              <span className="draw-sep-v" />
            </>
          )}
          <button className="tb-btn" onClick={deleteSelected}>
            삭제
          </button>
        </div>
      )}
      <div className="chart-legend">
        {bar && (
          <>
            <span>시 <b className={up ? 'up' : 'down'}>{formatPrice(bar.open, market)}</b></span>
            <span>고 <b className={up ? 'up' : 'down'}>{formatPrice(bar.high, market)}</b></span>
            <span>저 <b className={up ? 'up' : 'down'}>{formatPrice(bar.low, market)}</b></span>
            <span>종 <b className={up ? 'up' : 'down'}>{formatPrice(bar.close, market)}</b></span>
            {change !== null && (
              <b className={change >= 0 ? 'up' : 'down'}>
                {change >= 0 ? '+' : ''}
                {change.toFixed(2)}%
              </b>
            )}
            <span>거래량 <b>{bar.volume.toLocaleString('ko-KR', { maximumFractionDigits: 3 })}</b></span>
            {countdownSec !== null && (
              <span className="countdown" title="현재 봉 마감까지 남은 시간">
                ⏱ <b>{fmtCountdown(countdownSec)}</b>
              </span>
            )}
          </>
        )}
        {groups
          .filter((g) => g.pane === 0)
          .map((g) => (
            <div className="ind" key={g.id}>
              {g.id === 'bb' && <span style={{ color: g.legend[0].color }}>{g.title}</span>}
              {g.valuesAt(legendIndex).map((v) => (
                <span key={v.label} style={{ color: v.color }}>
                  {v.label} <b>{fmtValue(v.value, v.kind, refPrice)}</b>
                </span>
              ))}
            </div>
          ))}
      </div>
      {groups
        .filter((g) => g.pane > 0)
        .map((g) => (
          <div className="pane-legend" key={g.id} style={{ top: paneTop(g.pane) + 4 }}>
            <span className="pane-title">{g.title}</span>
            {g.valuesAt(legendIndex).map((v) => (
              <span key={v.label} style={{ color: v.color }}>
                {g.valuesAt(legendIndex).length > 1 && `${v.label} `}
                <b>{fmtValue(v.value, v.kind, refPrice)}</b>
              </span>
            ))}
          </div>
        ))}
      <div className="chart-ctrls">
        {awayFromLatest && (
          <button
            className="ctrl-btn latest"
            title="최신 봉으로 이동"
            onClick={() => chartRef.current?.timeScale().scrollToRealTime()}
          >
            최신 ⇥
          </button>
        )}
        {(['log', 'percent'] as const).map((m) => (
          <button
            key={m}
            className={`ctrl-btn ${scaleMode === m ? 'on' : ''}`}
            title={m === 'log' ? '로그 스케일' : '퍼센트 스케일 (화면 첫 봉 기준)'}
            aria-pressed={scaleMode === m}
            onClick={() => setScaleMode((cur) => (cur === m ? 'normal' : m))}
          >
            {m === 'log' ? 'log' : '%'}
          </button>
        ))}
      </div>
      {status === 'loading' && <div className="chart-overlay">불러오는 중…</div>}
      {status === 'error' && <div className="chart-overlay">시세를 불러오지 못했습니다</div>}
      <div ref={containerRef} className="chart" />
      </div>
    </div>
  )
}
