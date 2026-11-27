/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Cloudflare Worker that relays Alpaca US stock data (see /worker). */
  readonly VITE_US_STOCK_PROXY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
