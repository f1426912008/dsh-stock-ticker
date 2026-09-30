/**
 * Durable watchlist store for the host half.
 *
 * This module exists because the platform's settings seam moved: the 0.1 line
 * had `ctx.settings.register(namespace, schema)` returning an owner handle,
 * while the 0.2 line replaced it with a Config-form projection that has no
 * namespace registration at all. Rather than bind this plugin to either shape,
 * the store picks whichever durable backing is actually present, in order:
 *
 * 1. A registered settings namespace (0.1 line). This is the nicest backing —
 *    the platform owns the atomic writer and hot reload — so it wins when the
 *    service exposes `register`.
 * 2. A JSON document beside the harness home. This is the fallback and the
 *    primary path on the 0.2 line. It is deliberately a separate file from the
 *    platform's own configuration so the two can never overwrite each other.
 * 3. Process memory, which keeps the mini-window working for the session even
 *    on a read-only harness home.
 *
 * Every backing exposes the same tiny contract — `get()` and `update(patch)` —
 * so nothing above this module has to know which one is live.
 *
 * @module dsh-stock-ticker/store
 */

import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_MAX_CURVES, DEFAULT_REFRESH_MS, defaultSettings, mergeSettings, resolveSettings, SETTINGS_NAMESPACE,
} from './settings.js'

/** Document name used by the file backing; also the settings namespace key. */
const FILE_NAME = 'stock-ticker.json'

/**
 * Resolve the harness home directory the way the CLI does.
 *
 * @returns the absolute harness home path.
 */
function harnessHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured !== '') return configured
  const userHome = process.env.HOME ?? process.env.USERPROFILE
  return typeof userHome === 'string' && userHome !== '' ? join(userHome, '.dsh') : '.dsh'
}

/**
 * A store backed by a JSON document in the harness home.
 *
 * Writes are atomic (temp file + rename, owner-only). The document is re-read
 * whenever its size or mtime moves, so an external edit is picked up without a
 * restart.
 */
class FileStore {
  #path
  #cache
  #stamp

  /**
   * @param path - absolute document path.
   */
  constructor(path) {
    this.#path = path
    this.#cache = this.#read()
    this.#stamp = this.#stat()
  }

  /** @returns the document's identity, or undefined when it is absent. */
  #stat() {
    try {
      const info = statSync(this.#path)
      return `${String(info.size)}:${String(info.mtimeMs)}`
    } catch {
      return undefined
    }
  }

  /** @returns the resolved document, or the defaults when it is absent or unreadable. */
  #read() {
    try {
      return resolveSettings(JSON.parse(readFileSync(this.#path, 'utf8')))
    } catch {
      return defaultSettings()
    }
  }

  /** @returns the current settings view, re-reading when the document changed underneath. */
  get() {
    const stamp = this.#stat()
    if (stamp !== this.#stamp) {
      this.#cache = this.#read()
      this.#stamp = stamp
    }
    return this.#cache
  }

  /**
   * Merge a validated patch into the document and persist it atomically.
   *
   * @param patch - fields to merge; already validated by the caller.
   * @returns the next settings view.
   */
  update(patch) {
    const next = mergeSettings(this.get(), patch)
    const temporary = `${this.#path}.${String(process.pid)}.tmp`
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, this.#path)
    this.#cache = next
    this.#stamp = this.#stat()
    return next
  }
}

/** A store that keeps the section in process memory only. */
class MemoryStore {
  #value

  /**
   * @param initial - starting settings view.
   */
  constructor(initial) {
    this.#value = initial
  }

  /** @returns the current settings view. */
  get() {
    return this.#value
  }

  /**
   * @param patch - fields to merge.
   * @returns the next settings view.
   */
  update(patch) {
    this.#value = mergeSettings(this.#value, patch)
    return this.#value
  }
}

/**
 * Build a schema object for the platform's settings registry.
 *
 * The 0.1-line provider needs something that is *both* callable (to resolve the
 * section and apply defaults) and an object carrying `toJSON()` plus an exposed
 * `dict`, because it serializes the schema for the configuration page and walks
 * the dictionary to render fields. This produces exactly that shape without
 * depending on the platform's schema library, which a plugin installed outside
 * the harness's own module tree cannot resolve.
 *
 * The declared envelope is intentionally shallow — the watchlist is described as
 * a plain array rather than an array of instrument objects — because a
 * configuration page that renders the outer fields is all this plugin needs
 * from it. Names, markets, and codes are validated by `settings.js` on every
 * read and write instead.
 *
 * @returns a callable, serializable schema object for the `stock-ticker` section.
 */
function sectionSchema() {
  const meta = (type, extra = {}) => ({ type, ...extra })
  const resolve = (value) => {
    const section = value !== null && typeof value === 'object' ? value : {}
    return {
      watchlist: Array.isArray(section.watchlist) ? section.watchlist : [],
      maxCurves: Number.isInteger(section.maxCurves) ? section.maxCurves : DEFAULT_MAX_CURVES,
      refreshMs: Number.isInteger(section.refreshMs) ? section.refreshMs : DEFAULT_REFRESH_MS,
      visible: section.visible !== false,
    }
  }
  const dict = {
    watchlist: Object.assign(meta('array', { default: [], inner: meta('object', { dict: {} }) }), {
      toString: () => 'watchlist',
    }),
    maxCurves: Object.assign(meta('number', { default: DEFAULT_MAX_CURVES }), { toString: () => 'maxCurves' }),
    refreshMs: Object.assign(meta('number', { default: DEFAULT_REFRESH_MS }), { toString: () => 'refreshMs' }),
    visible: Object.assign(meta('boolean', { default: true }), { toString: () => 'visible' }),
  }
  return Object.assign(resolve, {
    dict,
    meta: meta('object', { default: resolve(undefined) }),
    toJSON: () => ({ type: 'object', dict, meta: { default: resolve(undefined) } }),
  })
}

/**
 * Adapt a 0.1-line settings namespace handle to the store contract.
 *
 * @param scope - the `settings.register` owner handle.
 * @returns a store reading and writing through the platform's own document.
 */
function settingsScopeStore(scope) {
  return {
    get: () => resolveSettings(scope.get()),
    update: async (patch) => {
      await scope.update(patch)
      return resolveSettings(scope.get())
    },
  }
}

/**
 * Create the best store this composition can support.
 *
 * @param ctx - Host cordis context.
 * @returns the store plus the name of the backing it chose, for diagnostics.
 */
export function createStore(ctx) {
  const settings = ctx.get('settings')
  if (settings !== undefined && typeof settings.register === 'function') {
    try {
      const scope = settings.register(SETTINGS_NAMESPACE, sectionSchema(), { applies: 'live' })
      return { store: settingsScopeStore(scope), backing: 'settings-namespace' }
    } catch (error) {
      // A composition that refuses this namespace (a duplicate registration, a
      // stricter provider) still deserves a working watchlist.
      ctx.logger?.warn?.(`stock-ticker: settings namespace unavailable, using a file instead: ${String(error)}`)
    }
  }
  try {
    const path = join(harnessHome(), FILE_NAME)
    return { store: new FileStore(path), backing: `file:${path}` }
  } catch {
    return { store: new MemoryStore(defaultSettings()), backing: 'memory' }
  }
}
