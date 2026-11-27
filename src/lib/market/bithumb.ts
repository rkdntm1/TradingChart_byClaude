// Bithumb public API v1 — KRW markets. No API key needed.
// Docs: https://apidocs.bithumb.com
//
// Bithumb's v1 API mirrors Upbit's shapes. Differences we handle: candles are
// aligned to KST, the `to` parameter is KST "yyyy-MM-dd HH:mm:ss", there are
// ~490 KRW markets (ticker requests are chunked), errors can arrive as HTTP 200
// with an `{ error }` body (see getJson), and untraded coins have null prices.
// (We moved here from Upbit, which limits browser requests to 1 per 10 seconds.)

import { getJson, openSocket } from './net'
import { isValidTicker, KST_OFFSET, type Candle, type DataSource, type Interval, type Market, type Ticker } from './types'

const REST = 'https://api.bithumb.com/v1'
const WS = 'wss://ws-api.bithumb.com/websocket/v1'
/** Max market codes per /ticker request — longer URLs fail with 414. */
const TICKER_CHUNK = 100

const CANDLE_PATH: Record<Interval, string> = {
  '1m': 'candles/minutes/1',
  '3m': 'candles/minutes/3',
  '5m': 'candles/minutes/5',
  '15m': 'candles/minutes/15',
  '30m': 'candles/minutes/30',
  '1h': 'candles/minutes/60',
  '4h': 'candles/minutes/240',
  '1D': 'candles/days',
  '1W': 'candles/weeks',
}

interface RawMarket {
  market: string
  korean_name: string
  english_name: string
}

interface RawCandle {
  candle_date_time_utc: string
  opening_price: number
  high_price: number
  low_price: number
  trade_price: number
  candle_acc_trade_volume: number
}

type RawTicker = Ticker & { market?: string }

const toTicker = (t: RawTicker): Ticker => ({
  code: t.code ?? t.market!,
  trade_price: t.trade_price,
  signed_change_rate: t.signed_change_rate,
  signed_change_price: t.signed_change_price,
  change: t.change,
  acc_trade_price_24h: t.acc_trade_price_24h,
  high_price: t.high_price,
  low_price: t.low_price,
})

export const bithumb: DataSource = {
  id: 'bithumb',
  quote: 'KRW',
  label: '원화 · 빗썸',
  candleTzOffset: KST_OFFSET,

  async fetchMarkets(): Promise<Market[]> {
    const all = await getJson<RawMarket[]>(`${REST}/market/all?is_details=false`)
    return all
      .filter((m) => m.market.startsWith('KRW-'))
      .map((m) => ({
        market: m.market,
        source: 'bithumb',
        base: m.market.slice(4),
        quote: 'KRW',
        korean_name: m.korean_name,
        english_name: m.english_name,
      }))
  },

  async fetchTickers(markets) {
    const codes = markets.map((m) => m.market)
    const out: Ticker[] = []
    // Sequential chunks: keeps URLs short and request bursts small.
    for (let i = 0; i < codes.length; i += TICKER_CHUNK) {
      const chunk = codes.slice(i, i + TICKER_CHUNK)
      const raw = await getJson<RawTicker[]>(`${REST}/ticker?markets=${chunk.join(',')}`)
      out.push(...raw.map(toTicker).filter(isValidTicker))
    }
    return out
  },

  subscribeTickers(markets, onTicker) {
    const codes = markets.map((m) => m.market)
    return openSocket(
      WS,
      (ws) => ws.send(JSON.stringify([{ ticket: crypto.randomUUID() }, { type: 'ticker', codes }, { format: 'DEFAULT' }])),
      (msg) => {
        const t = toTicker(msg as RawTicker)
        if (isValidTicker(t)) onTicker(t)
      },
    )
  },

  async fetchCandles(market, interval, toUtcSec) {
    const params = new URLSearchParams({ market, count: '200' })
    // Bithumb reads `to` as Korean time in "yyyy-MM-dd HH:mm:ss" (a trailing Z is rejected).
    if (toUtcSec) params.set('to', new Date((toUtcSec + KST_OFFSET) * 1000).toISOString().slice(0, 19).replace('T', ' '))
    const raw = await getJson<RawCandle[]>(`${REST}/${CANDLE_PATH[interval]}?${params}`)
    return raw
      .map(
        (c): Candle => ({
          time: Math.floor(Date.parse(c.candle_date_time_utc + 'Z') / 1000),
          open: c.opening_price,
          high: c.high_price,
          low: c.low_price,
          close: c.trade_price,
          volume: c.candle_acc_trade_volume,
        }),
      )
      .reverse()
  },

  subscribeTrades(market, onTrade) {
    return openSocket(
      WS,
      (ws) =>
        ws.send(JSON.stringify([{ ticket: crypto.randomUUID() }, { type: 'trade', codes: [market] }, { format: 'DEFAULT' }])),
      (msg) => {
        const t = msg as { code: string; trade_price: number; trade_volume: number; trade_timestamp: number }
        if (t.code === market) onTrade(t)
      },
    )
  },
}
