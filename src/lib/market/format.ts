// Price / volume formatting that depends on the market's quote currency.
//
// Markets register their metadata once they are loaded; formatters look the
// code up so callers only need to pass the market code.

import type { Market, Quote } from './types'

const registry = new Map<string, Pick<Market, 'quote' | 'priceDecimals' | 'base'>>()

export function registerMarkets(markets: Market[]) {
  for (const m of markets) registry.set(m.market, { quote: m.quote, priceDecimals: m.priceDecimals, base: m.base })
}

/** Quote currency of a market code (works before markets are loaded). */
export const quoteOf = (code: string): Quote =>
  registry.get(code)?.quote ?? (code.startsWith('KRW-') ? 'KRW' : code.startsWith('US-') ? 'USD' : 'USDT')

/** Base asset, e.g. KRW-BTC → BTC, BTCUSDT → BTC, US-AAPL → AAPL. */
export const baseOf = (code: string): string =>
  registry.get(code)?.base ??
  (code.startsWith('KRW-') ? code.slice(4) : code.startsWith('US-') ? code.slice(3) : code.replace(/USDT$/, ''))

/** Display pair, e.g. "BTC/KRW" or "BTC/USDT". */
export const pairLabel = (code: string) => `${baseOf(code)}/${quoteOf(code)}`

/** Decimal places used for a market's prices (chart scale, inputs, labels). */
export function priceDecimals(code: string, price: number): number {
  const known = registry.get(code)?.priceDecimals
  if (known !== undefined) return known
  if (quoteOf(code) === 'KRW') {
    if (price >= 100) return 0
    if (price >= 1) return 2
    if (price >= 0.01) return 4
    return 6
  }
  // US stocks trade in cents (sub-dollar stocks in 1/100 cent).
  if (quoteOf(code) === 'USD') return price >= 1 ? 2 : 4
  // USDT fallback: about 5 significant digits.
  if (!Number.isFinite(price) || price <= 0) return 2
  return Math.min(8, Math.max(2, 4 - Math.floor(Math.log10(price))))
}

export function formatPrice(p: number | null | undefined, code: string): string {
  if (p == null || !Number.isFinite(p)) return '-'
  const d = priceDecimals(code, p)
  return p.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d })
}

/** 24h traded value in the quote currency: 억/조 for KRW, $K/$M/$B for USDT. */
export function formatVolume(v: number | null | undefined, code: string): string {
  if (v == null || !Number.isFinite(v)) return '-'
  if (quoteOf(code) === 'KRW') {
    if (v >= 1e12) return (v / 1e12).toFixed(1) + '조'
    if (v >= 1e8) return Math.round(v / 1e8).toLocaleString('ko-KR') + '억'
    if (v >= 1e4) return Math.round(v / 1e4).toLocaleString('ko-KR') + '만'
    return Math.round(v).toLocaleString('ko-KR')
  }
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K'
  return '$' + v.toFixed(0)
}

/** Unit suffix for prices in sentences, e.g. "84,000,000원" / "61,234.56 USDT" / "231.50 USD". */
export const priceUnit = (code: string) => (quoteOf(code) === 'KRW' ? '원' : ` ${quoteOf(code)}`)
