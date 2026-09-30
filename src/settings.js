/**
 * The `stock-ticker` settings section: its shape, its defaults, and the one
 * validator every write passes through.
 *
 * Deliberately dependency-free. The platform's schema library is a peer of the
 * harness rather than of a plugin, so a plugin installed outside the harness's
 * own module tree cannot resolve it; carrying a hand-written validator keeps
 * this package installable anywhere (an absolute-path Loader row included) and
 * free of version skew against the harness's schema release.
 *
 * Three consumers share this module, which is why it is not inlined anywhere:
 * the host store resolves and normalizes with it, the host routes validate
 * patches with it, and the browser half mirrors the same defaults.
 *
 * @module dsh-stock-ticker/settings
 */

/** Settings namespace owned by this plugin. */
export const SETTINGS_NAMESPACE = 'stock-ticker'

/**
 * Host build stamp, reported on the settings page next to the client's.
 *
 * The profile loads this half from disk at startup and the browser half when
 * the page loads, so the two can be different builds for as long as either
 * outlives the code on disk. Publishing both makes that visible. Bump it
 * whenever host behaviour changes.
 */
export const HOST_BUILD = '2026-09-30.6'

/** How many intraday curves the mini-window draws by default. */
export const DEFAULT_MAX_CURVES = 6

/**
 * Poll cadence in milliseconds used until the user picks another.
 *
 * Kept deliberately unhurried: the upstream provider throttles clients that ask
 * often, and a watchlist multiplies every poll by its size, so the default has
 * to leave headroom rather than sit at the fastest comfortable-looking value.
 */
export const DEFAULT_REFRESH_MS = 15_000

/** Smallest poll cadence the validator accepts. */
export const MIN_REFRESH_MS = 5_000

/** Largest poll cadence the validator accepts. */
export const MAX_REFRESH_MS = 300_000

/** Largest watchlist the validator accepts; also the hard request-burst ceiling. */
export const MAX_WATCHLIST = 24

/** Exchange prefixes; a bare code is ambiguous without one. */
export const MARKETS = ['sh', 'sz', 'bj']

/** Every field a settings patch may name. */
export const SETTINGS_FIELDS = ['watchlist', 'maxCurves', 'refreshMs', 'visible', 'opacity', 'pinned']

/** Most transparent the panel may be drawn while staying readable. */
export const MIN_OPACITY = 0.35

/** Default panel opacity. */
export const DEFAULT_OPACITY = 1

/** Largest window coordinate the validator accepts, as a sanity bound. */
const MAX_POSITION = 20_000

/** The default section, fresh on every read so callers cannot mutate a shared object. */
export function defaultSettings() {
  return {
    watchlist: [],
    maxCurves: DEFAULT_MAX_CURVES,
    refreshMs: DEFAULT_REFRESH_MS,
    visible: true,
    opacity: DEFAULT_OPACITY,
    pinned: null,
  }
}

/**
 * Coerce one stored pin into a usable window position.
 *
 * @param value - candidate `{ left, top }` from the document.
 * @returns the position, or `null` when the pin is absent or unusable.
 */
export function adoptPin(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const { left, top } = value
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null
  return {
    left: Math.round(Math.min(Math.max(left, 0), MAX_POSITION)),
    top: Math.round(Math.min(Math.max(top, 0), MAX_POSITION)),
  }
}

/**
 * A refused settings patch: the caller sent something this plugin will not
 * store. Distinct from a transport failure so the dispatcher can answer 400
 * rather than blaming the upstream provider.
 */
export class PatchError extends Error {}

/** Whether a value is a bare six-digit instrument code. */
const isCode = (value) => typeof value === 'string' && /^\d{6}$/.test(value)

/**
 * Coerce one stored watchlist entry, dropping it when it is unusable.
 *
 * @param item - candidate entry from the document.
 * @returns the normalized entry, or `undefined` when it cannot be salvaged.
 */
function adoptItem(item) {
  if (item === null || typeof item !== 'object' || !isCode(item.code)) return undefined
  return {
    code: item.code,
    name: typeof item.name === 'string' ? item.name : '',
    market: MARKETS.includes(item.market) ? item.market : 'sh',
  }
}

/**
 * Resolve any stored value into the section shape the routes and the browser
 * half rely on, so a partially-written or hand-edited document cannot produce
 * an `undefined` read downstream.
 *
 * @param value - raw section read from durable storage.
 * @returns a fully-populated settings view.
 */
