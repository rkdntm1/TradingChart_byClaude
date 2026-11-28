// Chart drawing tools, rendered as a lightweight-charts series primitive so they
// pan, zoom and rescale together with the candles.
//
// Points are stored as (UTC bar time, price) rather than pixels or bar indexes,
// so drawings survive interval changes, history loading and page reloads.
import type { CanvasRenderingTarget2D } from 'fancy-canvas'
import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  Logical,
  PrimitiveHoveredItem,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts'
import { INTERVAL_SEC, type Candle, type Interval } from './market'

export type DrawingType = 'trend' | 'ray' | 'hline' | 'fib' | 'rect' | 'measure' | 'text'
/** 'alert' is not a drawing: clicking the chart creates a price alert at that price. */
export type ToolId = 'cursor' | DrawingType | 'alert'

export interface Point {
  time: number // UTC seconds
  price: number
}

export interface Drawing {
  id: string
  type: DrawingType
  points: Point[]
  color?: string
  dashed?: boolean
  /** Text memo content (type 'text'); may contain line breaks. */
  text?: string
}

/** Placeholder shown for a new or emptied memo. */
export const TEXT_PLACEHOLDER = '메모'

/** Palette offered in the style bar for a selected drawing. */
export const DRAW_COLORS = ['#4f8cff', '#e8473f', '#26a69a', '#f5b301', '#a78bfa', '#e6e8eb']

const DEFAULT_COLOR: Record<DrawingType, string> = {
  trend: '#4f8cff',
  ray: '#4f8cff',
  hline: '#4f8cff',
  fib: '#8a8f98',
  rect: '#a78bfa',
  measure: '#4f8cff',
  text: '#f5b301',
}

export const colorOf = (d: Drawing) => d.color ?? DEFAULT_COLOR[d.type]

export const POINTS_NEEDED: Record<DrawingType, number> = { trend: 2, ray: 2, hline: 1, fib: 2, rect: 2, measure: 2, text: 1 }

export { INTERVAL_SEC } from './market'

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
const FIB_COLORS = ['#8a8f98', '#e8473f', '#ff9800', '#4caf50', '#26a69a', '#3b74f0', '#8a8f98']
const HIT_PX = 6
const HANDLE_PX = 8

interface XY {
  x: number
  y: number
}

