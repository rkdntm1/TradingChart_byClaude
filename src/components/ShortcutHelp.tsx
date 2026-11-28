import { useEffect, useRef } from 'react'
import { SHORTCUT_GROUPS } from '../lib/shortcuts'

/** Modal listing every keyboard shortcut. Closes on Esc, "?", the ✕ button or a backdrop click. */
export default function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="sc-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sc-modal" ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="키보드 단축키">
        <div className="ap-head">
          <b>키보드 단축키</b>
          <button className="ap-x" aria-label="닫기" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="sc-body">
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.title}>
              <h4>{g.title}</h4>
              <table>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.label}>
                      <td className="sc-keys">
                        {r.keys.map((k, i) =>
                          k === '…' ? (
                            <span key={i} className="sc-dots">
                              …
                            </span>
                          ) : (
                            <kbd key={i}>{k}</kbd>
                          ),
                        )}
                      </td>
                      <td>{r.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
        <p className="sc-foot">입력칸에 글자를 입력하는 동안에는 단축키가 동작하지 않습니다.</p>
      </div>
    </div>
  )
}
