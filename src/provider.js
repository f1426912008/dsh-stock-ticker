/**
 * Upstream quote provider for the stock ticker.
 *
 * The wire format is the East Money push2 endpoint family: one host serves a
 * flat `data` object keyed by `f<n>` field ids, every numeric price arrives as
 * a scaled integer with the scale given separately as `decimal`, and missing
 * values arrive as `"-"`. This module is the only place that knows those
 * details — routes.js deals in the normalized shapes above it.
 *
 * Every request carries a `Referer` header: the provider rejects requests
 * without one from a non-browser client, and an honest same-site referer is the
 * cheapest way to keep that contract.
 *
 * @module dsh-stock-ticker/provider
 */

/** Per-request upstream timeout; a hung provider must not pin a browser tab. */
const REQUEST_TIMEOUT_MS = 8_000

/**
 * Transport attempts per upstream read.
 *
 * Deliberately two, not more: this provider answers a client it considers too
 * eager by closing the socket, and the host already caches every answer. Piling
 * retries onto a provider that is refusing traffic is what turns a brief
 * slowdown into a sustained block.
 */
const ATTEMPTS = 2

/** Pause before the single retry. */
const RETRY_BACKOFF_MS = 400

/**
 * Consecutive transport failures across all reads before this plugin stops
 * asking. The provider throttles by dropping connections, so the only correct
 * response to a run of them is to go quiet for a while.
 */
const FAILURES_BEFORE_COOLDOWN = 4

/** How long to stay quiet once that threshold is reached. */
const COOLDOWN_MS = 45_000

/** Consecutive failures observed since the last successful read. */
let consecutiveFailures = 0

/** Epoch milliseconds until which reads answer from the cooldown instead of the network. */
let cooldownUntil = 0

/** Thrown while the cooldown is active, so routes can report a distinct reason. */
export class ProviderCooldownError extends Error {
  /**
   * @param until - epoch milliseconds when reads resume.
   */
  constructor(until) {
    const seconds = Math.max(1, Math.ceil((until - Date.now()) / 1000))
    super(`行情源暂时不可用（限流退避中，约 ${String(seconds)} 秒后重试）`)
    this.name = 'ProviderCooldownError'
    this.until = until
  }
}

/** @returns whether reads are currently suppressed. */
export function inCooldown() {
  return Date.now() < cooldownUntil
}

/** Longest accepted range payload; a full session is 241 one-minute points. */
const MAX_TREND_POINTS = 300

/** Identifies this plugin to the upstream provider without leaking anything user-scoped. */
const HEADERS = {
  Referer: 'https://quote.eastmoney.com/',
  'User-Agent': 'Mozilla/5.0 (compatible; dsh-stock-ticker/0.1)',
  Accept: 'application/json,text/plain,*/*',
}

/**
 * One upstream JSON GET, retried on a transport failure.
 *
 * The provider intermittently closes a connection mid-handshake, so a single
 * attempt is not reliable enough to drive a once-a-second poll. Retries are
 * bounded and only cover transport noise: an outright non-2xx answer is final,
 * and so is a caller-initiated abort. The TTL cache means a retry never
 * doubles the steady-state request rate.
 *
 * @param url - absolute request URL.
 * @param signal - caller's cancellation signal (route teardown or client abort).
 * @returns the parsed response body.
 * @throws {Error} when every attempt fails, the status is not 2xx, or the body is not JSON.
 */
async function getJson(url, signal) {
  if (inCooldown()) throw new ProviderCooldownError(cooldownUntil)
  let lastError
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await new Promise(resolve => { setTimeout(resolve, RETRY_BACKOFF_MS) })
    }
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    const composed = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    try {
      const response = await fetch(url, { headers: HEADERS, signal: composed })
      if (!response.ok) {
        // An outright rejection is the provider's answer, not noise.
        throw new Error(`upstream ${String(response.status)} ${response.statusText}`)
      }
      const body = await response.json()
      consecutiveFailures = 0
      return body
    } catch (error) {
      // A caller-initiated abort is final; only transport noise is retried.
      if (signal?.aborted === true) throw error
      lastError = error
    }
  }
  consecutiveFailures += 1
  if (consecutiveFailures >= FAILURES_BEFORE_COOLDOWN) {
    cooldownUntil = Date.now() + COOLDOWN_MS
    consecutiveFailures = 0
  }
  throw lastError
}

