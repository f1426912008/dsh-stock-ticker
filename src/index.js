/**
 * Host half of `dsh-stock-ticker`.
 *
 * Owns two things and nothing else:
 *
 * 1. The durable watchlist section, through whichever backing this composition
 *    supports (see `store.js`). The browser half reads and writes it over this
 *    plugin's own `/config` route, because the Host's Web settings surface only
 *    serves in-box namespaces.
 * 2. Three same-origin JSON routes under `/api/stock-ticker` that proxy the
 *    upstream quote provider. A page cannot set the `Referer` that provider
 *    requires, so every outbound request originates here, behind one small TTL
 *    cache that also shields the provider from a room full of open tabs.
 *
 * @module dsh-stock-ticker
 */

import { registerRoutes } from './routes.js'
import { createStore } from './store.js'

/** Cordis plugin name used in Loader diagnostics. */
export const name = 'stock-ticker'

/**
 * No hard dependency. `webServer` is acquired with `ctx.inject` inside the
 * routes module because a headless composition that never binds a browser
 * surface still owns the watchlist, and the settings service is *looked up*
 * rather than injected because its shape differs across platform releases —
 * declaring it here would leave this plugin pending forever on a composition
 * that does not provide it under that name.
 */
export const inject = []

/**
 * Plugin body: resolve the durable backing, then register the routes when a
 * browser carrier exists.
 *
 * @param ctx - Host cordis context.
 */
export function apply(ctx) {
  const { store, backing } = createStore(ctx)
  ctx.logger?.debug?.(`stock-ticker: watchlist backing is ${backing}`)
  registerRoutes(ctx, store)
}
