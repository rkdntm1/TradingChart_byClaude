import type { ReactNode } from 'react'
import type { ToolId } from '../lib/drawings'

const icon = (children: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)

const TOOLS: { id: ToolId; label: string; icon: ReactNode }[] = [
  {
    id: 'cursor',
    label: '선택 (Esc)',
    icon: icon(<path d="M4 2.5l9.5 6.2-4.3 1 2.4 4.6-1.7.9-2.4-4.6-3.5 2.9z" />),
  },
  {
    id: 'trend',
    label: '추세선',
    icon: icon(
      <>
        <path d="M3.5 14.5l11-11" />
        <circle cx="3.5" cy="14.5" r="1.6" fill="currentColor" />
        <circle cx="14.5" cy="3.5" r="1.6" fill="currentColor" />
      </>,
    ),
  },
  {
    id: 'ray',
    label: '연장선',
    icon: icon(
      <>
        <path d="M3.5 14.5l13-13" />
        <circle cx="3.5" cy="14.5" r="1.6" fill="currentColor" />
        <circle cx="9" cy="9" r="1.6" fill="currentColor" />
      </>,
    ),
  },
  {
    id: 'hline',
    label: '수평선',
    icon: icon(
      <>
        <path d="M1.5 9h15" />
        <circle cx="9" cy="9" r="1.6" fill="currentColor" />
      </>,
    ),
  },
  {
    id: 'fib',
    label: '피보나치 되돌림',
    icon: icon(
      <>
        <path d="M2 3.5h14M2 7h14M2 10h14M2 14.5h14" />
        <path d="M2 14.5L16 3.5" strokeDasharray="2 2" />
      </>,
    ),
  },
  {
    id: 'rect',
    label: '사각형',
    icon: icon(<rect x="3" y="4.5" width="12" height="9" rx="1" />),
  },
  {
    id: 'text',
    label: '텍스트 메모',
    icon: icon(
      <>
        <path d="M4 4.5h10M9 4.5v10M7 14.5h4" />
      </>,
    ),
  },
  {
    id: 'measure',
    label: '측정 (가격·%·봉 수·기간)',
    icon: icon(
      <>
        <rect x="2.5" y="5.5" width="13" height="7" rx="1" />
        <path d="M5.5 5.5v2.5M8.5 5.5v3.5M11.5 5.5v2.5" />
      </>,
    ),
  },
  {
    id: 'alert',
    label: '가격 알림 추가 (차트에서 가격 클릭)',
    icon: icon(
      <>
        <path d="M4.5 7a4.5 4.5 0 0 1 9 0c0 5 2 6.5 2 6.5h-13s2-1.5 2-6.5" />
        <path d="M7.7 15.5a1.5 1.5 0 0 0 2.6 0" />
      </>,
    ),
  },
]

interface Props {
  tool: ToolId
  onTool: (t: ToolId) => void
  canDelete: boolean
  onDelete: () => void
  canClear: boolean
  onClear: () => void
  magnet: boolean
  onToggleMagnet: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}

export default function DrawingToolbar({
  tool,
  onTool,
  canDelete,
  onDelete,
  canClear,
  onClear,
  magnet,
  onToggleMagnet,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: Props) {
  return (
    <div className="draw-bar">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`draw-btn ${tool === t.id ? 'on' : ''}`}
          title={t.label}
          aria-label={t.label}
          onClick={() => onTool(t.id)}
        >
          {t.icon}
        </button>
      ))}
      <span className="draw-sep" />
      <button
        className={`draw-btn ${magnet ? 'on' : ''}`}
        title={magnet ? '자석 켜짐: 시가·고가·저가·종가에 붙음' : '자석 꺼짐'}
        aria-label="자석 모드"
        aria-pressed={magnet}
        onClick={onToggleMagnet}
      >
        {icon(
          <>
            <path d="M4 3.5v6a5 5 0 0 0 10 0v-6" />
            <path d="M4 6.5h3M11 6.5h3M7 3.5v6a2 2 0 0 0 4 0v-6" />
          </>,
        )}
      </button>
      <button className="draw-btn" title="실행취소 (Ctrl+Z)" aria-label="실행취소" disabled={!canUndo} onClick={onUndo}>
        {icon(<path d="M6.5 5.5 3.5 8.5l3 3M3.5 8.5h7a4 4 0 0 1 0 8h-2" />)}
      </button>
      <button className="draw-btn" title="다시실행 (Ctrl+Y)" aria-label="다시실행" disabled={!canRedo} onClick={onRedo}>
        {icon(<path d="M11.5 5.5l3 3-3 3M14.5 8.5h-7a4 4 0 0 0 0 8h2" />)}
      </button>
      <button className="draw-btn" title="선택한 드로잉 삭제 (Delete)" aria-label="선택한 드로잉 삭제" disabled={!canDelete} onClick={onDelete}>
        {icon(<path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />)}
      </button>
      <button className="draw-btn" title="모든 드로잉 삭제" aria-label="모든 드로잉 삭제" disabled={!canClear} onClick={onClear}>
        {icon(
          <>
            <path d="M3 5h12M7 5V3.5h4V5M5 5l.8 10h6.4L13 5" />
            <path d="M7.5 8v4.5M10.5 8v4.5" />
          </>,
        )}
      </button>
    </div>
  )
}
