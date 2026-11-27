// Upbit public API client (REST + WebSocket). No API key needed.
// Docs: https://global-docs.upbit.com/reference

const REST = 'https://api.upbit.com/v1'
const WS = 'wss://api.upbit.com/websocket/v1'

/** Shift used to render chart times in KST (lightweight-charts works in UTC). */
export const KST_OFFSET = 9 * 3600

export type Interval = '1m' | '5m' | '15m' | '1h' | '4h' | '1D' | '1W'

export const INTERVALS: { id: Interval; label: string }[] = [
  { id: '1m', label: '1분' },
  { id: '5m', label: '5분' },
  { id: '15m', label: '15분' },
  { id: '1h', label: '1시간' },
  { id: '4h', label: '4시간' },
  { id: '1D', label: '일' },
  { id: '1W', label: '주' },
]

export interface Market {
  market: string // e.g. KRW-BTC
  korean_name: string
  english_name: string
}

export interface Candle {
  time: number // UTC seconds of the bar start
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface Ticker {
  code: string
  trade_price: number
  signed_change_rate: number
  signed_change_price: number
  change: 'RISE' | 'EVEN' | 'FALL'
  acc_trade_price_24h: number
  high_price: number
  low_price: number
  acc_trade_volume_24h: number
}

export interface Trade {
  code: string
  trade_price: number
  trade_volume: number
  trade_timestamp: number // ms
}

function candlePath(interval: Interval): string {
  switch (interval) {
    case '1m': return 'candles/minutes/1'
    case '5m': return 'candles/minutes/5'
    case '15m': return 'candles/minutes/15'
    case '1h': return 'candles/minutes/60'
    case '4h': return 'candles/minutes/240'
    case '1D': return 'candles/days'
    case '1W': return 'candles/weeks'
  }
}

/** Start (UTC seconds) of the bar that contains `tsMs` for the given interval. */
export function bucketStart(tsMs: number, interval: Interval): number {
  const s = Math.floor(tsMs / 1000)
  const minutes: Partial<Record<Interval, number>> = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240 }
  const m = minutes[interval]
  if (m) return s - (s % (m * 60))
  const day = s - (s % 86400) // Upbit daily candles start at 00:00 UTC (09:00 KST)
  if (interval === '1D') return day
  // Weekly candles start on Monday 00:00 UTC. 1970-01-01 was a Thursday.
  const dow = (Math.floor(day / 86400) + 3) % 7 // 0 = Monday
  return day - dow * 86400
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * GET JSON with retries. Upbit answers 429 when an IP exceeds its rate limit
 * (e.g. several tabs open); back off and try again instead of failing for good.
 */
async function getJson<T>(url: string, attempts = 5): Promise<T> {
  for (let i = 0; ; i++) {
    let res: Response | null = null
    try {
      res = await fetch(url)
    } catch (err) {
      if (i >= attempts - 1) throw err // network error, out of retries
    }
    if (res?.ok) return res.json() as Promise<T>
    const retriable = !res || res.status === 429 || res.status >= 500
    if (!retriable || i >= attempts - 1) throw new Error(`Upbit API ${res?.status ?? 'network'}: ${url}`)
    const retryAfter = Number(res?.headers.get('Retry-After'))
    await sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** i + Math.random() * 300)
  }
}

export async function fetchMarkets(): Promise<Market[]> {
  const all = await getJson<Market[]>(`${REST}/market/all?is_details=false`)
  return all.filter((m) => m.market.startsWith('KRW-'))
}

interface RawCandle {
  candle_date_time_utc: string
  opening_price: number
  high_price: number
  low_price: number
  trade_price: number
  candle_acc_trade_volume: number
}

/** Fetch up to 200 candles ending before `toUtcSec` (exclusive), oldest first. */
export async function fetchCandles(market: string, interval: Interval, toUtcSec?: number): Promise<Candle[]> {
  const params = new URLSearchParams({ market, count: '200' })
  if (toUtcSec) params.set('to', new Date(toUtcSec * 1000).toISOString().slice(0, 19) + 'Z')
  const raw = await getJson<RawCandle[]>(`${REST}/${candlePath(interval)}?${params}`)
  return raw
    .map((c) => ({
      time: Math.floor(Date.parse(c.candle_date_time_utc + 'Z') / 1000),
      open: c.opening_price,
      high: c.high_price,
      low: c.low_price,
      close: c.trade_price,
      volume: c.candle_acc_trade_volume,
    }))
    .reverse()
}

export async function fetchTickers(markets: string[]): Promise<Ticker[]> {
  const raw = await getJson<(Ticker & { market: string })[]>(`${REST}/ticker?markets=${markets.join(',')}`)
  return raw.map((t) => ({ ...t, code: t.market }))
}

/**
 * Open an auto-reconnecting Upbit WebSocket subscription.
 * Returns a function that closes it.
 */
export function subscribe<T>(type: 'ticker' | 'trade', codes: string[], onMessage: (msg: T) => void): () => void {
  let ws: WebSocket | null = null
  let closed = false
  let retry: ReturnType<typeof setTimeout> | undefined
  // Exponential backoff (1s → 30s) so a rate-limited IP isn't hammered with reconnects.
  let delay = 1000

  const connect = () => {
    ws = new WebSocket(WS)
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => {
      delay = 1000
      ws?.send(JSON.stringify([{ ticket: crypto.randomUUID() }, { type, codes }, { format: 'DEFAULT' }]))
    }
    ws.onmessage = (ev) => {
      const text = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer)
      try {
        onMessage(JSON.parse(text) as T)
      } catch {
        /* ignore malformed frames */
      }
    }
    ws.onclose = () => {
      if (closed) return
      retry = setTimeout(connect, delay + Math.random() * 500)
      delay = Math.min(delay * 2, 30000)
    }
  }
  connect()

  return () => {
    closed = true
    clearTimeout(retry)
    ws?.close()
  }
}

export function formatPrice(p: number): string {
  if (p >= 100) return Math.round(p).toLocaleString('ko-KR')
  if (p >= 1) return p.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
  return p.toLocaleString('ko-KR', { maximumFractionDigits: 6 })
}

/** Decimal places for the chart price scale. */
export function pricePrecision(p: number): number {
  if (p >= 100) return 0
  if (p >= 1) return 2
  if (p >= 0.01) return 4
  return 6
}

export function formatVolumeKrw(v: number): string {
  if (v >= 1e12) return (v / 1e12).toFixed(1) + '조'
  if (v >= 1e8) return Math.round(v / 1e8).toLocaleString('ko-KR') + '억'
  if (v >= 1e4) return Math.round(v / 1e4).toLocaleString('ko-KR') + '만'
  return Math.round(v).toLocaleString('ko-KR')
}
