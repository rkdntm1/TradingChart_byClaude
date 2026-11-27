// Entry point for market data. Pick the source by market code:
// Bithumb codes look like "KRW-BTC", Binance codes like "BTCUSDT".

import { binance } from './binance'
import { bithumb } from './bithumb'
import type { DataSource } from './types'

export const SOURCES: DataSource[] = [bithumb, binance]

export const sourceOf = (code: string): DataSource => (code.startsWith('KRW-') ? bithumb : binance)

export * from './format'
export * from './types'
