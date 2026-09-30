/**
 * Same-origin JSON routes for the stock ticker.
 *
 * The browser half polls these instead of talking to the quote provider
 * directly: a page cannot set the `Referer` the provider requires, and keeping
 * every outbound request on the host side means one cache serves every open
 * tab. Routes are still guarded — the carrier binds to loopback by default, but
 * a deployment may widen that, so each request carries the settings document's
 * own same-origin check plus a shape check on every argument.
 *
 * @module dsh-stock-ticker/routes
 */

import { fetchQuote, fetchTrends, inCooldown, searchInstruments } from './provider.js'
import { HOST_BUILD, MAX_WATCHLIST, PatchError, validatePatch } from './settings.js'

/** Route prefix owned by this plugin. */
const PREFIX = '/api/stock-ticker'

/** Quote cache lifetime while the exchanges are open. */
const LIVE_TTL_MS = 8_000

/** Quote cache lifetime outside trading hours, when the numbers stopped moving. */
const IDLE_TTL_MS = 120_000

/** Intraday series cache lifetime; the series only grows while trading. */
const TREND_TTL_MS = 30_000

/** Search results are stable enough to cache for a while. */
const SEARCH_TTL_MS = 300_000

/** Bytes of request body this plugin will read before refusing. */
const MAX_BODY_BYTES = 4_096

/**
 * Upstream reads allowed to be in flight at once.
 *
 * A watchlist refresh asks for one symbol per entry; issuing them all at once is
 * what makes the provider start closing sockets. Reading a few at a time costs a
 * little latency on a wide watchlist and keeps the request rate inside what the
 * provider tolerates.
 */
const MAX_UPSTREAM_CONCURRENCY = 3

/**
 * Run one async mapper over a list with bounded concurrency, preserving order.
 *
 * @param items - inputs to map.
 * @param limit - maximum simultaneous invocations.
 * @param map - async mapper.
 * @returns the mapped results in input order.
 */
async function mapLimited(items, limit, map) {
  const results = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await map(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * A tiny promise-deduplicating TTL cache.
 *
 * Concurrent misses share one in-flight promise, so a room full of tabs opening
 * at once produces a single upstream request per key rather than one each.
 */
class TtlCache {
  #entries = new Map()

  /**
   * Read through the cache.
   *
   * @param key - cache key.
   * @param ttlMs - freshness window in milliseconds.
   * @param load - producer invoked on a miss.
   * @returns the cached or freshly produced value.
   */
  async remember(key, ttlMs, load) {
    const hit = this.#entries.get(key)
    if (hit !== undefined && hit.expiresAt > Date.now()) return await hit.promise
    const promise = load()
    this.#entries.set(key, { expiresAt: Date.now() + ttlMs, promise })
    try {
      return await promise
    } catch (error) {
      // Never cache a failure: the next poll should retry immediately rather
      // than be told the market is broken for the whole TTL window.
      if (this.#entries.get(key)?.promise === promise) this.#entries.delete(key)
      throw error
    }
  }

  /** Drop every entry; called on plugin teardown. */
  clear() {
    this.#entries.clear()
  }
}

/**
 * Whether the Chinese A-share session is open right now.
 *
 * Deliberately approximate: it drives a cache TTL, not a promise to the user, so
 * exchange holidays only cost a few extra upstream requests.
 *
 * @param now - current epoch milliseconds.
 * @returns whether quotes are plausibly still moving.
 */
function isTradingNow(now) {
  // Beijing is UTC+8 with no daylight saving, so a fixed offset is exact.
  const beijing = new Date(now + 8 * 3_600_000)
  const day = beijing.getUTCDay()
  if (day === 0 || day === 6) return false
  const minutes = beijing.getUTCHours() * 60 + beijing.getUTCMinutes()
  return (minutes >= 9 * 60 + 15 && minutes <= 11 * 60 + 30)
    || (minutes >= 12 * 60 + 55 && minutes <= 15 * 60 + 5)
}

/**
 * Read and parse a JSON request body.
 *
 * @param req - incoming request.
 * @returns the parsed body, or an empty object for an empty body.
 * @throws {Error} when the body is oversized or not JSON.
 */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Write one JSON response.
 *
 * @param res - response to own.
 * @param status - HTTP status code.
 * @param payload - JSON-serializable body.
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    // Quotes are live data; an intermediate cache would only lie about them.
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * Accept only well-formed plugin symbol keys (`sh600519`).
 *
 * @param value - candidate key.
 * @returns whether it is a symbol key this plugin will forward upstream.
 */
function isSecid(value) {
  return typeof value === 'string' && /^(sh|sz|bj)\d{6}$/.test(value)
}

/**
 * Register the routes when a browser carrier is present.
 *
 * @param ctx - Host cordis context that owns the watchlist.
 * @param store - the durable store contract (`get()` / `update(patch)`).
 */
export function registerRoutes(ctx, store) {
  ctx.inject(['webServer'], webCtx => {
    const cache = new TtlCache()

    /** Resolve the live section, so every route reads one normalized shape. */
    const config = () => store.get()

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: PREFIX,
      handler: async (req, res) => {
        try {
          await handle(req, res, config, cache, store)
        } catch (error) {
          // One failure must not take the carrier down with it: the handler
          // owns its whole response lifecycle, so report and end here. A
          // refused patch is the caller's fault (400); anything else is an
          // upstream or transport failure (502).
          if (!res.headersSent) {
            const status = error instanceof PatchError ? 400 : 502
            sendJson(res, status, { error: error instanceof Error ? error.message : String(error) })
          } else {
            res.end()
          }
        }
      },
    }), 'stock-ticker: quote routes')

    webCtx.effect(() => () => cache.clear(), 'stock-ticker: quote cache')
  })
}

