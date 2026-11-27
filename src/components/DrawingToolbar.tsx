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
]

interface Props {
  tool: ToolId
  onTool: (t: ToolId) => void
  canDelete: boolean
  onDelete: () => void
  canClear: boolean
  onClear: () => void
}

export default function DrawingToolbar({ tool, onTool, canDelete, onDelete, canClear, onClear }: Props) {
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
