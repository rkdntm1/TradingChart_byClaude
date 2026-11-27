import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { formatPrice, formatVolume, pairLabel, SOURCES, sourceOf, type Market, type SourceId, type Ticker } from '../lib/market'

type Tab = SourceId | 'fav'

const FAV_KEY = 'chartview:favorites'

function loadFavorites(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) ?? '["KRW-BTC","KRW-ETH","KRW-XRP"]')
  } catch {
    return ['KRW-BTC', 'KRW-ETH', 'KRW-XRP']
  }
}

interface Props {
  markets: Market[]
  tickers: Record<string, Ticker>
  selected: string
  onSelect: (market: string) => void
}

export default function Watchlist({ markets, tickers, selected, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>(() => sourceOf(selected).id)
  const [favorites, setFavorites] = useState<string[]>(loadFavorites)

  useEffect(() => {
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(favorites))
    } catch {
      /* storage unavailable */
    }
  }, [favorites])

  // Follow the selected market across exchanges (e.g. opened from an alert), unless on favorites.
  useEffect(() => {
    setTab((t) => (t === 'fav' ? t : sourceOf(selected).id))
  }, [selected])

  const toggleFav = (code: string) =>
    setFavorites((f) => (f.includes(code) ? f.filter((c) => c !== code) : [...f, code]))

  // Order by 24h trade value; re-sorting every tick would make rows jump, so only
  // re-sort when the market list, tab, query or the first tickers change.
  const tickersRef = useRef(tickers)
  tickersRef.current = tickers
  const tickerCount = Object.keys(tickers).length
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const t = tickersRef.current
    const matches = (m: Market) =>
      !q ||
      m.korean_name.toLowerCase().includes(q) ||
      m.english_name.toLowerCase().includes(q) ||
      m.market.toLowerCase().includes(q)
    if (tab === 'fav') {
      // Favorites mix KRW and USDT, so keep the order they were added in.
      const byCode = new Map(markets.map((m) => [m.market, m]))
      return favorites.map((c) => byCode.get(c)).filter((m): m is Market => !!m && matches(m))
    }
    return markets
      .filter((m) => m.source === tab && matches(m))
      .sort((a, b) => (t[b.market]?.acc_trade_price_24h ?? 0) - (t[a.market]?.acc_trade_price_24h ?? 0))
    // tickerCount: re-sort once each source's first tickers arrive
  }, [markets, tab, favorites, query, tickerCount > 0, Math.floor(tickerCount / 100)])

  return (
    <aside className="side">
      <div className="side-head">
        <input
          className="search"
          placeholder="종목명 / 심볼 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="tabs">
          {SOURCES.map((s) => (
            <button key={s.id} className={`tb-btn ${tab === s.id ? 'on' : ''}`} onClick={() => setTab(s.id)}>
              {s.label}
            </button>
          ))}
          <button className={`tb-btn ${tab === 'fav' ? 'on' : ''}`} onClick={() => setTab('fav')}>
            관심 {favorites.length}
          </button>
        </div>
      </div>
      <div className="list-head">
        <i />
        <i>종목</i>
        <span>현재가</span>
        <span>{tab === 'binance' ? '24h' : '전일대비'}</span>
        <span>거래대금</span>
      </div>
      <div className="list">
        {rows.map((m) => (
          <Row
            key={m.market}
            market={m}
            ticker={tickers[m.market]}
            selected={m.market === selected}
            favorite={favorites.includes(m.market)}
            onSelect={onSelect}
            onToggleFav={toggleFav}
          />
        ))}
        {!rows.length && <div className="empty">{markets.length ? '검색 결과가 없습니다' : '불러오는 중…'}</div>}
      </div>
      <div className="foot">
        시세: 빗썸 · 바이낸스 · Alpaca(IEX) · 차트:{' '}
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          TradingView Lightweight Charts
        </a>
      </div>
    </aside>
  )
}

interface RowProps {
  market: Market
  ticker?: Ticker
  selected: boolean
  favorite: boolean
  onSelect: (market: string) => void
  onToggleFav: (market: string) => void
}

const Row = memo(function Row({ market, ticker, selected, favorite, onSelect, onToggleFav }: RowProps) {
  const prev = useRef(ticker?.trade_price)
  const [flash, setFlash] = useState('')

  useEffect(() => {
    const p = ticker?.trade_price
    if (p !== undefined && prev.current !== undefined && p !== prev.current) {
      setFlash(p > prev.current ? 'flash-up' : 'flash-down')
      const id = setTimeout(() => setFlash(''), 500)
      prev.current = p
      return () => clearTimeout(id)
    }
    prev.current = p
  }, [ticker?.trade_price])

  const cls = !ticker || ticker.change === 'EVEN' ? '' : ticker.change === 'RISE' ? 'up' : 'down'
  return (
    <div className={`row ${selected ? 'sel' : ''}`} onClick={() => onSelect(market.market)}>
      <button
        className={`star ${favorite ? 'on' : ''}`}
        title={favorite ? '관심종목 해제' : '관심종목 추가'}
        onClick={(e) => {
          e.stopPropagation()
          onToggleFav(market.market)
        }}
      >
        {favorite ? '★' : '☆'}
      </button>
      <div className="name">
        <b>{market.korean_name}</b>
        <small>{pairLabel(market.market)}</small>
      </div>
      <span className={`num ${cls} ${flash}`}>{ticker ? formatPrice(ticker.trade_price, market.market) : '-'}</span>
      <span className={`num ${cls}`}>
        {ticker ? `${ticker.signed_change_rate > 0 ? '+' : ''}${(ticker.signed_change_rate * 100).toFixed(2)}%` : '-'}
      </span>
      <span className="num vol">{ticker ? formatVolume(ticker.acc_trade_price_24h, market.market) : '-'}</span>
    </div>
  )
})