export function resolveSettings(value) {
  const section = value === null || typeof value !== 'object' ? {} : value
  const list = Array.isArray(section.watchlist) ? section.watchlist : []
  const watchlist = []
  for (const item of list) {
    const adopted = adoptItem(item)
    if (adopted !== undefined) watchlist.push(adopted)
    if (watchlist.length >= MAX_WATCHLIST) break
  }
  return {
    watchlist,
    maxCurves: Number.isInteger(section.maxCurves) && section.maxCurves >= 1 && section.maxCurves <= MAX_WATCHLIST
      ? section.maxCurves
      : DEFAULT_MAX_CURVES,
    refreshMs: Number.isInteger(section.refreshMs) && section.refreshMs >= MIN_REFRESH_MS && section.refreshMs <= MAX_REFRESH_MS
      ? section.refreshMs
      : DEFAULT_REFRESH_MS,
    visible: section.visible !== false,
    opacity: typeof section.opacity === 'number' && section.opacity >= MIN_OPACITY && section.opacity <= 1
      ? section.opacity
      : DEFAULT_OPACITY,
    pinned: adoptPin(section.pinned),
  }
}

/**
 * Validate one merge-style patch.
 *
 * Deliberately strict: an unknown key or a wrongly-typed value is refused
 * rather than merged, because a silently-dropped field looks to the user like a
 * save that did not stick.
 *
 * @param patch - candidate patch object.
 * @returns the validated patch.
 * @throws {PatchError} when the patch is not a plain object or carries an invalid field.
 */
export function validatePatch(patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new PatchError('patch must be a plain object')
  }
  const out = {}
  for (const [key, value] of Object.entries(patch)) {
    if (!SETTINGS_FIELDS.includes(key)) throw new PatchError(`unknown settings field "${key}"`)
    if (key === 'watchlist') {
      if (!Array.isArray(value)) throw new PatchError('watchlist must be an array')
      if (value.length > MAX_WATCHLIST) {
        throw new PatchError(`watchlist may hold at most ${String(MAX_WATCHLIST)} instruments`)
      }
      out.watchlist = value.map(item => {
        if (item === null || typeof item !== 'object') throw new PatchError('watchlist entries must be objects')
        if (!isCode(item.code)) throw new PatchError('watchlist entry "code" must be six digits')
        const market = item.market === undefined ? 'sh' : item.market
        if (!MARKETS.includes(market)) throw new PatchError('watchlist entry "market" must be sh, sz, or bj')
        return { code: item.code, name: typeof item.name === 'string' ? item.name : '', market }
      })
    } else if (key === 'maxCurves') {
      if (!Number.isInteger(value) || value < 1 || value > MAX_WATCHLIST) {
        throw new PatchError(`maxCurves must be an integer between 1 and ${String(MAX_WATCHLIST)}`)
      }
      out.maxCurves = value
    } else if (key === 'refreshMs') {
      if (!Number.isInteger(value) || value < MIN_REFRESH_MS || value > MAX_REFRESH_MS) {
        throw new PatchError(`refreshMs must be an integer between ${String(MIN_REFRESH_MS)} and ${String(MAX_REFRESH_MS)}`)
      }
      out.refreshMs = value
    } else if (key === 'opacity') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < MIN_OPACITY || value > 1) {
        throw new PatchError(`opacity must be a number between ${String(MIN_OPACITY)} and 1`)
      }
      // Two decimals is finer than any user can perceive and keeps stored
      // documents tidy.
      out.opacity = Math.round(value * 100) / 100
    } else if (key === 'pinned') {
      // `null` clears the pin, which is a meaningful value rather than an
      // omission: it is how "let the panel float at its default corner" is said.
      if (value === null) out.pinned = null
      else if (value === undefined) out.pinned = null
      else out.pinned = adoptPinOrThrow(value)
    } else {
      if (typeof value !== 'boolean') throw new PatchError('visible must be a boolean')
      out.visible = value
    }
  }
  return out
}

/**
 * Validate one pin payload.
 *
 * @param value - candidate `{ left, top }`.
 * @returns the normalized pin.
 * @throws {PatchError} when either coordinate is missing or not finite.
 */
function adoptPinOrThrow(value) {
  const pin = adoptPin(value)
  if (pin === null) throw new PatchError('pinned must be null or an object with finite "left" and "top"')
  return pin
}

/**
 * Merge a validated patch over a resolved section.
 *
 * @param current - the section as currently stored.
 * @param patch - an already-validated patch.
 * @returns the next section.
 */
export function mergeSettings(current, patch) {
  const merged = { ...resolveSettings(current) }
  for (const key of SETTINGS_FIELDS) {
    if (Object.hasOwn(patch, key)) merged[key] = patch[key]
  }
  return resolveSettings(merged)
}