/**
 * Dispatch one request under {@link PREFIX}.
 *
 * @param req - incoming request.
 * @param res - response to own.
 * @param config - live normalized settings reader.
 * @param cache - plugin-scoped response cache.
 * @param store - durable watchlist store.
 */
async function handle(req, res, config, cache, store) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const route = url.pathname.slice(PREFIX.length).replace(/\/+$/, '')
  const signal = AbortSignal.timeout(15_000)

  // Configuration travels over this plugin's own routes rather than the
  // settings RPC: the Host's Web settings surface is an allowlist of in-box
  // namespaces, so an out-of-tree namespace answers `settings-not-exposed`.
  // Persistence is still the settings provider's document and atomic writer.
  if (route === '/config' && req.method === 'GET') {
    // `build` rides every config answer so a settings page can show which host
    // build produced it.
    sendJson(res, 200, { config: config(), build: HOST_BUILD })
    return
  }

  if (route === '/config' && (req.method === 'PATCH' || req.method === 'POST')) {
    const patch = validatePatch(await readJsonBody(req))
    // `update` merges, so a tab that only moved one instrument cannot drop a
    // watchlist edit made elsewhere in the meantime.
    await store.update(patch)
    sendJson(res, 200, { config: config() })
    return
  }

  if (route === '/quotes' && req.method === 'POST') {
    const body = await readJsonBody(req)
    // Default to the user's own watchlist when the caller sends no list, which
    // is what the mini-window's steady-state poll does.
    const requested = Array.isArray(body.secids)
      ? body.secids
      : config().watchlist.map(item => `${item.market}${item.code}`)
    const secids = [...new Set(requested.filter(isSecid))].slice(0, MAX_WATCHLIST)
    const live = isTradingNow(Date.now())
    const quotes = await mapLimited(secids, MAX_UPSTREAM_CONCURRENCY, async secid => {
      try {
        return await cache.remember(`quote:${secid}`, live ? LIVE_TTL_MS : IDLE_TTL_MS,
          () => fetchQuote(secid, signal))
      } catch {
        // One unreachable symbol must not blank the whole board.
        return undefined
      }
    })
    sendJson(res, 200, {
      asOf: Date.now(),
      trading: live,
      // Told plainly that the feed is throttling, so the caller can back off
      // instead of retrying into the same wall.
      throttled: inCooldown(),
      quotes: quotes.filter(quote => quote !== undefined),
    })
    return
  }

  if (route === '/trends' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const secid = typeof body.secid === 'string' ? body.secid : ''
    if (!isSecid(secid)) {
      sendJson(res, 400, { error: 'secid must look like sh600519' })
      return
    }
    const ndays = Number.isInteger(body.ndays) ? Math.min(Math.max(body.ndays, 1), 5) : 1
    const series = await cache.remember(`trend:${secid}:${String(ndays)}`, TREND_TTL_MS,
      () => fetchTrends(secid, ndays, signal))
    if (series === undefined) {
      sendJson(res, 404, { error: `no intraday data for ${secid}` })
      return
    }
    sendJson(res, 200, series)
    return
  }

  if (route === '/search' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const query = typeof body.query === 'string' ? body.query.trim() : ''
    if (query === '' || query.length > 32) {
      sendJson(res, 400, { error: 'query must be a non-empty string of at most 32 characters' })
      return
    }
    const results = await cache.remember(`search:${query}`, SEARCH_TTL_MS,
      () => searchInstruments(query, signal))
    sendJson(res, 200, { results })
    return
  }

  sendJson(res, 404, { error: `unknown stock-ticker route "${route}"` })
}
