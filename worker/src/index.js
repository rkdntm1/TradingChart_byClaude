// Cloudflare Worker: read-only relay for Alpaca US stock market data.
//
// Why a server at all: Alpaca needs an API key + secret on every request, and
// the ChartView site is static (everything it ships is public). The keys live
// here as Worker secrets (ALPACA_KEY_ID, ALPACA_SECRET_KEY) and never reach the
// browser. Responses are cached briefly so many visitors share one upstream call
// (Alpaca's free plan allows 200 requests/min).
//
// Routes (GET only, allowed origins only):
//   /snapshots?symbols=AAPL,MSFT        latest trade + daily bars per symbol
//   /bars?symbol=AAPL&timeframe=15Min[&end=ISO]   latest 200 bars (before `end`)
//   /assets                             every active, tradable US-listed stock as [symbol, name]

const DATA = 'https://data.alpaca.markets/v2'
// The asset list lives on the trading API; paper-trading keys use the paper host.
const TRADING = 'https://paper-api.alpaca.markets/v2'
const LISTED = new Set(['NASDAQ', 'NYSE', 'ARCA', 'AMEX', 'BATS'])
const TIMEFRAMES = new Set(['1Min', '5Min', '15Min', '1Hour', '4Hour', '1Day', '1Week'])
const SYMBOL = /^[A-Z][A-Z.]{0,9}$/
const MAX_SYMBOLS = 100
const BARS_LIMIT = 200
const HISTORY_START = '2016-01-01T00:00:00Z' // free plan history begins 2016

// Seconds to reuse an upstream response.
const TTL = { snapshots: 10, barsLive: 4, barsHistory: 300, assets: 12 * 3600 }

// Per-isolate memory cache (the Cache API is unavailable on *.workers.dev).
const memo = new Map()

function allowedOrigin(origin, env) {
  if (!origin) return null
  const list = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (list.includes(origin)) return origin
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin // local development
  return null
}

const cors = (origin) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
})

const json = (status, body, headers = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

async function upstream(url, env, ttl) {
  const hit = memo.get(url)
  if (hit && hit.expires > Date.now()) return hit
  const res = await fetch(url, {
    headers: {
      'APCA-API-KEY-ID': env.ALPACA_KEY_ID,
      'APCA-API-SECRET-KEY': env.ALPACA_SECRET_KEY,
      Accept: 'application/json',
    },
  })
  const entry = { status: res.status, body: await res.text(), expires: Date.now() + ttl * 1000 }
  if (res.ok) {
    memo.set(url, entry)
    if (memo.size > 500) memo.delete(memo.keys().next().value) // keep memory bounded
  }
  return entry
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/' || url.pathname === '/health') {
      return json(200, { ok: true, service: 'chartview-us-stocks', keys: Boolean(env.ALPACA_KEY_ID && env.ALPACA_SECRET_KEY) })
    }

    const origin = allowedOrigin(request.headers.get('Origin'), env)
    if (!origin) return json(403, { error: 'origin not allowed' })
    const headers = cors(origin)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'GET') return json(405, { error: 'method not allowed' }, headers)
    if (!env.ALPACA_KEY_ID || !env.ALPACA_SECRET_KEY) return json(500, { error: 'worker secrets not set' }, headers)

    if (url.pathname === '/snapshots') {
      const symbols = (url.searchParams.get('symbols') || '').split(',').filter(Boolean)
      if (!symbols.length || symbols.length > MAX_SYMBOLS || !symbols.every((s) => SYMBOL.test(s))) {
        return json(400, { error: 'bad symbols' }, headers)
      }
      const q = new URLSearchParams({ symbols: [...symbols].sort().join(','), feed: 'iex' })
      const r = await upstream(`${DATA}/stocks/snapshots?${q}`, env, TTL.snapshots)
      return json(r.status, r.body, headers)
    }

    if (url.pathname === '/bars') {
      const symbol = url.searchParams.get('symbol') || ''
      const timeframe = url.searchParams.get('timeframe') || ''
      const end = url.searchParams.get('end')
      if (!SYMBOL.test(symbol) || !TIMEFRAMES.has(timeframe)) return json(400, { error: 'bad params' }, headers)
      if (end && Number.isNaN(Date.parse(end))) return json(400, { error: 'bad end' }, headers)
      const q = new URLSearchParams({
        timeframe,
        start: HISTORY_START,
        limit: String(BARS_LIMIT),
        sort: 'desc', // newest first, so `limit` keeps the most recent bars
        feed: 'iex', // the free plan may query recent data only from IEX
        adjustment: 'split',
      })
      if (end) q.set('end', new Date(end).toISOString())
      const r = await upstream(`${DATA}/stocks/${symbol}/bars?${q}`, env, end ? TTL.barsHistory : TTL.barsLive)
      return json(r.status, r.body, headers)
    }

    if (url.pathname === '/assets') {
      // ~11k rows upstream; reduce to [symbol, name] for listed, tradable stocks and cache for hours.
      const key = 'assets:compact'
      let hit = memo.get(key)
      if (!hit || hit.expires < Date.now()) {
        const r = await upstream(`${TRADING}/assets?status=active&asset_class=us_equity`, env, 60)
        if (r.status !== 200) return json(r.status, r.body, headers)
        const rows = JSON.parse(r.body)
          .filter((a) => a.tradable && LISTED.has(a.exchange) && SYMBOL.test(a.symbol))
          .map((a) => [a.symbol, a.name])
          .sort((a, b) => a[0].localeCompare(b[0]))
        memo.delete(`${TRADING}/assets?status=active&asset_class=us_equity`) // keep only the compact copy
        hit = { status: 200, body: JSON.stringify(rows), expires: Date.now() + TTL.assets * 1000 }
        memo.set(key, hit)
      }
      return json(200, hit.body, { ...headers, 'Cache-Control': 'public, max-age=3600' })
    }

    return json(404, { error: 'not found' }, headers)
  },
}
