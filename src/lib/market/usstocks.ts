// US stocks via Alpaca market data (free plan, IEX feed), reached through our
// Cloudflare Worker (/worker) which holds the API keys. Market codes are
// prefixed "US-" (e.g. US-AAPL) so they never collide with coin markets.
//
// Live updates poll the Worker instead of using Alpaca's WebSocket: the free
// plan allows only one concurrent stream per account, which a public site with
// several visitors would exhaust. The Worker caches responses for a few seconds.

import { getJson } from './net'
import type { Candle, DataSource, Interval, Market, Ticker } from './types'

const PROXY = (import.meta.env.VITE_US_STOCK_PROXY as string | undefined)?.replace(/\/+$/, '')

/** Whether a Worker URL was configured at build time. */
export const usStocksEnabled = Boolean(PROXY)

const TIMEFRAME: Record<Interval, string> = {
  '1m': '1Min',
  '3m': '3Min',
  '5m': '5Min',
  '15m': '15Min',
  '30m': '30Min',
  '1h': '1Hour',
  '4h': '4Hour',
  '1D': '1Day',
  '1W': '1Week',
}

const BAR_POLL_MS = 5000
const SNAPSHOT_POLL_MS = 15000

/** Curated list: popular US stocks and ETFs among Korean investors. */
const STOCKS: [symbol: string, korean: string, english: string][] = [
  ['AAPL', '애플', 'Apple'],
  ['MSFT', '마이크로소프트', 'Microsoft'],
  ['NVDA', '엔비디아', 'NVIDIA'],
  ['AMZN', '아마존', 'Amazon'],
  ['GOOGL', '알파벳 A', 'Alphabet Class A'],
  ['META', '메타 플랫폼스', 'Meta Platforms'],
  ['TSLA', '테슬라', 'Tesla'],
  ['AVGO', '브로드컴', 'Broadcom'],
  ['BRK.B', '버크셔 해서웨이 B', 'Berkshire Hathaway B'],
  ['JPM', 'JP모건 체이스', 'JPMorgan Chase'],
  ['V', '비자', 'Visa'],
  ['MA', '마스터카드', 'Mastercard'],
  ['LLY', '일라이 릴리', 'Eli Lilly'],
  ['UNH', '유나이티드헬스', 'UnitedHealth'],
  ['XOM', '엑슨모빌', 'Exxon Mobil'],
  ['WMT', '월마트', 'Walmart'],
  ['COST', '코스트코', 'Costco'],
  ['NFLX', '넷플릭스', 'Netflix'],
  ['AMD', 'AMD', 'Advanced Micro Devices'],
  ['INTC', '인텔', 'Intel'],
  ['ORCL', '오라클', 'Oracle'],
  ['CRM', '세일즈포스', 'Salesforce'],
  ['ADBE', '어도비', 'Adobe'],
  ['QCOM', '퀄컴', 'Qualcomm'],
  ['PLTR', '팔란티어', 'Palantir'],
  ['COIN', '코인베이스', 'Coinbase'],
  ['MSTR', '스트래티지', 'Strategy'],
  ['UBER', '우버', 'Uber'],
  ['DIS', '디즈니', 'Walt Disney'],
  ['KO', '코카콜라', 'Coca-Cola'],
  ['PEP', '펩시코', 'PepsiCo'],
  ['MCD', '맥도날드', "McDonald's"],
  ['NKE', '나이키', 'Nike'],
  ['BA', '보잉', 'Boeing'],
  ['IONQ', '아이온큐', 'IonQ'],
  ['SOFI', '소파이', 'SoFi'],
  ['SPY', 'SPDR S&P 500 ETF', 'SPDR S&P 500 ETF'],
  ['QQQ', '인베스코 QQQ ETF', 'Invesco QQQ'],
  ['TQQQ', '프로셰어즈 울트라프로 QQQ', 'ProShares UltraPro QQQ'],
  ['SOXL', '디렉시온 반도체 3X', 'Direxion Semiconductor Bull 3X'],
  ['SCHD', '슈왑 미국 배당 ETF', 'Schwab US Dividend Equity ETF'],
]

const code = (symbol: string) => `US-${symbol}`
const symbolOf = (market: string) => market.slice(3)

interface AlpacaBar {
  t: string // ISO time of bar start
  o: number
  h: number
  l: number
  c: number
  v: number
  vw?: number
}

interface Snapshot {
  latestTrade?: { p: number; t: string }
  dailyBar?: AlpacaBar
  prevDailyBar?: AlpacaBar
}