/**
 * Coerce one `f<n>` field into a number.
 *
 * @param value - raw field value, which is `"-"`, `null`, or a number.
 * @returns the number, or `undefined` when the provider has no value.
 */
function num(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value !== '' && value !== '-') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

/**
 * Apply the provider's scale factor to a scaled integer price field.
 *
 * @param value - raw scaled field value.
 * @param decimal - number of implied decimal places.
 * @returns the absolute price, or `undefined` when unavailable.
 */
function scaled(value, decimal) {
  const raw = num(value)
  if (raw === undefined) return undefined
  return raw / 10 ** decimal
}

/**
 * Format a share count the way a quote board does (手, i.e. lots of 100).
 *
 * @param lots - raw lot count from the provider.
 * @returns display text, or `undefined` when unavailable.
 */
function formatLots(lots) {
  if (lots === undefined) return undefined
  if (lots >= 1e8) return `${(lots / 1e8).toFixed(2)}亿手`
  if (lots >= 1e4) return `${(lots / 1e4).toFixed(2)}万手`
  return `${String(lots)}手`
}

/**
 * Format a CNY amount with the unit a market reader expects.
 *
 * @param amount - amount in CNY.
 * @returns display text, or `undefined` when unavailable.
 */
function formatCny(amount) {
  if (amount === undefined) return undefined
  if (amount >= 1e12) return `${(amount / 1e12).toFixed(2)}万亿`
  if (amount >= 1e8) return `${(amount / 1e8).toFixed(2)}亿`
  if (amount >= 1e4) return `${(amount / 1e4).toFixed(2)}万`
  return amount.toFixed(2)
}

/**
 * Normalize one upstream quote row.
 *
 * @param data - the response's `data` object.
 * @param market - exchange prefix the caller asked for; echoed rather than
 * inferred, because the provider's own market flag is 1 for Shanghai and 0 for
 * both Shenzhen and Beijing.
 * @returns the quote in the shape the browser half renders, or `undefined` when the symbol is unknown.
 */
function normalizeQuote(data, market) {
  const code = typeof data.f57 === 'string' ? data.f57 : undefined
  if (code === undefined) return undefined
  // f59 is the price scale; the provider reports every ratio and percentage
  // field at that same scale, so one value covers the whole row.
  const decimal = num(data.f59) ?? 2
  const price = scaled(data.f43, decimal)
  const previousClose = scaled(data.f60, decimal)
  const change = scaled(data.f169, decimal)
  const changePercent = scaled(data.f170, decimal)
  return {
    code,
    name: typeof data.f58 === 'string' ? data.f58 : code,
    market,
    price,
    previousClose,
    change,
    changePercent,
    open: scaled(data.f46, decimal),
    high: scaled(data.f44, decimal),
    low: scaled(data.f45, decimal),
    // f47 is lots (手), f48 is turnover in CNY.
    volumeText: formatLots(num(data.f47)),
    turnoverText: formatCny(num(data.f48)),
    turnoverRate: scaled(data.f168, decimal),
    amplitude: scaled(data.f171, decimal),
    // f116/f117 are total and float market capitalization in CNY.
    marketCapText: formatCny(num(data.f116)),
    floatCapText: formatCny(num(data.f117)),
    volumeRatio: scaled(data.f50, decimal),
    pe: scaled(data.f162, decimal),
    pb: scaled(data.f167, decimal),
    // f51/f52 are the limit-up and limit-down prices.
    limitUp: scaled(data.f51, decimal),
    limitDown: scaled(data.f52, decimal),
    updatedAt: Date.now(),
  }
}

/**
 * Read one quote.
 *
 * @param secid - provider market prefix, e.g. `sh600519`.
 * @param signal - caller's cancellation signal.
 * @returns the normalized quote, or `undefined` when the provider does not know the symbol.
 */
