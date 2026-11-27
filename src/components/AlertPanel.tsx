import { useEffect, useRef, useState } from 'react'
import {
  directionFor,
  notificationPermission,
  requestNotificationPermission,
  type NotifyPermission,
  type PriceAlert,
} from '../lib/alerts'
import { formatPrice, pairLabel, priceDecimals, priceUnit, quoteOf, type Ticker } from '../lib/market'

interface Props {
  market: string
  marketName: string
  ticker?: Ticker
  active: PriceAlert[]
  history: PriceAlert[]
  nameOf: (market: string) => string
  tickers: Record<string, Ticker>
  onAdd: (price: number, note: string) => void
  onRemove: (id: string) => void
  onClearHistory: () => void
  onOpenMarket: (market: string) => void
  onClose: () => void
}

const QUICK = [-5, -2, -1, 1, 2, 5]

const timeText = (ms: number) =>
  new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function AlertPanel(p: Props) {
  const current = p.ticker?.trade_price
  const [priceText, setPriceText] = useState(() => (current ? String(current) : ''))
  const [note, setNote] = useState('')
  const [perm, setPerm] = useState<NotifyPermission>(notificationPermission)
  const ref = useRef<HTMLDivElement>(null)
  const { onClose } = p

  // Close on outside click / Esc. (The parent remounts this panel per market via `key`.)
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      if (ref.current && !ref.current.contains(t) && !t.closest('[data-alert-toggle]')) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const price = Number(priceText.replace(/,/g, ''))
  const valid = Number.isFinite(price) && price > 0 && current !== undefined
  const dir = valid ? directionFor(price, current!) : null
  const diff = valid ? ((price - current!) / current!) * 100 : 0

  const submit = () => {
    if (!valid) return
    p.onAdd(price, note)
    setNote('')
  }

  const enableNotifications = async () => setPerm(await requestNotificationPermission())

  return (
    <div className="alert-panel" ref={ref} role="dialog" aria-label="가격 알림">
      <div className="ap-head">
        <b>가격 알림</b>
        <button className="ap-x" aria-label="닫기" onClick={p.onClose}>
          ✕
        </button>
      </div>

      <section className="ap-new">
        <div className="ap-sym">
          {p.marketName} <small>{pairLabel(p.market)}</small>
          <span className="ap-cur">현재가 {current !== undefined ? formatPrice(current, p.market) : '-'}</span>
        </div>
        <label className="ap-field">
          <span>목표가 ({quoteOf(p.market) === 'KRW' ? '원' : quoteOf(p.market)})</span>
          <input
            inputMode="decimal"
            value={priceText}
            onChange={(e) => setPriceText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            aria-label="목표가"
          />
        </label>
        <div className="ap-quick">
          {QUICK.map((q) => (
            <button
              key={q}
              className="tb-btn"
              disabled={current === undefined}
              onClick={() => setPriceText(String(+(current! * (1 + q / 100)).toFixed(priceDecimals(p.market, current!))))}
            >
              {q > 0 ? '+' : ''}
              {q}%
            </button>
          ))}
        </div>
        <input
          className="ap-note"
          placeholder="메모 (선택)"
          value={note}
          maxLength={60}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <div className="ap-preview">
          {dir === 'above' && (
            <span className="up">▲ {formatPrice(price, p.market)}{priceUnit(p.market)} 이상으로 오르면 알림 ({diff >= 0 ? '+' : ''}{diff.toFixed(2)}%)</span>
          )}
          {dir === 'below' && (
            <span className="down">▼ {formatPrice(price, p.market)}{priceUnit(p.market)} 이하로 내리면 알림 ({diff.toFixed(2)}%)</span>
          )}
          {!dir && <span>목표가를 입력하세요</span>}
        </div>
        <button className="ap-add" disabled={!valid} onClick={submit}>
          알림 추가
        </button>
        {perm === 'default' && (
          <button className="ap-perm" onClick={enableNotifications}>
            🔔 브라우저 알림 켜기 (탭이 백그라운드여도 알림)
          </button>
        )}
        {perm === 'denied' && <p className="ap-hint">브라우저 알림이 차단되어 있어 화면 안 알림과 소리로만 알려드립니다.</p>}
      </section>

      <section>
        <h4>
          대기 중 <span className="ap-count">{p.active.length}</span>
        </h4>
        {!p.active.length && <p className="ap-empty">설정된 알림이 없습니다</p>}
        <ul className="ap-list">
          {p.active.map((a) => {
            const t = p.tickers[a.market]
            const gap = t ? ((a.price - t.trade_price) / t.trade_price) * 100 : null
            return (
              <li key={a.id} onClick={() => p.onOpenMarket(a.market)} title="이 종목 차트 보기">
                <span className={a.direction === 'above' ? 'up' : 'down'}>{a.direction === 'above' ? '▲' : '▼'}</span>
                <div className="ap-item">
                  <b>{p.nameOf(a.market)}</b> {formatPrice(a.price, a.market)}
                  {a.note && <small>{a.note}</small>}
                </div>
                <span className="ap-gap">{gap === null ? '' : `${gap >= 0 ? '+' : ''}${gap.toFixed(2)}%`}</span>
                <button
                  className="ap-x"
                  aria-label="알림 삭제"
                  onClick={(e) => {
                    e.stopPropagation()
                    p.onRemove(a.id)
                  }}
                >
                  ✕
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      {p.history.length > 0 && (
        <section>
          <h4>
            발생 기록
            <button className="ap-clear" onClick={p.onClearHistory}>
              지우기
            </button>
          </h4>
          <ul className="ap-list ap-history">
            {p.history.map((a) => (
              <li key={a.id} onClick={() => p.onOpenMarket(a.market)}>
                <span className={a.direction === 'above' ? 'up' : 'down'}>{a.direction === 'above' ? '▲' : '▼'}</span>
                <div className="ap-item">
                  <b>{p.nameOf(a.market)}</b> {formatPrice(a.price, a.market)}
                  <small>
                    {timeText(a.triggeredAt!)} · {formatPrice(a.triggeredPrice!, a.market)}{priceUnit(a.market)} 도달
                  </small>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
