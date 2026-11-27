// Wires the indicator math to lightweight-charts series.
import {
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type UTCTimestamp,
} from 'lightweight-charts'
import { bollinger, macd, rsi, sma, type Series } from './indicators'
import { KST_OFFSET, type Candle } from './bithumb'

export type IndicatorId = 'ma' | 'bb' | 'rsi' | 'macd'

export const INDICATORS: { id: IndicatorId; label: string; pane: 'overlay' | 'separate' }[] = [
  { id: 'ma', label: '이동평균', pane: 'overlay' },
  { id: 'bb', label: '볼린저밴드', pane: 'overlay' },
  { id: 'rsi', label: 'RSI', pane: 'separate' },
  { id: 'macd', label: 'MACD', pane: 'separate' },
]

export interface LegendItem {
  label: string
  color: string
}

export interface IndicatorGroup {
  id: IndicatorId
  series: ISeriesApi<SeriesType>[]
  legend: LegendItem[]
  /** Push data into the series; `lastOnly` updates just the newest bar. */
  render: (bars: Candle[], lastOnly: boolean) => void
}

const UP_HIST = 'rgba(232,71,63,0.55)'
const DOWN_HIST = 'rgba(59,116,240,0.55)'

const t = (c: Candle) => (c.time + KST_OFFSET) as UTCTimestamp

function push(
  series: ISeriesApi<SeriesType>,
  bars: Candle[],
  values: Series,
  lastOnly: boolean,
  color?: (v: number) => string,
) {
  const point = (i: number) => ({ time: t(bars[i]), value: values[i]!, ...(color ? { color: color(values[i]!) } : {}) })
  if (lastOnly) {
    const i = bars.length - 1
    if (i >= 0 && values[i] !== null) series.update(point(i))
    return
  }
  const data = []
  for (let i = 0; i < bars.length; i++) if (values[i] !== null) data.push(point(i))
  series.setData(data)
}

const lineOpts = (color: string, extra: object = {}) => ({
  color,
  lineWidth: 1 as const,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false,
  ...extra,
})

export function buildIndicator(id: IndicatorId, chart: IChartApi, pane: number, precision: number): IndicatorGroup {
  const priceFormat = { type: 'price' as const, precision, minMove: 1 / 10 ** precision }
  switch (id) {
    case 'ma': {
      const defs = [
        { p: 5, color: '#f5b301' },
        { p: 20, color: '#d64fd9' },
        { p: 60, color: '#26a69a' },
        { p: 120, color: '#ff7a45' },
      ]
      const series = defs.map((d) => chart.addSeries(LineSeries, lineOpts(d.color, { priceFormat }), pane))
      return {
        id,
        series,
        legend: defs.map((d) => ({ label: `MA${d.p}`, color: d.color })),
        render: (bars, lastOnly) => {
          const closes = bars.map((b) => b.close)
          defs.forEach((d, i) => push(series[i], bars, sma(closes, d.p), lastOnly))
        },
      }
    }
    case 'bb': {
      const color = '#4f8cff'
      const upper = chart.addSeries(LineSeries, lineOpts(color, { priceFormat }), pane)
      const mid = chart.addSeries(LineSeries, lineOpts(color, { priceFormat, lineStyle: LineStyle.Dashed }), pane)
      const lower = chart.addSeries(LineSeries, lineOpts(color, { priceFormat }), pane)
      return {
        id,
        series: [upper, mid, lower],
        legend: [{ label: 'BB(20, 2)', color }],
        render: (bars, lastOnly) => {
          const bb = bollinger(bars.map((b) => b.close))
          push(upper, bars, bb.upper, lastOnly)
          push(mid, bars, bb.mid, lastOnly)
          push(lower, bars, bb.lower, lastOnly)
        },
      }
    }
    case 'rsi': {
      const color = '#a78bfa'
      const line = chart.addSeries(LineSeries, lineOpts(color, { lastValueVisible: true }), pane)
      line.createPriceLine({ price: 70, color: 'rgba(232,71,63,0.5)', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false })
      line.createPriceLine({ price: 30, color: 'rgba(59,116,240,0.5)', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false })
      return {
        id,
        series: [line],
        legend: [{ label: 'RSI(14)', color }],
        render: (bars, lastOnly) => push(line, bars, rsi(bars.map((b) => b.close)), lastOnly),
      }
    }
    case 'macd': {
      const fmt = { type: 'price' as const, precision: Math.max(precision, 2), minMove: 1 / 10 ** Math.max(precision, 2) }
      const hist = chart.addSeries(HistogramSeries, { priceFormat: fmt, priceLineVisible: false, lastValueVisible: false }, pane)
      const line = chart.addSeries(LineSeries, lineOpts('#4f8cff', { priceFormat: fmt }), pane)
      const sig = chart.addSeries(LineSeries, lineOpts('#ff7a45', { priceFormat: fmt }), pane)
      return {
        id,
        series: [hist, line, sig],
        legend: [
          { label: 'MACD(12, 26, 9)', color: '#4f8cff' },
          { label: 'Signal', color: '#ff7a45' },
        ],
        render: (bars, lastOnly) => {
          const m = macd(bars.map((b) => b.close))
          push(hist, bars, m.hist, lastOnly, (v) => (v >= 0 ? UP_HIST : DOWN_HIST))
          push(line, bars, m.line, lastOnly)
          push(sig, bars, m.signal, lastOnly)
        },
      }
    }
  }
}
