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
import { bollinger, ema, macd, rsi, sma, type Series } from './indicators'
import { KST_OFFSET, type Candle } from './market'

export type IndicatorId = 'ma' | 'bb' | 'rsi' | 'macd'

export const INDICATORS: { id: IndicatorId; label: string; pane: 'overlay' | 'separate' }[] = [
  { id: 'ma', label: '이동평균', pane: 'overlay' },
  { id: 'bb', label: '볼린저밴드', pane: 'overlay' },
  { id: 'rsi', label: 'RSI', pane: 'separate' },
  { id: 'macd', label: 'MACD', pane: 'separate' },
]

// ---- user-configurable parameters ----

export interface IndicatorParams {
  ma: { type: 'sma' | 'ema'; periods: number[] } // up to 4 lines; 0 = line hidden
  bb: { length: number; mult: number }
  rsi: { length: number; overbought: number; oversold: number }
  macd: { fast: number; slow: number; signal: number }
}

export const DEFAULT_PARAMS: IndicatorParams = {
  ma: { type: 'sma', periods: [5, 20, 60, 120] },
  bb: { length: 20, mult: 2 },
  rsi: { length: 14, overbought: 70, oversold: 30 },
  macd: { fast: 12, slow: 26, signal: 9 },
}

const MA_COLORS = ['#f5b301', '#d64fd9', '#26a69a', '#ff7a45']

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

/** Fill gaps and clamp values so a hand-edited or old saved object can't break the chart. */
export function normalizeParams(raw: unknown): IndicatorParams {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof IndicatorParams, Record<string, unknown>>>
  const d = DEFAULT_PARAMS
  const periods = Array.isArray(r.ma?.periods) ? (r.ma!.periods as unknown[]) : d.ma.periods
  const fast = clampInt(r.macd?.fast, 2, 100, d.macd.fast)
  const slow = clampInt(r.macd?.slow, 3, 200, d.macd.slow)
  const oversold = clampInt(r.rsi?.oversold, 5, 49, d.rsi.oversold)
  return {
    ma: {
      type: r.ma?.type === 'ema' ? 'ema' : 'sma',
      periods: [0, 1, 2, 3].map((i) => clampInt(periods[i], 0, 500, d.ma.periods[i])),
    },
    bb: {
      length: clampInt(r.bb?.length, 2, 200, d.bb.length),
      mult: Math.min(5, Math.max(0.5, Math.round(Number(r.bb?.mult ?? d.bb.mult) * 10) / 10 || d.bb.mult)),
    },
    rsi: {
      length: clampInt(r.rsi?.length, 2, 100, d.rsi.length),
      overbought: clampInt(r.rsi?.overbought, oversold + 1, 95, d.rsi.overbought),
      oversold,
    },
    // fast must stay below slow
    macd: { fast: Math.min(fast, slow - 1), slow, signal: clampInt(r.macd?.signal, 2, 50, d.macd.signal) },
  }
}

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

export function buildIndicator(
  id: IndicatorId,
  chart: IChartApi,
  pane: number,
  precision: number,
  params: IndicatorParams = DEFAULT_PARAMS,
): IndicatorGroup {
  const priceFormat = { type: 'price' as const, precision, minMove: 1 / 10 ** precision }
  switch (id) {
    case 'ma': {
      const { type, periods } = params.ma
      const prefix = type === 'ema' ? 'EMA' : 'MA'
      const avg = type === 'ema' ? ema : sma
      const defs = periods.map((p, i) => ({ p, color: MA_COLORS[i] })).filter((d) => d.p > 0)
      const series = defs.map((d) => chart.addSeries(LineSeries, lineOpts(d.color, { priceFormat }), pane))
      let last: Series[] = []
      return {
        id,
        pane,
        title: type === 'ema' ? '지수이동평균' : '이동평균',
        series,
        legend: defs.map((d) => ({ label: `${prefix}${d.p}`, color: d.color })),
        render: (bars, lastOnly) => {
          const closes = bars.map((b) => b.close)
          last = defs.map((d) => avg(closes, d.p))
          defs.forEach((_, i) => push(series[i], bars, last[i], lastOnly))
        },
        valuesAt: (i) =>
          defs.map((d, k) => ({ label: `${prefix}${d.p}`, color: d.color, value: at(last[k], i), kind: 'price' })),
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
        title: `BB(${params.bb.length}, ${params.bb.mult})`,
        series: [upper, mid, lower],
        legend: [{ label: `BB(${params.bb.length}, ${params.bb.mult})`, color }],
        render: (bars, lastOnly) => {
          last = bollinger(bars.map((b) => b.close), params.bb.length, params.bb.mult)
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
      const { length, overbought, oversold } = params.rsi
      line.createPriceLine({ price: overbought, color: 'rgba(232,71,63,0.5)', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false })
      line.createPriceLine({ price: oversold, color: 'rgba(59,116,240,0.5)', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false })
      let last: Series = []
      return {
        id,
        pane,
        title: `RSI(${length})`,
        series: [line],
        legend: [{ label: `RSI(${length})`, color }],
        render: (bars, lastOnly) => {
          last = rsi(bars.map((b) => b.close), length)
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
        title: `MACD(${params.macd.fast}, ${params.macd.slow}, ${params.macd.signal})`,
        series: [hist, line, sig],
        legend: [
          { label: `MACD(${params.macd.fast}, ${params.macd.slow}, ${params.macd.signal})`, color: '#4f8cff' },
          { label: 'Signal', color: '#ff7a45' },
        ],
        render: (bars, lastOnly) => {
          last = macd(bars.map((b) => b.close), params.macd.fast, params.macd.slow, params.macd.signal)
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
