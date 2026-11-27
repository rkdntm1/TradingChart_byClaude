// Shared networking helpers for data sources.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * GET JSON with retries on 429 / 5xx / network errors (exponential backoff,
 * honoring Retry-After). Some exchanges return HTTP 200 with an `{ error }`
 * body; that is treated as a non-retriable failure.
 */
export async function getJson<T>(url: string, attempts = 5): Promise<T> {
  for (let i = 0; ; i++) {
    let res: Response | null = null
    try {
      res = await fetch(url)
    } catch (err) {
      if (i >= attempts - 1) throw err // network error, out of retries
    }
    if (res?.ok) {
      const body = await res.json()
      if (body && !Array.isArray(body) && body.error) {
        throw new Error(`API error: ${body.error.message ?? JSON.stringify(body.error)}`)
      }
      return body as T
    }
    const retriable = !res || res.status === 429 || res.status >= 500
    if (!retriable || i >= attempts - 1) throw new Error(`API ${res?.status ?? 'network'}: ${url}`)
    const retryAfter = Number(res?.headers.get('Retry-After'))
    await sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** i + Math.random() * 300)
  }
}

/**
 * Auto-reconnecting WebSocket. `onOpen` may send a subscription message;
 * every text/binary frame is JSON-parsed and handed to `onMessage`.
 * Reconnects with exponential backoff (1s → 30s, reset once connected).
 * Returns a function that closes it for good.
 */
export function openSocket(url: string, onOpen: (ws: WebSocket) => void, onMessage: (msg: unknown) => void): () => void {
  let ws: WebSocket | null = null
  let closed = false
  let retry: ReturnType<typeof setTimeout> | undefined
  let delay = 1000

  const connect = () => {
    ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => {
      delay = 1000
      onOpen(ws!)
    }
    ws.onmessage = (ev) => {
      const text = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer)
      try {
        onMessage(JSON.parse(text))
      } catch {
        /* ignore malformed frames */
      }
    }
    ws.onclose = () => {
      if (closed) return
      retry = setTimeout(connect, delay + Math.random() * 500)
      delay = Math.min(delay * 2, 30000)
    }
  }
  connect()

  return () => {
    closed = true
    clearTimeout(retry)
    ws?.close()
  }
}
