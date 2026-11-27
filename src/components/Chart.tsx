import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import {
  bucketStart,
  fetchCandles,
  formatPrice,
  KST_OFFSET,
  pricePrecision,
  subscribe,
  type Candle,
  type Interval,
  type Trade,
} from '../lib/upbit'
import { buildIndicator, INDICATORS, type IndicatorGroup, type IndicatorId } from '../lib/chartIndicators'
import { DrawingsPrimitive, loadDrawings, POINTS_NEEDED, saveDrawings, type ToolId } from '../lib/drawings'
import DrawingToolbar from './DrawingToolbar'

export const UP = '#e8473f'
export const DOWN = '#3b74f0'

const toTime = (utcSec: number) => (utcSec + KST_OFFSET) as UTCTimestamp

interface Props {
  market: string
  interval: Interval
  indicators: IndicatorId[]
}

interface Legend {
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export default function Chart({ market, interval, indicators }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const candlesRef = useRef<Candle[]>([])
  const groupsRef = useRef<IndicatorGroup[]>([])
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
      localization: { locale: 'ko-KR', priceFormatter: formatPrice },
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
      formatPrice,
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
      const pt = prim.fromXY(x, y)
      if (!pt) return
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

    let down: { x: number; y: number } | null = null
    const onPointerDown = (e: PointerEvent) => {
      down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null
    }
    const onPointerUp = (e: PointerEvent) => {
      if (!down || e.button !== 0) return
      const dragged = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 // panning, not a click
      down = null
      if (dragged) return
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      // Only the main price pane (not the price axis or indicator panes).
      if (x > chart.timeScale().width() || y > chart.paneSize(0).height) return
      onPoint(x, y)
    }
    el.addEventListener('pointerdown', onPointerDown, true)
    el.addEventListener('pointerup', onPointerUp, true)

    chart.subscribeCrosshairMove((param) => {
      if (prim.draft && param.point && (param.paneIndex ?? 0) === 0) {
        const pt = prim.fromXY(param.point.x, param.point.y)
        if (pt) {
          prim.draft.points[1] = pt
          prim.update()
        }
      }
      const bars = candlesRef.current
      if (!bars.length) return
      let bar = bars[bars.length - 1]
      if (param.time !== undefined) {
        const t = (param.time as number) - KST_OFFSET
        bar = bars.find((b) => b.time === t) ?? bar
      }
      setLegend({ ...bar })
    })

    chartRef.current = chart
    candleRef.current = candles
    volumeRef.current = volume
    return () => {
      el.removeEventListener('pointerdown', onPointerDown, true)
      el.removeEventListener('pointerup', onPointerUp, true)
      chart.remove()
      chartRef.current = null
      primRef.current = null
      groupsRef.current = []
    }
  }, [])

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
    for (let i = 1; i < panes.length; i++) panes[i].setHeight(110)

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
    }
    const scheduleRender = (isNewBar: boolean) => {
      newBar ||= isNewBar
      if (!frame) frame = requestAnimationFrame(renderLast)
    }

    setStatus('loading')
    candlesRef.current = []
    renderAll()

    fetchCandles(market, interval)
      .then((bars) => {
        if (cancelled) return
        candlesRef.current = bars
        const precision = pricePrecision(bars[bars.length - 1]?.close ?? 1)
        candleSeries.applyOptions({
          priceFormat: { type: 'price', precision, minMove: 1 / 10 ** precision },
        })
        setPrecision(precision)
        renderAll()
        chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - 120), to: bars.length + 6 })
        setLegend(bars.length ? { ...bars[bars.length - 1] } : null)
        setStatus('ready')
      })
      .catch(() => !cancelled && setStatus('error'))

    // Load older candles when the user scrolls to the left edge.
    const onRange = (range: { from: number; to: number } | null) => {
      if (!range || range.from > 15 || loadingMore || reachedStart) return
      const bars = candlesRef.current
      if (!bars.length) return
      loadingMore = true
      fetchCandles(market, interval, bars[0].time)
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
          // brief pause to respect Upbit rate limits
          setTimeout(() => (loadingMore = false), 300)
        })
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange)

    // Real-time trades build / extend the latest candle.
    const unsubscribe = subscribe<Trade>('trade', [market], (t) => {
      const bars = candlesRef.current
      if (cancelled || !bars.length || t.code !== market) return
      const start = bucketStart(t.trade_timestamp, interval)
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
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      unsubscribe()
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange)
    }
  }, [market, interval])

  const up = legend ? legend.close >= legend.open : true
  return (
    <div className="chart-wrap">
      <DrawingToolbar
        tool={tool}
        onTool={chooseTool}
        canDelete={selectedId !== null}
        onDelete={deleteSelected}
        canClear={drawCount > 0}
        onClear={clearAll}
      />
      <div className={`chart-area ${tool !== 'cursor' ? 'drawing' : ''}`}>
      {tool !== 'cursor' && (
        <div className="draw-hint">
          {drafting ? '끝 지점을 클릭하세요' : tool === 'hline' ? '가격 위치를 클릭하세요' : '시작 지점을 클릭하세요'} · Esc 취소
        </div>
      )}
      <div className="chart-legend">
        {legend && (
          <>
            <span>시 <b className={up ? 'up' : 'down'}>{formatPrice(legend.open)}</b></span>
            <span>고 <b className={up ? 'up' : 'down'}>{formatPrice(legend.high)}</b></span>
            <span>저 <b className={up ? 'up' : 'down'}>{formatPrice(legend.low)}</b></span>
            <span>종 <b className={up ? 'up' : 'down'}>{formatPrice(legend.close)}</b></span>
            <span>거래량 <b>{legend.volume.toLocaleString('ko-KR', { maximumFractionDigits: 3 })}</b></span>
          </>
        )}
        {groups.some((g) => g.id === 'ma' || g.id === 'bb') && (
          <div className="ind">
            {groups
              .filter((g) => g.id === 'ma' || g.id === 'bb')
              .flatMap((g) => g.legend)
              .map((l) => (
                <span key={l.label} style={{ color: l.color }}>{l.label}</span>
              ))}
          </div>
        )}
      </div>
      {status === 'loading' && <div className="chart-overlay">불러오는 중…</div>}
      {status === 'error' && <div className="chart-overlay">시세를 불러오지 못했습니다</div>}
      <div ref={containerRef} className="chart" />
      </div>
    </div>
  )
}