const toCandle = (b: AlpacaBar): Candle => ({
  time: Math.floor(Date.parse(b.t) / 1000),
  open: b.o,
  high: b.h,
  low: b.l,
  close: b.c,
  volume: b.v,
})

function toTicker(market: string, s: Snapshot): Ticker | null {
  const price = s.latestTrade?.p ?? s.dailyBar?.c
  if (!Number.isFinite(price)) return null
  const prev = s.prevDailyBar?.c
  const diff = prev ? price! - prev : 0
  const daily = s.dailyBar
  return {
    code: market,
    trade_price: price!,
    signed_change_price: diff,
    signed_change_rate: prev ? diff / prev : 0,
    change: diff > 0 ? 'RISE' : diff < 0 ? 'FALL' : 'EVEN',
    // Dollar volume of the latest session on IEX (a slice of total US volume).
    acc_trade_price_24h: daily ? daily.v * (daily.vw ?? daily.c) : 0,
    high_price: daily?.h ?? price!,
    low_price: daily?.l ?? price!,
    timestamp: s.latestTrade?.t ? Date.parse(s.latestTrade.t) : undefined,
  }
}

function requireProxy(): string {
  if (!PROXY) throw new Error('US stock proxy is not configured (VITE_US_STOCK_PROXY)')
  return PROXY
}

async function fetchSnapshots(markets: Market[]): Promise<Ticker[]> {
  if (!markets.length) return []
  const symbols = markets.map((m) => symbolOf(m.market)).join(',')
  const data = await getJson<Record<string, Snapshot>>(`${requireProxy()}/snapshots?symbols=${encodeURIComponent(symbols)}`)
  return Object.entries(data)
    .map(([sym, s]) => toTicker(code(sym), s))
    .filter((t): t is Ticker => t !== null)
}

// ---- market session (New York time) ----

export type UsSession = 'pre' | 'regular' | 'after' | 'closed'

export const US_SESSION_LABEL: Record<UsSession, string> = {
  pre: '프리마켓',
  regular: '정규장',
  after: '애프터마켓',
  closed: '장 마감',
}

/**
 * US equity session by the New York clock: pre 04:00–09:30, regular 09:30–16:00,
 * after-hours 16:00–20:00, otherwise closed; weekends closed. Exchange holidays
 * are not known here — callers can treat a stale last trade as "closed".
 */
export function usSession(now = new Date()): UsSession {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  if (get('weekday') === 'Sat' || get('weekday') === 'Sun') return 'closed'
  const mins = Number(get('hour')) * 60 + Number(get('minute'))
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return 'pre'
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return 'regular'
  if (mins >= 16 * 60 && mins < 20 * 60) return 'after'
  return 'closed'
}

// ---- user-added stocks (search) ----

const EXTRA_KEY = 'chartview:us-extra'
/** Snapshot requests take at most 100 symbols, and 41 are built in. */
export const MAX_EXTRA_US = 100 - STOCKS.length

interface Extra {
  symbol: string
  name: string
}

