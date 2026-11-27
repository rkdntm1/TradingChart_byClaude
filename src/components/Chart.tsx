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

export const UP = '#e8473f'
export const DOWN = '#3b74f0'

const toTime = (utcSec: number) => (utcSec + KST_OFFSET) as UTCTimestamp

interface Props {
  market: string
  interval: Interval
}

interface Legend {
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export default function Chart({ market, interval }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const candlesRef = useRef<Candle[]>([])
  const [legend, setLegend] = useState<Legend | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

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

    chart.subscribeCrosshairMove((param) => {
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
      chart.remove()
      chartRef.current = null
    }
  }, [])

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
    }

    const renderLast = () => {
      const bars = candlesRef.current
      const last = bars[bars.length - 1]
      candleSeries.update(ohlcBar(last))
      volumeSeries.update(volBar(last))
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
      } else {
        last.high = Math.max(last.high, t.trade_price)
        last.low = Math.min(last.low, t.trade_price)
        last.close = t.trade_price
        last.volume += t.trade_volume
      }
      renderLast()
    })

    return () => {
      cancelled = true
      unsubscribe()
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange)
    }
  }, [market, interval])

  const up = legend ? legend.close >= legend.open : true
  return (
    <div className="chart-wrap">
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
      </div>
      {status === 'loading' && <div className="chart-overlay">불러오는 중…</div>}
      {status === 'error' && <div className="chart-overlay">시세를 불러오지 못했습니다</div>}
      <div ref={containerRef} className="chart" />
    </div>
  )
}