export async function fetchQuote(secid, signal) {
  const url = 'https://push2.eastmoney.com/api/qt/stock/get'
    + `?secid=${encodeURIComponent(toSecidParam(secid))}`
    + '&fields=f43,f44,f45,f46,f47,f48,f50,f51,f52,f57,f58,f59,f60,f107,f116,f117,f162,f167,f168,f169,f170,f171'
  const body = await getJson(url, signal)
  const data = body?.data
  if (data === null || typeof data !== 'object') return undefined
  return normalizeQuote(data, secid.slice(0, 2).toLowerCase())
}

/**
 * Read intraday minute points, optionally for several sessions.
 *
 * @param secid - provider market prefix, e.g. `sh600519`.
 * @param ndays - number of sessions to return, newest last.
 * @param signal - caller's cancellation signal.
 * @returns the normalized series, or `undefined` when the provider has no data.
 */
export async function fetchTrends(secid, ndays, signal) {
  const url = 'https://push2his.eastmoney.com/api/qt/stock/trends2/get'
    + `?secid=${encodeURIComponent(toSecidParam(secid))}`
    + '&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13'
    + '&fields2=f51,f52,f53,f54,f55,f56,f57,f58'
    + `&iscr=0&ndays=${String(ndays)}`
  const body = await getJson(url, signal)
  const data = body?.data
  if (data === null || typeof data !== 'object') return undefined
  const rows = Array.isArray(data.trends) ? data.trends : []
  const points = []
  for (const row of rows) {
    if (typeof row !== 'string') continue
    // "2026-09-30 09:31,<price>,<avg>,<open>,<close>,<volume>,<turnover>,<prevClose>"
    // fields2 is f51..f58 in that order, so the clock time is the second
    // whitespace-separated token of the first column.
    const parts = row.split(',')
    if (parts.length < 7) continue
    const price = Number(parts[1])
    const average = Number(parts[2])
    const volume = Number(parts[5])
    if (!Number.isFinite(price)) continue
    points.push({
      time: (parts[0] ?? '').split(' ')[1] ?? parts[0] ?? '',
      price,
      average: Number.isFinite(average) ? average : price,
      volume: Number.isFinite(volume) ? volume : 0,
    })
    if (points.length >= MAX_TREND_POINTS) break
  }
  if (points.length === 0) return { points: [], previousClose: undefined, name: data.name }
  return {
    points,
    previousClose: num(data.preClose),
    name: typeof data.name === 'string' ? data.name : undefined,
  }
}

/**
 * Resolve a user's query (code or name) into candidate instruments.
 *
 * @param query - a bare code, a prefixed code, or a Chinese/pinyin name fragment.
 * @param signal - caller's cancellation signal.
 * @returns up to eight candidates; empty when nothing matches.
 */
export async function searchInstruments(query, signal) {
  const url = 'https://searchapi.eastmoney.com/api/suggest/get'
    + `?input=${encodeURIComponent(query)}`
    + '&type=14&count=8&token=D43BF722C8E33BDC906FB84D85E326E8'
  const body = await getJson(url, signal)
  const rows = body?.QuotationCodeTable?.Data
  if (!Array.isArray(rows)) return []
  return rows
    .filter(row => row !== null && typeof row === 'object' && typeof row.Code === 'string')
    .map(row => {
      // QuoteID is the provider's own `<market>.<code>` key; its market nibble
      // is 1 for Shanghai and 0 for both Shenzhen and Beijing, which is the
      // same convention `toSecidParam` uses in the other direction.
      const market = String(row.QuoteID ?? '').split('.')[0] === '1' ? 'sh' : 'sz'
      return {
        code: row.Code,
        name: typeof row.Name === 'string' ? row.Name : row.Code,
        market,
        type: typeof row.SecurityTypeName === 'string' ? row.SecurityTypeName : '',
      }
    })
}

/**
 * Convert the plugin's own `sh600519` key into the provider's `1.600519`.
 *
 * @param secid - plugin-local symbol key.
 * @returns the provider's market-qualified code.
 */
export function toSecidParam(secid) {
  const market = secid.slice(0, 2).toLowerCase()
  const code = secid.slice(2)
  return `${market === 'sh' ? '1' : '0'}.${code}`
}
