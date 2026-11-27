// Exchange-neutral market data types. Every data source (Bithumb, Binance, …)
// converts its own API responses into these shapes, so the chart, indicators,
// drawings and alerts never need to know which exchange they are looking at.

export type SourceId = 'bithumb' | 'binance'
export type Quote = 'KRW' | 'USDT'

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
  /** Unique code across sources, e.g. KRW-BTC (Bithumb) or BTCUSDT (Binance). */
  market: string
  source: SourceId
  base: string // BTC
  quote: Quote // KRW | USDT
  korean_name: string
  english_name: string
  /** Decimal places for prices; undefined = derive from the price itself. */
  priceDecimals?: number
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
  signed_change_rate: number // 0.0123 = +1.23%
  signed_change_price: number
  change: 'RISE' | 'EVEN' | 'FALL'
  acc_trade_price_24h: number // in the quote currency
  high_price: number
  low_price: number
}

export interface Trade {
  code: string
  trade_price: number
  trade_volume: number
  trade_timestamp: number // ms
}

export interface DataSource {
  id: SourceId
  quote: Quote
  /** Tab label in the market list. */
  label: string
  /** Seconds east of UTC that this exchange aligns daily/4h/weekly candles to. */
  candleTzOffset: number
  fetchMarkets(): Promise<Market[]>
  fetchTickers(markets: Market[]): Promise<Ticker[]>
  subscribeTickers(markets: Market[], onTicker: (t: Ticker) => void): () => void
  /** Up to 200 candles ending before `toUtcSec` (exclusive), oldest first. */
  fetchCandles(market: string, interval: Interval, toUtcSec?: number): Promise<Candle[]>
  subscribeTrades(market: string, onTrade: (t: Trade) => void): () => void
}

export const INTERVAL_SEC: Record<Interval, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1D': 86400,
  '1W': 604800,
}

/**
 * Start (UTC seconds) of the bar containing `tsMs`, for an exchange that aligns
 * candles to UTC+`tzOffset` (Bithumb: KST, Binance: UTC). Weekly bars start Monday.
 */
export function bucketStart(tsMs: number, interval: Interval, tzOffset = 0): number {
  const s = Math.floor(tsMs / 1000) + tzOffset
  let start: number
  if (interval === '1D' || interval === '1W') {
    const day = s - (s % 86400)
    // 1970-01-01 was a Thursday.
    start = interval === '1D' ? day : day - ((Math.floor(day / 86400) + 3) % 7) * 86400
  } else {
    const len = INTERVAL_SEC[interval]
    start = s - (s % len)
  }
  return start - tzOffset
}

/** Newly listed coins with no trades yet can report a null price. */
export const isValidTicker = (t: Ticker) => Number.isFinite(t?.trade_price)
