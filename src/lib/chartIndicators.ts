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
import { KST_OFFSET, type Candle } from './market'

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

/** One value for the legend at a given bar. `price` values use the market's price format. */
export interface LegendValue {
  label: string
  color: string
  value: number | null
  kind: 'price' | 'plain'
}

export interface IndicatorGroup {
  id: IndicatorId
  /** Chart pane index (0 = price pane). */
  pane: number
  title: string
  series: ISeriesApi<SeriesType>[]
  legend: LegendItem[]
  /** Push data into the series; `lastOnly` updates just the newest bar. */
  render: (bars: Candle[], lastOnly: boolean) => void
  /** Values at bar index `i` of the last rendered bars (for the legend). */
  valuesAt: (i: number) => LegendValue[]
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

const at = (s: Series | undefined, i: number) => (s && i >= 0 && i < s.length ? s[i] : null)

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
      let last: Series[] = []
      return {
        id,
        pane,
        title: '이동평균',
        series,
        legend: defs.map((d) => ({ label: `MA${d.p}`, color: d.color })),
        render: (bars, lastOnly) => {
          const closes = bars.map((b) => b.close)
          last = defs.map((d) => sma(closes, d.p))
          defs.forEach((_, i) => push(series[i], bars, last[i], lastOnly))
        },
        valuesAt: (i) => defs.map((d, k) => ({ label: `MA${d.p}`, color: d.color, value: at(last[k], i), kind: 'price' })),
      }
    }
    case 'bb': {
      const color = '#4f8cff'
      const upper = chart.addSeries(LineSeries, lineOpts(color, { priceFormat }), pane)
      const mid = chart.addSeries(LineSeries, lineOpts(color, { priceFormat, lineStyle: LineStyle.Dashed }), pane)
      const lower = chart.addSeries(LineSeries, lineOpts(color, { priceFormat }), pane)
      let last: ReturnType<typeof bollinger> | null = null
      return {
        id,
        pane,
        title: 'BB(20, 2)',
        series: [upper, mid, lower],
        legend: [{ label: 'BB(20, 2)', color }],
        render: (bars, lastOnly) => {
          last = bollinger(bars.map((b) => b.close))
          push(upper, bars, last.upper, lastOnly)
          push(mid, bars, last.mid, lastOnly)
          push(lower, bars, last.lower, lastOnly)
        },
        valuesAt: (i) => [
          { label: '상단', color, value: at(last?.upper, i), kind: 'price' },
          { label: '중심', color, value: at(last?.mid, i), kind: 'price' },
          { label: '하단', color, value: at(last?.lower, i), kind: 'price' },
        ],
      }
    }
    case 'rsi': {
      const color = '#a78bfa'
      const line = chart.addSeries(LineSeries, lineOpts(color, { lastValueVisible: true }), pane)
      line.createPriceLine({ price: 70, color: 'rgba(232,71,63,0.5)', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false })
      line.createPriceLine({ price: 30, color: 'rgba(59,116,240,0.5)', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false })
      let last: Series = []
      return {
        id,
        pane,
        title: 'RSI(14)',
        series: [line],
        legend: [{ label: 'RSI(14)', color }],
        render: (bars, lastOnly) => {
          last = rsi(bars.map((b) => b.close))
          push(line, bars, last, lastOnly)
        },
        valuesAt: (i) => [{ label: 'RSI', color, value: at(last, i), kind: 'plain' }],
      }
    }
    case 'macd': {
      const fmt = { type: 'price' as const, precision: Math.max(precision, 2), minMove: 1 / 10 ** Math.max(precision, 2) }
      const hist = chart.addSeries(HistogramSeries, { priceFormat: fmt, priceLineVisible: false, lastValueVisible: false }, pane)
      const line = chart.addSeries(LineSeries, lineOpts('#4f8cff', { priceFormat: fmt }), pane)
      const sig = chart.addSeries(LineSeries, lineOpts('#ff7a45', { priceFormat: fmt }), pane)
      let last: ReturnType<typeof macd> | null = null
      return {
        id,
        pane,
        title: 'MACD(12, 26, 9)',
        series: [hist, line, sig],
        legend: [
          { label: 'MACD(12, 26, 9)', color: '#4f8cff' },
          { label: 'Signal', color: '#ff7a45' },
        ],
        render: (bars, lastOnly) => {
          last = macd(bars.map((b) => b.close))
          push(hist, bars, last.hist, lastOnly, (v) => (v >= 0 ? UP_HIST : DOWN_HIST))
          push(line, bars, last.line, lastOnly)
          push(sig, bars, last.signal, lastOnly)
        },
        valuesAt: (i) => [
          { label: 'MACD', color: '#4f8cff', value: at(last?.line, i), kind: 'price' },
          { label: 'Signal', color: '#ff7a45', value: at(last?.signal, i), kind: 'price' },
          { label: 'Hist', color: '#8a8f98', value: at(last?.hist, i), kind: 'price' },
        ],
      }
    }
  }
}
