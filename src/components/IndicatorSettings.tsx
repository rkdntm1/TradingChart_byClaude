import { useEffect, useRef, useState } from 'react'
import { DEFAULT_PARAMS, normalizeParams, type IndicatorParams } from '../lib/chartIndicators'

interface Props {
  params: IndicatorParams
  onApply: (p: IndicatorParams) => void
  onClose: () => void
}

const MA_COLORS = ['#f5b301', '#d64fd9', '#26a69a', '#ff7a45']

/** Form values are kept as strings while typing; numbers are validated on apply. */
type Draft = {
  maType: 'sma' | 'ema'
  ma: string[]
  bbLength: string
  bbMult: string
  rsiLength: string
  rsiOver: string
  rsiUnder: string
  macdFast: string
  macdSlow: string
  macdSignal: string
}

const toDraft = (p: IndicatorParams): Draft => ({
  maType: p.ma.type,
  ma: p.ma.periods.map(String),
  bbLength: String(p.bb.length),
  bbMult: String(p.bb.mult),
  rsiLength: String(p.rsi.length),
  rsiOver: String(p.rsi.overbought),
  rsiUnder: String(p.rsi.oversold),
  macdFast: String(p.macd.fast),
  macdSlow: String(p.macd.slow),
  macdSignal: String(p.macd.signal),
})

const fromDraft = (d: Draft): IndicatorParams =>
  normalizeParams({
    ma: { type: d.maType, periods: d.ma.map((v) => (v.trim() === '' ? 0 : Number(v))) },
    bb: { length: Number(d.bbLength), mult: Number(d.bbMult) },
    rsi: { length: Number(d.rsiLength), overbought: Number(d.rsiOver), oversold: Number(d.rsiUnder) },
    macd: { fast: Number(d.macdFast), slow: Number(d.macdSlow), signal: Number(d.macdSignal) },
  })

export default function IndicatorSettings({ params, onApply, onClose }: Props) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(params))
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click / Esc.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      if (ref.current && !ref.current.contains(t) && !t.closest('[data-settings-toggle]')) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const apply = () => {
    const next = fromDraft(draft)
    onApply(next)
    setDraft(toDraft(next)) // show the clamped values that were actually applied
  }
  const reset = () => {
    onApply(DEFAULT_PARAMS)
    setDraft(toDraft(DEFAULT_PARAMS))
  }

  const num = (value: string, onChange: (v: string) => void, label: string, step = 1) => (
    <input
      className="is-num"
      type="number"
      inputMode="decimal"
      step={step}
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && apply()}
    />
  )

  return (
    <div className="ind-settings" ref={ref} role="dialog" aria-label="지표 설정">
      <div className="ap-head">
        <b>지표 설정</b>
        <button className="ap-x" aria-label="닫기" onClick={onClose}>
          ✕
        </button>
      </div>

      <section>
        <h4>이동평균</h4>
        <div className="is-row">
          <span>종류</span>
          <div className="is-seg">
            {(['sma', 'ema'] as const).map((t) => (
              <button key={t} className={`tb-btn ${draft.maType === t ? 'on' : ''}`} onClick={() => set({ maType: t })}>
                {t === 'sma' ? '단순(SMA)' : '지수(EMA)'}
              </button>
            ))}
          </div>
        </div>
        <div className="is-row">
          <span>기간</span>
          <div className="is-ma">
            {draft.ma.map((v, i) => (
              <label key={i} className="is-ma-item">
                <i style={{ background: MA_COLORS[i] }} />
                {num(v, (nv) => set({ ma: draft.ma.map((x, k) => (k === i ? nv : x)) }), `이동평균 ${i + 1} 기간`)}
              </label>
            ))}
          </div>
        </div>
        <p className="is-hint">0이나 빈칸은 그 선을 숨깁니다.</p>
      </section>

      <section>
        <h4>볼린저밴드</h4>
        <div className="is-row">
          <span>기간</span>
          {num(draft.bbLength, (v) => set({ bbLength: v }), '볼린저밴드 기간')}
          <span>배수</span>
          {num(draft.bbMult, (v) => set({ bbMult: v }), '볼린저밴드 표준편차 배수', 0.1)}
        </div>
      </section>

      <section>
        <h4>RSI</h4>
        <div className="is-row">
          <span>기간</span>
          {num(draft.rsiLength, (v) => set({ rsiLength: v }), 'RSI 기간')}
          <span>과매수</span>
          {num(draft.rsiOver, (v) => set({ rsiOver: v }), 'RSI 과매수 기준')}
          <span>과매도</span>
          {num(draft.rsiUnder, (v) => set({ rsiUnder: v }), 'RSI 과매도 기준')}
        </div>
      </section>

      <section>
        <h4>MACD</h4>
        <div className="is-row">
          <span>단기</span>
          {num(draft.macdFast, (v) => set({ macdFast: v }), 'MACD 단기 기간')}
          <span>장기</span>
          {num(draft.macdSlow, (v) => set({ macdSlow: v }), 'MACD 장기 기간')}
          <span>시그널</span>
          {num(draft.macdSignal, (v) => set({ macdSignal: v }), 'MACD 시그널 기간')}
        </div>
      </section>

      <div className="is-actions">
        <button className="tb-btn" onClick={reset}>
          기본값
        </button>
        <button className="ap-add" onClick={apply}>
          적용
        </button>
      </div>
    </div>
  )
}
