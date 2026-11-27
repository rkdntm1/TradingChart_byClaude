// Price alerts: model, persistence and notification delivery.

export type AlertDirection = 'above' | 'below'

export interface PriceAlert {
  id: string
  market: string // e.g. KRW-BTC
  price: number
  /** 'above' fires when price rises to/through `price`, 'below' when it falls to/through it. */
  direction: AlertDirection
  note?: string
  createdAt: number // ms
  triggeredAt?: number // ms, set once fired
  triggeredPrice?: number
}

const KEY = 'chartview:alerts'
const MAX_HISTORY = 30

export function loadAlerts(): PriceAlert[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

export function saveAlerts(alerts: PriceAlert[]) {
  try {
    // Keep every active alert, but only the most recent triggered ones.
    const active = alerts.filter((a) => !a.triggeredAt)
    const history = alerts
      .filter((a) => a.triggeredAt)
      .sort((a, b) => b.triggeredAt! - a.triggeredAt!)
      .slice(0, MAX_HISTORY)
    localStorage.setItem(KEY, JSON.stringify([...active, ...history]))
  } catch {
    /* storage unavailable */
  }
}

/** The direction is implied by where the target sits relative to the current price. */
export const directionFor = (target: number, current: number): AlertDirection =>
  target >= current ? 'above' : 'below'

export const isHit = (a: PriceAlert, price: number) =>
  a.direction === 'above' ? price >= a.price : price <= a.price

// ---- delivery ----

export type NotifyPermission = NotificationPermission | 'unsupported'

export function notificationPermission(): NotifyPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

export async function requestNotificationPermission(): Promise<NotifyPermission> {
  if (typeof Notification === 'undefined') return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

/** Show an OS-level notification if the user allowed it. Returns whether it was shown. */
export function showSystemNotification(title: string, body: string, onClick?: () => void): boolean {
  if (notificationPermission() !== 'granted') return false
  try {
    const icon = new URL(`${import.meta.env.BASE_URL}favicon.svg`, window.location.href).href
    const n = new Notification(title, { body, tag: title, icon })
    n.onclick = () => {
      window.focus()
      onClick?.()
      n.close()
    }
    return true
  } catch {
    return false
  }
}

let audio: AudioContext | null = null

/** Create/resume the audio context. Must be called from a user gesture once. */
export function unlockSound() {
  try {
    audio ??= new AudioContext()
    if (audio.state === 'suspended') void audio.resume()
  } catch {
    audio = null
  }
}

/** Short two-tone chime. Silently does nothing if audio is unavailable. */
export function playChime() {
  if (!audio || audio.state !== 'running') return
  const now = audio.currentTime
  ;[880, 1318.5].forEach((freq, i) => {
    const osc = audio!.createOscillator()
    const gain = audio!.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    const t = now + i * 0.16
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
    osc.connect(gain).connect(audio!.destination)
    osc.start(t)
    osc.stop(t + 0.4)
  })
}