function distToSegment(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = dx * dx + dy * dy
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Extend segment a→b past b to the given x bound. */
function extendRay(a: XY, b: XY, width: number): XY {
  if (a.x === b.x) return { x: b.x, y: b.y > a.y ? 1e5 : -1e5 }
  const targetX = b.x > a.x ? width : 0
  const slope = (b.y - a.y) / (b.x - a.x)
  return { x: targetX, y: a.y + slope * (targetX - a.x) }
}

export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  drawings: Drawing[] = []
  draft: Drawing | null = null
  selectedId: string | null = null

  private chart: IChartApi | null = null
  private series: ISeriesApi<SeriesType> | null = null
  private requestUpdate: (() => void) | null = null
  private width = 0
  /** Screen box of each text memo from the last paint (id → box). */
  private textBoxes = new Map<string, { x: number; y: number; w: number; h: number }>()
  private readonly view: IPrimitivePaneView
  private readonly getBars: () => Candle[]
  private readonly getInterval: () => Interval
  private readonly format: (p: number, ref?: number) => string

  constructor(getBars: () => Candle[], getInterval: () => Interval, format: (p: number, ref?: number) => string) {
    this.getBars = getBars
    this.getInterval = getInterval
    this.format = format
    const renderer: IPrimitivePaneRenderer = { draw: (target) => this.draw(target) }
    this.view = { zOrder: () => 'top', renderer: () => renderer }
  }

  // ---- ISeriesPrimitive ----
  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart
    this.series = param.series
    this.requestUpdate = param.requestUpdate
  }
  detached() {
    this.chart = this.series = this.requestUpdate = null
  }
  paneViews() {
    return [this.view]
  }

  update() {
    this.requestUpdate?.()
  }

  // ---- coordinate conversion ----
  timeToLogical(time: number): number | null {
    const bars = this.getBars()
    if (!bars.length) return null
    const iv = INTERVAL_SEC[this.getInterval()]
    const last = bars.length - 1
    if (time <= bars[0].time) return (time - bars[0].time) / iv
    if (time >= bars[last].time) return last + (time - bars[last].time) / iv
    let lo = 0
    let hi = last
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (bars[mid].time <= time) lo = mid
      else hi = mid
    }
    return lo + (time - bars[lo].time) / (bars[hi].time - bars[lo].time)
  }

  logicalToTime(logical: number): number | null {
    const bars = this.getBars()
    if (!bars.length) return null
    const iv = INTERVAL_SEC[this.getInterval()]
    const last = bars.length - 1
    const i = Math.round(logical)
    if (i < 0) return bars[0].time + i * iv
    if (i > last) return bars[last].time + (i - last) * iv
    return bars[i].time
  }

  toXY(p: Point): XY | null {
    if (!this.chart || !this.series) return null
    const logical = this.timeToLogical(p.time)
    if (logical === null) return null
    // logicalToCoordinate only handles whole bar indexes, so interpolate between
    // neighbours for points that fall inside a bar (e.g. 14:00 on a 4h chart).
    const ts = this.chart.timeScale()
    const i = Math.floor(logical)
    const x0 = ts.logicalToCoordinate(i as Logical)
    const x1 = ts.logicalToCoordinate((i + 1) as Logical)
    const x = x0 === null || x1 === null ? null : x0 + (x1 - x0) * (logical - i)
    const y = this.series.priceToCoordinate(p.price)
    if (x === null || y === null) return null
    return { x, y }
  }

  /** Pixel position → chart point, snapping time to the nearest bar. */
  fromXY(x: number, y: number): Point | null {
    if (!this.chart || !this.series) return null
    const logical = this.chart.timeScale().coordinateToLogical(x)
    const price = this.series.coordinateToPrice(y)
    if (logical === null || price === null) return null
    const time = this.logicalToTime(logical)
    return time === null ? null : { time, price }
  }

  /** Raw (unsnapped) logical index and price under a pixel, used for dragging. */
  rawAt(x: number, y: number): { logical: number; price: number } | null {
    if (!this.chart || !this.series) return null
    const logical = this.chart.timeScale().coordinateToLogical(x)
    const price = this.series.coordinateToPrice(y)
    return logical === null || price === null ? null : { logical, price }
  }

  /** Points shifted by whole bars and a price delta (for moving a drawing). */
  shift(points: Point[], dBars: number, dPrice: number): Point[] {
    return points.map((p) => {
      const l = this.timeToLogical(p.time)
      const time = l === null ? p.time : (this.logicalToTime(l + dBars) ?? p.time)
      return { time, price: p.price + dPrice }
    })
  }

  // ---- hit testing ----
  /** Library hook: cursor feedback when hovering drawings and their handles. */
  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    if (this.handleAt(x, y) !== null) return { cursorStyle: 'crosshair', externalId: 'handle', zOrder: 'top' }
    const id = this.findAt(x, y)
    if (!id) return null
    return { cursorStyle: id === this.selectedId ? 'move' : 'pointer', externalId: id, zOrder: 'top' }
  }

  /**
   * Magnet: move `pt` onto the nearest open/high/low/close of its bar if that
   * price is within `px` pixels of the pointer (like TradingView's weak magnet).
   */
  snap(pt: Point, y: number, px = 24): Point {
    if (!this.series) return pt
    const bar = this.getBars().find((b) => b.time === pt.time)
    if (!bar) return pt
    let best: { price: number; dist: number } | null = null
    for (const price of [bar.open, bar.high, bar.low, bar.close]) {
      const py = this.series.priceToCoordinate(price)
      if (py === null) continue
      const dist = Math.abs(py - y)
      if (dist <= px && (!best || dist < best.dist)) best = { price, dist }
    }
    return best ? { time: pt.time, price: best.price } : pt
  }

  /** Index of the selected drawing's control point under (x, y), if any. */
  handleAt(x: number, y: number): number | null {
    const d = this.drawings.find((dr) => dr.id === this.selectedId)
    if (!d) return null
    for (let i = 0; i < d.points.length; i++) {
      const q = this.toXY(d.points[i])
      if (q && Math.hypot(q.x - x, q.y - y) <= HANDLE_PX) return i
    }
    return null
  }

  /** Id of the topmost drawing under (x, y), if any. */
  findAt(x: number, y: number): string | null {
    const p = { x, y }
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i]
      const pts = d.points.map((pt) => this.toXY(pt))
      if (pts.some((q) => !q)) continue
      const [a, b] = pts as XY[]
      switch (d.type) {
        case 'text': {
          const box = this.textBoxes.get(d.id)
          if (box && x >= box.x - 2 && x <= box.x + box.w + 2 && y >= box.y - 2 && y <= box.y + box.h + 2) return d.id
          break
        }
        case 'hline':
          if (Math.abs(y - a.y) <= HIT_PX) return d.id
          break
        case 'trend':
          if (distToSegment(p, a, b) <= HIT_PX) return d.id
          break
        case 'ray':
          if (distToSegment(p, a, extendRay(a, b, this.width)) <= HIT_PX) return d.id
          break
        case 'rect':
        case 'measure': {
          const inX = x >= Math.min(a.x, b.x) - HIT_PX && x <= Math.max(a.x, b.x) + HIT_PX
          const inY = y >= Math.min(a.y, b.y) - HIT_PX && y <= Math.max(a.y, b.y) + HIT_PX
          if (inX && inY) return d.id
          break
        }
        case 'fib': {
          if (x < Math.min(a.x, b.x) - HIT_PX || x > Math.max(a.x, b.x) + HIT_PX) break
          for (const lv of FIB_LEVELS) {
            const ly = b.y + (a.y - b.y) * lv
            if (Math.abs(y - ly) <= HIT_PX) return d.id
          }
          break
        }
      }
    }
    return null
  }

  // ---- rendering ----
  private draw(target: CanvasRenderingTarget2D) {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      this.width = mediaSize.width
      const all = this.draft ? [...this.drawings, this.draft] : this.drawings
      for (const d of all) {
        const pts = d.points.map((pt) => this.toXY(pt))
        if (pts.some((q) => !q)) continue
        const selected = d.id === this.selectedId || d === this.draft
        ctx.save()
        this.drawOne(ctx, d, pts as XY[], mediaSize.width, selected)
        ctx.restore()
        if (selected) for (const q of pts as XY[]) this.handle(ctx, q, colorOf(d))
      }
    })
  }

  private drawOne(ctx: CanvasRenderingContext2D, d: Drawing, pts: XY[], width: number, selected: boolean) {
    const [a, b] = pts
    const color = colorOf(d)
    ctx.lineWidth = selected ? 2 : 1.5
    ctx.font = '11px Pretendard, "Malgun Gothic", system-ui, sans-serif'
    if (d.dashed && d.type !== 'fib') ctx.setLineDash([6, 4])
    switch (d.type) {
      case 'trend':
      case 'ray': {
        const end = d.type === 'ray' ? extendRay(a, b, width) : b
        ctx.strokeStyle = color
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(end.x, end.y)
        ctx.stroke()
        break
      }
      case 'hline': {
        ctx.strokeStyle = color
        ctx.beginPath()
        ctx.moveTo(0, a.y)
        ctx.lineTo(width, a.y)
        ctx.stroke()
        ctx.setLineDash([])
        this.label(ctx, this.format(d.points[0].price), width - 6, a.y, color, 'right')
        break
      }
      case 'rect': {
        const x = Math.min(a.x, b.x)
        const y = Math.min(a.y, b.y)
        const w = Math.abs(b.x - a.x)
        const h = Math.abs(b.y - a.y)
        ctx.fillStyle = color + '26'
        ctx.fillRect(x, y, w, h)
        ctx.strokeStyle = color
        ctx.strokeRect(x, y, w, h)
        break
      }
      case 'text': {
        const lines = (d.text?.trim() ? d.text : TEXT_PLACEHOLDER).split('\n')
        ctx.font = '600 13px Pretendard, "Malgun Gothic", system-ui, sans-serif'
        const lineH = 18
        const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14
        const h = lines.length * lineH + 8
        const bx = a.x + 6
        const by = a.y - h / 2
        ctx.setLineDash([])
        ctx.fillStyle = 'rgba(15, 17, 21, 0.72)'
        ctx.beginPath()
        ctx.roundRect(bx, by, w, h, 5)
        ctx.fill()
        ctx.strokeStyle = color
        ctx.lineWidth = selected ? 1.5 : 1
        ctx.stroke()
        ctx.fillStyle = color
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        lines.forEach((l, i) => ctx.fillText(l, bx + 7, by + 4 + lineH / 2 + i * lineH))
        // small pointer from the anchor to the box
        ctx.beginPath()
        ctx.arc(a.x, a.y, 2.5, 0, Math.PI * 2)
        ctx.fill()
        this.textBoxes.set(d.id, { x: bx, y: by, w, h })
        break
      }
      case 'measure': {
        const [pa, pb] = d.points
        const diff = pb.price - pa.price
        const up = diff >= 0
        const tone = up ? '#e8473f' : '#3b74f0'
        ctx.fillStyle = tone + '22'
        ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
        ctx.strokeStyle = tone
        ctx.setLineDash([])
        ctx.lineWidth = 1.2
        // vertical and horizontal arrows through the box centre
        const cx = (a.x + b.x) / 2
        const cy = (a.y + b.y) / 2
        this.arrow(ctx, cx, a.y, cx, b.y)
        this.arrow(ctx, a.x, cy, b.x, cy)
        const pct = pa.price ? (diff / pa.price) * 100 : 0
        const la = this.timeToLogical(pa.time)
        const lb = this.timeToLogical(pb.time)
        const bars = la !== null && lb !== null ? Math.round(lb - la) : 0
        const lines = [
          `${up ? '+' : ''}${this.format(diff, Math.abs(pa.price))} (${up ? '+' : ''}${pct.toFixed(2)}%)`,
          `${bars}봉 · ${humanSpan(Math.abs(pb.time - pa.time))}`,
        ]
        this.box(ctx, lines, cx, up ? Math.min(a.y, b.y) - 8 : Math.max(a.y, b.y) + 8, tone, up ? 'above' : 'below')
        break
      }
      case 'fib': {
        const x1 = Math.min(a.x, b.x)
        const x2 = Math.max(a.x, b.x)
        const [pa, pb] = d.points
        const levelY = (lv: number) => b.y + (a.y - b.y) * lv
        for (let i = 0; i < FIB_LEVELS.length - 1; i++) {
          ctx.fillStyle = FIB_COLORS[i + 1] + '14'
          const y1 = levelY(FIB_LEVELS[i])
          const y2 = levelY(FIB_LEVELS[i + 1])
          ctx.fillRect(x1, Math.min(y1, y2), x2 - x1, Math.abs(y2 - y1))
        }
        ctx.lineWidth = 1
        FIB_LEVELS.forEach((lv, i) => {
          const y = levelY(lv)
          ctx.strokeStyle = FIB_COLORS[i]
          ctx.beginPath()
          ctx.moveTo(x1, y)
          ctx.lineTo(x2, y)
          ctx.stroke()
          const price = pb.price + (pa.price - pb.price) * lv
          ctx.fillStyle = FIB_COLORS[i]
          ctx.textAlign = 'right'
          ctx.textBaseline = 'middle'
          ctx.fillText(`${lv} (${this.format(price)})`, x1 - 6, y)
        })
        ctx.setLineDash([4, 4])
        ctx.strokeStyle = '#8a8f98'
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
        break
      }
    }
  }

  private arrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    const ang = Math.atan2(y2 - y1, x2 - x1)
    if (Math.hypot(x2 - x1, y2 - y1) < 12) return
    ctx.beginPath()
    ctx.moveTo(x2, y2)
    ctx.lineTo(x2 - 7 * Math.cos(ang - 0.45), y2 - 7 * Math.sin(ang - 0.45))
    ctx.moveTo(x2, y2)
    ctx.lineTo(x2 - 7 * Math.cos(ang + 0.45), y2 - 7 * Math.sin(ang + 0.45))
    ctx.stroke()
  }

  /** Multi-line label centred on x, placed above or below y. */
  private box(ctx: CanvasRenderingContext2D, lines: string[], x: number, y: number, color: string, side: 'above' | 'below') {
    ctx.font = '12px Pretendard, "Malgun Gothic", system-ui, sans-serif'
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16
    const h = lines.length * 16 + 8
    const left = x - w / 2
    const top = side === 'above' ? y - h : y
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.roundRect(left, top, w, h, 5)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    lines.forEach((l, i) => ctx.fillText(l, x, top + 12 + i * 16))
  }

  private label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, align: 'left' | 'right') {
    const w = ctx.measureText(text).width + 10
    const left = align === 'right' ? x - w : x
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.roundRect(left, y - 9, w, 18, 4)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, left + 5, y)
  }

  private handle(ctx: CanvasRenderingContext2D, p: XY, color: string) {
    ctx.beginPath()
    ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2)
    ctx.fillStyle = '#fff'
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = color
    ctx.stroke()
  }
}

/** 93784 → "1일 2시간", 2700 → "45분". */
function humanSpan(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d) return h ? `${d}일 ${h}시간` : `${d}일`
  if (h) return m ? `${h}시간 ${m}분` : `${h}시간`
  return `${m}분`
}

// ---- persistence (per market, shared across intervals) ----
const key = (market: string) => `chartview:drawings:${market}`

export function loadDrawings(market: string): Drawing[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key(market)) ?? '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

export function saveDrawings(market: string, drawings: Drawing[]) {
  try {
    if (drawings.length) localStorage.setItem(key(market), JSON.stringify(drawings))
    else localStorage.removeItem(key(market))
  } catch {
    /* storage unavailable */
  }
}
