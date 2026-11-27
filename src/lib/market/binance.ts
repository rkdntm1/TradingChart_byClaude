// Binance spot — USDT markets, via Binance's public market-data-only hosts
// (data-api.binance.vision / data-stream.binance.vision). No API key needed,
// and browser requests work directly (CORS allowed).
// Docs: https://developers.binance.com/docs/binance-spot-api-docs

import { getJson, openSocket } from './net'
import { isValidTicker, type Candle, type DataSource, type Interval, type Market, type Ticker } from './types'

const REST = 'https://data-api.binance.vision/api/v3'
const WS = 'wss://data-stream.binance.vision/ws'

const KLINE_INTERVAL: Record<Interval, string> = {
  '1m': '1m',
  '3m': '3m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '4h': '4h',
  '1D': '1d',
  '1W': '1w',
}

interface RawSymbol {
  symbol: string
  status: string
  baseAsset: string
  quoteAsset: string
  isSpotTradingAllowed: boolean
  filters: { filterType: string; tickSize?: string }[]
}

/** "0.01000000" → 2 decimals. */
function decimalsOf(tickSize?: string): number | undefined {
  if (!tickSize) return undefined
  const trimmed = tickSize.replace(/0+$/, '')
  const dot = trimmed.indexOf('.')
  return dot < 0 ? 0 : trimmed.length - dot - 1
}

interface MiniTicker {
  symbol: string
  openPrice: string
  highPrice: string
  lowPrice: string
  lastPrice: string
  quoteVolume: string
}

interface StreamMiniTicker {
  s: string // symbol
  c: string // close (last price)
  o: string // open 24h ago
  h: string
  l: string
  q: string // quote volume
}

function makeTicker(code: string, last: number, open: number, high: number, low: number, quoteVol: number): Ticker {
  const diff = last - open
  return {
    code,
    trade_price: last,
    signed_change_price: diff,
    signed_change_rate: open ? diff / open : 0,
    change: diff > 0 ? 'RISE' : diff < 0 ? 'FALL' : 'EVEN',
    acc_trade_price_24h: quoteVol,
    high_price: high,
    low_price: low,
  }
}

export const binance: DataSource = {
  id: 'binance',
  quote: 'USDT',
  label: 'USDT · 바이낸스',
  candleTzOffset: 0, // Binance candles are aligned to UTC

  async fetchMarkets(): Promise<Market[]> {
    // showPermissionSets=false cuts the payload from ~6MB to ~2.5MB.
    const info = await getJson<{ symbols: RawSymbol[] }>(
      `${REST}/exchangeInfo?permissions=SPOT&symbolStatus=TRADING&showPermissionSets=false`,
    )
    return info.symbols
      .filter((s) => s.quoteAsset === 'USDT' && s.status === 'TRADING' && s.isSpotTradingAllowed)
      .map((s) => ({
        market: s.symbol,
        source: 'binance',
        base: s.baseAsset,
        quote: 'USDT',
        // Binance has no Korean names; useMarketData fills them from Bithumb by symbol.
        korean_name: s.baseAsset,
        english_name: s.baseAsset,
        priceDecimals: decimalsOf(s.filters.find((f) => f.filterType === 'PRICE_FILTER')?.tickSize),
      }))
  },

  async fetchTickers(markets) {
    const wanted = new Set(markets.map((m) => m.market))
    const all = await getJson<MiniTicker[]>(`${REST}/ticker/24hr?type=MINI`)
    return all
      .filter((t) => wanted.has(t.symbol))
      .map((t) => makeTicker(t.symbol, +t.lastPrice, +t.openPrice, +t.highPrice, +t.lowPrice, +t.quoteVolume))
      .filter(isValidTicker)
  },

  subscribeTickers(markets, onTicker) {
    const wanted = new Set(markets.map((m) => m.market))
    // One stream for every symbol; Binance pushes only the ones that changed, about once a second.
    return openSocket(
      `${WS}/!miniTicker@arr`,
      () => {},
      (msg) => {
        if (!Array.isArray(msg)) return
        for (const t of msg as StreamMiniTicker[]) {
          if (wanted.has(t.s)) onTicker(makeTicker(t.s, +t.c, +t.o, +t.h, +t.l, +t.q))
        }
      },
    )
  },

  async fetchCandles(market, interval, toUtcSec) {
    const params = new URLSearchParams({ symbol: market, interval: KLINE_INTERVAL[interval], limit: '200' })
    if (toUtcSec) params.set('endTime', String(toUtcSec * 1000 - 1))
    // [openTime, open, high, low, close, volume, closeTime, ...]
    const raw = await getJson<(string | number)[][]>(`${REST}/klines?${params}`)
    return raw.map(
      (k): Candle => ({
        time: Math.floor(Number(k[0]) / 1000),
        open: +k[1],
        high: +k[2],
        low: +k[3],
        close: +k[4],
        volume: +k[5],
      }),
    )
  },

  subscribeTrades(market, onTrade) {
    return openSocket(
      `${WS}/${market.toLowerCase()}@aggTrade`,
      () => {},
      (msg) => {
        const m = msg as { s: string; p: string; q: string; T: number }
        if (m.s === market) onTrade({ code: market, trade_price: +m.p, trade_volume: +m.q, trade_timestamp: m.T })
      },
    )
  },
}
