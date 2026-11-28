// Keyboard shortcuts: one table used by the key handlers and the help overlay.
import type { ToolId } from './drawings'
import { INTERVALS } from './market'

/** Letter → drawing tool (no modifier keys). */
export const TOOL_KEYS: Record<string, ToolId> = {
  v: 'cursor',
  t: 'trend',
  r: 'ray',
  h: 'hline',
  f: 'fib',
  b: 'rect',
  n: 'text',
  m: 'measure',
  a: 'alert',
}

/** Key for a tool, for tooltips ("추세선 (T)"). */
export const toolKey = (tool: ToolId) =>
  Object.entries(TOOL_KEYS)
    .find(([, t]) => t === tool)?.[0]
    ?.toUpperCase()

/** Number keys 1–9 pick the intervals in toolbar order. */
export const intervalKey = (index: number) => (index < 9 ? String(index + 1) : undefined)

/** True when the key event comes from a text field (shortcuts must not fire while typing). */
export function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

/** Plain key press: no Ctrl / Cmd / Alt (Shift is allowed, e.g. for "?"). */
export const isPlainKey = (e: KeyboardEvent) => !e.ctrlKey && !e.metaKey && !e.altKey

export interface ShortcutRow {
  keys: string[]
  label: string
}

export const SHORTCUT_GROUPS: { title: string; rows: ShortcutRow[] }[] = [
  {
    title: '차트',
    rows: [
      { keys: ['1', '…', '9'], label: `시간봉 (${INTERVALS.slice(0, 9).map((iv) => iv.label).join(' · ')})` },
      { keys: ['L'], label: '로그 스케일 켜기/끄기' },
      { keys: ['G'], label: '자석 모드 켜기/끄기' },
    ],
  },
  {
    title: '드로잉',
    rows: [
      { keys: ['V'], label: '선택' },
      { keys: ['T'], label: '추세선' },
      { keys: ['R'], label: '연장선' },
      { keys: ['H'], label: '수평선' },
      { keys: ['F'], label: '피보나치 되돌림' },
      { keys: ['B'], label: '사각형' },
      { keys: ['N'], label: '텍스트 메모' },
      { keys: ['M'], label: '측정' },
      { keys: ['A'], label: '가격 알림' },
      { keys: ['Ctrl', 'Z'], label: '실행취소' },
      { keys: ['Ctrl', 'Y'], label: '다시실행' },
      { keys: ['Delete'], label: '선택한 드로잉 삭제' },
      { keys: ['Esc'], label: '그리기 취소 · 선택 해제 · 패널 닫기' },
    ],
  },
  {
    title: '종목',
    rows: [
      { keys: ['/'], label: '종목 검색' },
      { keys: ['↑', '↓'], label: '목록에서 이전 / 다음 종목' },
      { keys: ['Enter'], label: '검색 중: 첫 번째 결과 열기' },
    ],
  },
  {
    title: '도움말',
    rows: [{ keys: ['?'], label: '단축키 목록 열기/닫기' }],
  },
]
