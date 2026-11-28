import { useCallback, useEffect, useState } from 'react'
import { INTERVALS, type Interval } from '../lib/market'

/** Chart layouts: one chart, two side by side, two stacked, or a 2×2 grid. */
export type LayoutId = '1' | '2h' | '2v' | '4'

export const LAYOUTS: { id: LayoutId; label: string; count: number }[] = [
  { id: '1', label: '차트 1개', count: 1 },
  { id: '2h', label: '좌우 2개', count: 2 },
  { id: '2v', label: '위아래 2개', count: 2 },
  { id: '4', label: '2×2 4개', count: 4 },
]

export interface Cell {
  market: string
  interval: Interval
}

const KEY = { layout: 'chartview:layout', cells: 'chartview:cells', active: 'chartview:active' }

/** Defaults for the extra charts: same coin on a longer timeframe, then other markets. */
const DEFAULT_EXTRA: Cell[] = [
  { market: 'KRW-BTC', interval: '1D' },
  { market: 'BTCUSDT', interval: '1h' },
  { market: 'KRW-ETH', interval: '15m' },
]

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable */
  }
}

const isInterval = (v: unknown): v is Interval => INTERVALS.some((iv) => iv.id === v)

function loadCells(): Cell[] {
  // The first chart starts from the single-chart settings saved by earlier versions.
  const first: Cell = {
    market: read('chartview:market') || 'KRW-BTC',
    interval: isInterval(read('chartview:interval')) ? (read('chartview:interval') as Interval) : '15m',
  }
  let saved: unknown = null
  try {
    saved = JSON.parse(read(KEY.cells) ?? 'null')
  } catch {
    saved = null
  }
  const list = Array.isArray(saved) ? saved : []
  return [first, ...DEFAULT_EXTRA].map((fallback, i) => {
    const c = list[i] as Partial<Cell> | undefined
    return {
      market: typeof c?.market === 'string' && c.market ? c.market : fallback.market,
      interval: isInterval(c?.interval) ? c!.interval! : fallback.interval,
    }
  })
}

/**
 * Multi-chart layout state. Each of the four cells keeps its own market and
 * interval; the "active" cell is the one the header, market list, toolbar and
 * keyboard shortcuts act on. Everything is saved in localStorage.
 */
export function useChartLayout() {
  const [layout, setLayoutState] = useState<LayoutId>(() => {
    const v = read(KEY.layout)
    return LAYOUTS.some((l) => l.id === v) ? (v as LayoutId) : '1'
  })
  const [cells, setCells] = useState<Cell[]>(loadCells)
  const [activeRaw, setActiveRaw] = useState(() => Math.max(0, Math.min(3, Number(read(KEY.active)) || 0)))

  const count = LAYOUTS.find((l) => l.id === layout)!.count
  const activeIndex = Math.min(activeRaw, count - 1)
  const { market, interval } = cells[activeIndex]

  useEffect(() => write(KEY.layout, layout), [layout])
  useEffect(() => {
    write(KEY.cells, JSON.stringify(cells))
    // keep the single-chart keys in sync for older code paths / first load
    write('chartview:market', cells[0].market)
    write('chartview:interval', cells[0].interval)
  }, [cells])
  useEffect(() => write(KEY.active, String(activeIndex)), [activeIndex])

  const updateActive = useCallback(
    (patch: Partial<Cell>) => setCells((cs) => cs.map((c, i) => (i === activeIndex ? { ...c, ...patch } : c))),
    [activeIndex],
  )
  const setMarket = useCallback((m: string) => updateActive({ market: m }), [updateActive])
  const setInterval = useCallback((iv: Interval) => updateActive({ interval: iv }), [updateActive])
  const setActive = useCallback((i: number) => setActiveRaw(i), [])
  const setLayout = useCallback((id: LayoutId) => setLayoutState(id), [])

  return { layout, setLayout, count, cells, activeIndex, setActive, market, interval, setMarket, setInterval }
}
