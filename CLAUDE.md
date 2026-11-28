# ChartView — notes for Claude

TradingView-style chart web app. React 19 + TypeScript + Vite, charts with
lightweight-charts v5. Static site on GitHub Pages; the only server is a
Cloudflare Worker for US stock data. UI text and docs are Korean.

- Live: https://rkdntm1.github.io/TradingChart_byClaude/
- Repo: https://github.com/rkdntm1/TradingChart_byClaude (`main`)
- Worker: https://chartview-us-stocks.rkdntm1.workers.dev

## Commands

```bash
npm run dev     # http://localhost:5173
npx tsc -b      # type-check (fast; run after every change)
npm run build   # tsc + vite build (CI runs this)
npx oxlint src  # lint (a few intentional "ref in render" warnings exist)
```

Worker (`worker/`, NOT deployed by git push): `cd worker && npx wrangler deploy`
(on Windows PowerShell use `npx.cmd`; the login is already stored). Secrets
`ALPACA_KEY_ID` / `ALPACA_SECRET_KEY` live only in Cloudflare — never ask the
user to paste them in chat; they type them into `wrangler secret put`.

## Layout

```
src/
  App.tsx                 header, toolbar, chart grid, global shortcuts (1–9, /, ?)
  components/
    Chart.tsx             one chart: data load + live updates, indicators, drawing input,
                          legends, countdown, scale controls, undo/redo, Chart-level shortcuts
    DrawingToolbar.tsx    left tool column      Watchlist.tsx  market list, sort, ↑/↓, US search
    AlertPanel.tsx Toasts.tsx  price alerts       IndicatorSettings.tsx  indicator params panel
    ShortcutHelp.tsx      "?" overlay           ChartErrorBoundary.tsx  per-chart error boundary
  hooks/
    useMarketData.ts      markets + live tickers from every source (+ add/remove US stocks)
    useChartLayout.ts     1 / 2h / 2v / 4 layouts, per-cell {market, interval}, active cell
    useAlerts.ts          alert checks against the ticker stream
  lib/
    market/               DATA-SOURCE LAYER — see below
    drawings.ts           drawing engine (series primitive): render, hit-test, snap, persistence
    chartIndicators.ts    indicator series + IndicatorParams/normalizeParams + legend values
    indicators.ts         pure math (sma/ema/bollinger/rsi/macd)
    shortcuts.ts          single table for key bindings + help overlay
    alerts.ts             alert model, notifications, chime
worker/src/index.js       Alpaca relay: /snapshots /bars /assets /health (origin allowlist, caching)
```

## Data-source layer (`src/lib/market`)

- `types.ts`: exchange-neutral `Market`/`Ticker`/`Candle`/`Trade`, `DataSource`,
  `bucketStart(ts, interval, tzOffset)`, `INTERVALS`, `INTERVAL_SEC`.
- Source is chosen by market code (`sourceOf`): `KRW-BTC` → Bithumb, `US-AAPL` →
  US stocks, anything else (`BTCUSDT`) → Binance.
- `bithumb.ts`: KRW, candles aligned to **KST**; `to` param is KST
  `"yyyy-MM-dd HH:mm:ss"`; tickers requested in chunks of 100 (URL length → 414);
  HTTP 200 can carry `{error}`; untraded coins have `trade_price: null`.
- `binance.ts`: USDT via `data-api.binance.vision` / `data-stream.binance.vision`;
  candles aligned to UTC; price decimals from `tickSize`.
- `usstocks.ts`: via the Worker; polling (bars 5s, snapshots 15s) because Alpaca's
  free plan allows one stream per account; curated list + user-added symbols.
- `format.ts`: `formatPrice(p, code, ref?)` — pass `ref` (current price) when
  formatting a price *difference*; `formatVolume`, `pairLabel`, `priceDecimals`.
- Upbit is NOT used: it throttles browser (Origin) requests to 1 per 10s.

## Conventions

- Workflow the user expects: implement → `npx tsc -b` → verify in the browser
  (dev server, then the live site after deploy) → commit + push per feature →
  update the Obsidian notes in `D:\obsidian_doc\TradingChart_byClaude\`
  (feature note, `07 구축 과정` timeline/step, `00 프로젝트 개요` checklist) and README.
- Commit messages end with `Co-Authored-By: Claude …` (see session instructions).
- localStorage keys are prefixed `chartview:`; every read/write is in try/catch.
- Times inside the app are UTC seconds; only the chart display adds `KST_OFFSET`.
- Drawings are stored per market as `(bar time, price)`, never pixels or indexes.
- Keep shortcuts in `lib/shortcuts.ts`; ignore keys while typing (`isTypingTarget`).
- In multi-chart mode only the active chart handles keys (`active` prop).

## Gotchas (learned the hard way)

- Windows PowerShell 5.1 `Get-Content`/`Set-Content` corrupt UTF-8 Korean text.
  Edit with the Edit tool, `sed`, or a node script file — not PowerShell text cmdlets.
- In bash, never put JS/Markdown containing backticks inside `node -e "…"`: the
  shell runs them as commands. Write a script file in the scratchpad instead.
- `npx` is blocked by the PowerShell execution policy → use `npx.cmd`.
- The workspace path is long: `wrangler dev` needs `--persist-to <short path>`.
- lightweight-charts: `logicalToCoordinate` returns 0 for fractional logicals
  (interpolate between neighbours); `subscribeClick` drops a 2nd click inside the
  double-click window (drawing uses raw pointer events); `paneSize()` throws on a
  chart being torn down (guarded).
- React `autoFocus` doesn't fire `onFocus` (memo undo records on first keystroke).
- Browser verification: the in-app pane is narrow; use `resize_window` (1280×800)
  and drive the UI with dispatched PointerEvent/KeyboardEvent from JS rather than
  screenshot coordinates. Clean up test drawings/alerts from localStorage after.
