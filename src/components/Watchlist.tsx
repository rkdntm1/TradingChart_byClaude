import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { formatPrice, formatVolumeKrw, type Market, type Ticker } from '../lib/upbit'

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
  const [tab, setTab] = useState<'all' | 'fav'>('all')
  const [favorites, setFavorites] = useState<string[]>(loadFavorites)

  useEffect(() => {
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(favorites))
    } catch {
      /* storage unavailable */
    }
  }, [favorites])

  const toggleFav = (code: string) =>
    setFavorites((f) => (f.includes(code) ? f.filter((c) => c !== code) : [...f, code]))

  // Order by 24h trade value; re-sorting every tick would make rows jump, so only
  // re-sort when the market list, tab or query changes.
  const tickersRef = useRef(tickers)
  tickersRef.current = tickers
  const hasTickers = Object.keys(tickers).length > 0
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const t = tickersRef.current
    return markets
      .filter((m) => tab === 'all' || favorites.includes(m.market))
      .filter(
        (m) =>
          !q ||
          m.korean_name.toLowerCase().includes(q) ||
          m.english_name.toLowerCase().includes(q) ||
          m.market.toLowerCase().includes(q),
      )
      .sort((a, b) => (t[b.market]?.acc_trade_price_24h ?? 0) - (t[a.market]?.acc_trade_price_24h ?? 0))
  }, [markets, tab, favorites, query, hasTickers])

  return (
    <aside className="side">
      <div className="side-head">
        <input
          className="search"
          placeholder="코인명 / 심볼 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="tabs">
          <button className={`tb-btn ${tab === 'all' ? 'on' : ''}`} onClick={() => setTab('all')}>
            원화 마켓
          </button>
          <button className={`tb-btn ${tab === 'fav' ? 'on' : ''}`} onClick={() => setTab('fav')}>
            관심종목 {favorites.length}
          </button>
        </div>
      </div>
      <div className="list-head">
        <i />
        <i>종목</i>
        <span>현재가</span>
        <span>전일대비</span>
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
        시세: Upbit 공개 API · 차트:{' '}
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
        <small>{market.market.replace('KRW-', '')}/KRW</small>
      </div>
      <span className={`num ${cls} ${flash}`}>{ticker ? formatPrice(ticker.trade_price) : '-'}</span>
      <span className={`num ${cls}`}>
        {ticker ? `${ticker.signed_change_rate > 0 ? '+' : ''}${(ticker.signed_change_rate * 100).toFixed(2)}%` : '-'}
      </span>
      <span className="num vol">{ticker ? formatVolumeKrw(ticker.acc_trade_price_24h) : '-'}</span>
    </div>
  )
})
