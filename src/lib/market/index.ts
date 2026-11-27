// Entry point for market data. The source is picked by market code:
// "KRW-BTC" → Bithumb, "US-AAPL" → US stocks (Alpaca via our Worker),
// anything else (e.g. "BTCUSDT") → Binance.

import { binance } from './binance'
import { bithumb } from './bithumb'
import { usStocks, usStocksEnabled } from './usstocks'
export {
  addUsStock,
  cleanName,
  isUserAddedUs,
  MAX_EXTRA_US,
  removeUsStock,
  searchUsAssets,
  usStocksEnabled,
  type UsAsset,
} from './usstocks'
import type { DataSource } from './types'

/** Sources shown in the app. US stocks appear only when a Worker URL is configured. */
export const SOURCES: DataSource[] = [bithumb, binance, ...(usStocksEnabled ? [usStocks] : [])]

export const sourceOf = (code: string): DataSource =>
  code.startsWith('KRW-') ? bithumb : code.startsWith('US-') ? usStocks : binance

export * from './format'
export * from './types'
