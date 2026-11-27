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
import type { Candle, Interval } from './upbit'

export type ToolId = 'cursor' | 'trend' | 'ray' | 'hline' | 'fib' | 'rect'
export type DrawingType = Exclude<ToolId, 'cursor'>

export interface Point {
  time: number // UTC seconds
  price: number
}

export interface Drawing {
  id: string
  type: DrawingType
  points: Point[]
}

export const POINTS_NEEDED: Record<DrawingType, number> = { trend: 2, ray: 2, hline: 1, fib: 2, rect: 2 }

export const INTERVAL_SEC: Record<Interval, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1D': 86400,
  '1W': 604800,
}

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
const FIB_COLORS = ['#8a8f98', '#e8473f', '#ff9800', '#4caf50', '#26a69a', '#3b74f0', '#8a8f98']
const LINE_COLOR = '#4f8cff'
const RECT_COLOR = '#a78bfa'
const HIT_PX = 6

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
  private readonly view: IPrimitivePaneView
  private readonly getBars: () => Candle[]
  private readonly getInterval: () => Interval
  private readonly format: (p: number) => string

  constructor(getBars: () => Candle[], getInterval: () => Interval, format: (p: number) => string) {
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
  private timeToLogical(time: number): number | null {
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

  private logicalToTime(logical: number): number | null {
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

  // ---- hit testing ----
  /** Library hook: show a pointer cursor when hovering a drawing. */
  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const id = this.findAt(x, y)
    return id ? { cursorStyle: 'pointer', externalId: id, zOrder: 'top' } : null
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
        case 'hline':
          if (Math.abs(y - a.y) <= HIT_PX) return d.id
          break
        case 'trend':
          if (distToSegment(p, a, b) <= HIT_PX) return d.id
          break
        case 'ray':
          if (distToSegment(p, a, extendRay(a, b, this.width)) <= HIT_PX) return d.id
          break
        case 'rect': {
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
        if (selected) for (const q of pts as XY[]) this.handle(ctx, q)
      }
    })
  }

  private drawOne(ctx: CanvasRenderingContext2D, d: Drawing, pts: XY[], width: number, selected: boolean) {
    const [a, b] = pts
    ctx.lineWidth = selected ? 2 : 1.5
    ctx.font = '11px Pretendard, "Malgun Gothic", system-ui, sans-serif'
    switch (d.type) {
      case 'trend':
      case 'ray': {
        const end = d.type === 'ray' ? extendRay(a, b, width) : b
        ctx.strokeStyle = LINE_COLOR
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(end.x, end.y)
        ctx.stroke()
        break
      }
      case 'hline': {
        ctx.strokeStyle = LINE_COLOR
        ctx.beginPath()
        ctx.moveTo(0, a.y)
        ctx.lineTo(width, a.y)
        ctx.stroke()
        this.label(ctx, this.format(d.points[0].price), width - 6, a.y, LINE_COLOR, 'right')
        break
      }
      case 'rect': {
        const x = Math.min(a.x, b.x)
        const y = Math.min(a.y, b.y)
        const w = Math.abs(b.x - a.x)
        const h = Math.abs(b.y - a.y)
        ctx.fillStyle = RECT_COLOR + '26'
        ctx.fillRect(x, y, w, h)
        ctx.strokeStyle = RECT_COLOR
        ctx.strokeRect(x, y, w, h)
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

  private handle(ctx: CanvasRenderingContext2D, p: XY) {
    ctx.beginPath()
    ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2)
    ctx.fillStyle = '#fff'
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = LINE_COLOR
    ctx.stroke()
  }
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