function loadExtras(): Extra[] {
  try {
    const raw = JSON.parse(localStorage.getItem(EXTRA_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((e) => typeof e?.symbol === 'string' && typeof e?.name === 'string') : []
  } catch {
    return []
  }
}

function saveExtras(extras: Extra[]) {
  try {
    localStorage.setItem(EXTRA_KEY, JSON.stringify(extras))
  } catch {
    /* storage unavailable */
  }
}

/** "Rivian Automotive, Inc. Class A Common Stock" → "Rivian Automotive, Inc. Class A". */
export const cleanName = (name: string) =>
  name
    .replace(/\s+(Common Stock|Common Shares|Ordinary Shares|American Depositary Shares.*|ADS.*)$/i, '')
    .trim()

const BUILT_IN = new Set(STOCKS.map(([s]) => s))

const extraMarket = ({ symbol, name }: Extra): Market => ({
  market: code(symbol),
  source: 'us',
  base: symbol,
  quote: 'USD',
  korean_name: cleanName(name), // no Korean name available: show the English one
  english_name: name,
})

/** Whether a US market was added by the user (and can be removed). */
export const isUserAddedUs = (market: string) => market.startsWith('US-') && !BUILT_IN.has(symbolOf(market))

/** Symbols currently polled for the market list; edited when stocks are added/removed. */
const watched = new Map<string, Market>()

/** Add a stock to the US list (persisted). Returns its market, or null if the list is full. */
export function addUsStock(symbol: string, name: string): Market | null {
  const extras = loadExtras()
  if (BUILT_IN.has(symbol) || extras.some((e) => e.symbol === symbol)) return extraOrBuiltIn(symbol, extras)
  if (extras.length >= MAX_EXTRA_US) return null
  const extra = { symbol, name }
  saveExtras([...extras, extra])
  const m = extraMarket(extra)
  watched.set(m.market, m)
  return m
}

function extraOrBuiltIn(symbol: string, extras: Extra[]): Market | null {
  const e = extras.find((x) => x.symbol === symbol)
  return e ? extraMarket(e) : (watched.get(code(symbol)) ?? null)
}

export function removeUsStock(market: string) {
  if (!isUserAddedUs(market)) return
  saveExtras(loadExtras().filter((e) => e.symbol !== symbolOf(market)))
  watched.delete(market)
}

// ---- searching every listed US stock ----

let assetsPromise: Promise<[string, string][]> | null = null

/** All active, tradable US-listed stocks/ETFs ([symbol, name]); downloaded once, on first search. */
function loadAssets() {
  assetsPromise ??= getJson<[string, string][]>(`${requireProxy()}/assets`).catch((err) => {
    assetsPromise = null // allow a retry on the next search
    throw err
  })
  return assetsPromise
}

export interface UsAsset {
  symbol: string
  name: string
}

/**
 * Search all US stocks by symbol or English name. Exact symbol first, then
 * symbols starting with the query, then names containing it.
 */
export async function searchUsAssets(query: string, limit = 20): Promise<UsAsset[]> {
  const q = query.trim()
  if (!q) return []
  const assets = await loadAssets()
  const up = q.toUpperCase()
  const low = q.toLowerCase()
  const exact: UsAsset[] = []
  const prefix: UsAsset[] = []
  const named: UsAsset[] = []
  for (const [symbol, name] of assets) {
    if (symbol === up) exact.push({ symbol, name })
    else if (symbol.startsWith(up)) prefix.push({ symbol, name })
    else if (name.toLowerCase().includes(low)) named.push({ symbol, name })
  }
  prefix.sort((a, b) => a.symbol.length - b.symbol.length || a.symbol.localeCompare(b.symbol))
  return [...exact, ...prefix, ...named].slice(0, limit)
}

async function fetchBars(market: string, interval: Interval, toUtcSec?: number): Promise<Candle[]> {
  const params = new URLSearchParams({ symbol: symbolOf(market), timeframe: TIMEFRAME[interval] })
  if (toUtcSec) params.set('end', new Date((toUtcSec - 1) * 1000).toISOString())
  const res = await getJson<{ bars: AlpacaBar[] | null }>(`${requireProxy()}/bars?${params}`)
  // The Worker asks for newest-first; the chart wants oldest-first.
  return (res.bars ?? []).map(toCandle).reverse()
}

/** Repeatedly run `fn` every `ms` until stopped (never overlapping). */
function poll(fn: () => Promise<void>, ms: number): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const loop = async () => {
    try {
      await fn()
    } catch {
      /* transient errors: try again next round */
    }
    if (!stopped) timer = setTimeout(loop, ms)
  }
  timer = setTimeout(loop, ms)
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}

export const usStocks: DataSource = {
  id: 'us',
  quote: 'USD',
  label: '미국주식',
  candleTzOffset: 0, // unused: bars come straight from Alpaca

  async fetchMarkets() {
    requireProxy()
    const builtIn: Market[] = STOCKS.map(([symbol, korean, english]) => ({
      market: code(symbol),
      source: 'us',
      base: symbol,
      quote: 'USD',
      korean_name: korean,
      english_name: english,
    }))
    return [...builtIn, ...loadExtras().filter((e) => !BUILT_IN.has(e.symbol)).map(extraMarket)]
  },

  fetchTickers: fetchSnapshots,

  subscribeTickers(markets, onTicker) {
    for (const m of markets) watched.set(m.market, m)
    // Poll whatever is watched right now, so stocks added later are included.
    return poll(async () => {
      for (const t of await fetchSnapshots([...watched.values()])) onTicker(t)
    }, SNAPSHOT_POLL_MS)
  },

  fetchCandles: fetchBars,

  subscribeBars(market, interval, onBar) {
    return poll(async () => {
      const bars = await fetchBars(market, interval)
      // The last two bars: the previous one may still be finalizing.
      for (const b of bars.slice(-2)) onBar(b)
    }, BAR_POLL_MS)
  },
}
