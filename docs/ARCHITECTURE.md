# Architecture

This document explains *why* `dsh-stock-ticker` is built the way it is. For the user-facing
behaviour, see the [README](README.md).

## The shape of a DSH plugin

A DSH plugin can contribute at two layers, and this one contributes at both:

| Layer | Entry | Loaded by | Lifetime |
|---|---|---|---|
| Host | `src/index.js` | the DSH **process**, from disk at startup | the process |
| Client | `lib/client.js` | the browser, when the **page** loads | the page |

`package.json` wires them up:

```jsonc
{
  "main": "src/index.js",          // the host row's entry point
  "exports": { "./client": "./lib/client.js" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },   // the loader rows to insert
    "client": { "platform": "web", "inject": [ /* ... */ ] }
  }
}
```

`dsh.client` is what puts this package into the `window.__DSH_BOOT__` graph that the harness's
`modules` row scans. The client half is therefore **not** a second loader row — it is served from
`/plugins/dsh-stock-ticker/client.js` because the manifest declares it.

## Why the two halves are different shapes

The host half is ordinary ESM (`src/index.js` and friends). The browser half is a **hand-authored
loader factory**:

```js
window.__ModuleLoader__.load({
  id: 'dsh-stock-ticker',
  factory: (require) => { /* ... */ },
})
```

That is exactly the shape the shared `tsdown` client preset emits for a TypeScript plugin — a
`__ModuleLoader__.load` call whose factory resolves platform singletons through an injected
`require`. Authoring it by hand means the package **ships no build step**: `lib/client.js` *is* the
artifact.

The consequence is a hard rule: everything the factory needs must be resolved **inside** the
factory, never at module scope. A `require('react')` at module scope would run before the loader
has wired the seed modules and would take the whole bundle down.

## Defensive primitive resolution

`@deepseek-ai/dsh-client-ui-primitives` is a platform seed the shell shares, and its surface moves
between releases — the 0.2 line dropped the `…16` size suffixes from icon names, for instance.

Rather than pin a version, the bundle resolves every export opportunistically:

```js
const primitives = require('@deepseek-ai/dsh-client-ui-primitives') ?? {}
```

Every glyph is drawn inline as SVG, and the two primitives fall back to native elements. A renamed
or removed export therefore degrades **one control** instead of aborting the bundle at require time.
The client half is checked against three primitive surfaces — the 0.1 icon names, the 0.2 icon
names, and an empty package.

## The durable store, and why it is not one thing

The platform's settings seam moved between releases:

| Release line | Seam |
|---|---|
| 0.1 | `ctx.settings.register(namespace, schema)` returning an owner handle |
| 0.2 | a Config-form projection with no namespace registration at all |

Binding to either shape would break the plugin on the other line. `src/store.js` instead **picks
whichever durable backing is actually present**, in priority order:

1. **A registered settings namespace.** The nicest backing — the platform owns the atomic writer and
   hot reload — so it wins when the service exposes `register`. Registration is attempted in a
   `try`/`catch`, because a composition that refuses the namespace (a duplicate, a stricter
   provider) still deserves a working watchlist.
2. **A JSON document** at `$DSH_HOME/stock-ticker.json`. This is the fallback and the primary path
   on the 0.2 line. It is deliberately a *separate file* from the platform's own configuration so
   the two can never overwrite each other. Writes are atomic (temp file + `rename`, mode `0600`),
   and the document is re-read whenever its size or mtime moves, so an external edit is picked up
   without a restart.
3. **Process memory**, which keeps the mini-window working for the session even on a read-only
   harness home.

Every backing exposes the same two-method contract — `get()` and `update(patch)` — so nothing above
`store.js` has to know which one is live. The chosen backing is logged at debug level for
diagnosis.

### Why configuration does not travel over the settings RPC

The Host's Web settings surface serves an **allowlist of in-box namespaces**. An out-of-tree
namespace answers `settings-not-exposed`. The browser half therefore never touches the settings RPC;
configuration travels over this plugin's own `/api/stock-ticker/config` route, while persistence
still goes through the settings provider's document and atomic writer when that backing won.

The settings page and the mini-window are consequently two views of one shared mirror.

## Dependency-free validation

`src/settings.js` carries a hand-written validator instead of using the platform's schema library.
The reason is resolution, not preference: the schema library is a **peer of the harness** rather than
of a plugin, so a plugin installed outside the harness's own module tree cannot resolve it. Carrying
the validator keeps the package installable anywhere — an absolute-path Loader row included — and
free of version skew against the harness's schema release.

Three consumers share this module, which is why it is not inlined anywhere:

- the host store resolves and normalizes with `resolveSettings()`,
- the host routes validate patches with `validatePatch()`,
- and the browser half mirrors the same defaults.

`resolveSettings()` is deliberately forgiving (it repairs a partially-written or hand-edited
document so it cannot produce an `undefined` read downstream), while `validatePatch()` is
deliberately strict (an unknown key or wrongly-typed value is refused rather than merged, because a
silently-dropped field looks to the user like a save that did not stick).

## Request pipeline

```
browser half
    │  POST /api/stock-ticker/{quotes,trends,search}   (same-origin, JSON)
    ▼
src/routes.js ──► TtlCache ──► mapLimited(3) ──► src/provider.js ──► East Money push2
    │                                                                       │
    └─────────────── normalized shapes ◄────────────────────────────────────┘
```

### Why the host proxies every request

Two reasons, and both matter:

1. **The provider requires a `Referer` header** that a page cannot set.
2. **One cache serves every open tab.** Keeping traffic host-side means a room full of tabs costs one
   provider call per key rather than one each.

### The TTL cache

A tiny promise-deduplicating cache:

- Concurrent misses **share one in-flight promise**, so simultaneous tabs produce a single upstream
  request per key.
- **Failures are never cached.** On rejection the entry is removed, so the next poll retries
  immediately rather than being told the market is broken for the whole TTL window.

TTLs: quotes 8 s while trading / 120 s outside hours, curves 30 s, search 300 s.

### Trading-hours approximation

`isTradingNow()` computes Beijing time as a fixed UTC+8 offset (China has no daylight saving, so a
fixed offset is exact) and checks weekday plus the 09:15–11:30 and 12:55–15:05 windows. It is
deliberately approximate: exchange holidays are not modelled, because the flag only drives a cache
TTL and the refresh cadence — a holiday costs a few extra upstream requests, not correctness.

### Transport policy

The upstream provider throttles by **closing the socket**, so the policies are conservative by
design:

| Knob | Value | Reason |
|---|---|---|
| Request timeout | 8 s | A hung provider must not pin a browser tab |
| Attempts | 2 | Piling retries onto a provider that is refusing traffic turns a slowdown into a sustained block |
| Retry backoff | 400 ms | Enough for a mid-handshake close, short enough not to stall a poll |
| Upstream concurrency | 3 | Issuing a whole watchlist at once is what makes the provider start closing sockets |
| Cooldown | 45 s after 4 consecutive failures | The only correct response to a run of dropped connections is to go quiet |

An outright non-2xx answer is **final** and is not retried — that is the provider's answer, not
noise. A caller-initiated abort is final too. Non-2xx and abort responses do not count toward the
cooldown threshold; only genuine transport failures do, so a bug in this plugin cannot masquerade as
an upstream outage.

## Wire format isolation

`src/provider.js` is the only module that knows the upstream wire format, and it is deliberately the
only place that does:

- Every numeric price arrives as a **scaled integer** with the scale given separately as `f59` —
  and that one scale covers the whole row, percentage fields included.
- Missing values arrive as the string `"-"`.
- Volume is in 手 (lots of 100) and turnover in CNY, both needing unit formatting for display.
- The provider's own market nibble is `1` for Shanghai and `0` for **both** Shenzhen and Beijing,
  which is why the plugin's `sh`/`sz`/`bj` prefix is echoed through rather than inferred from the
  response.

Everything above `provider.js` deals only in normalized shapes.

## The pin lifecycle

Placement deserves its own note because it has three states, not two, and conflating them produced a
reported defect.

```
        drag title bar                    press tack
floating ──────────────► moved (session) ──────────► pinned (durable)
   ▲                          │                          │
   │                          │                          │ header is no longer
   │                          │                          │ a drag handle; writes
   └──────────────────────────┴──────────────────────────┘ are confirmed before
              press tack again (unlock)                   the panel moves
```

Two invariants fall out of this:

1. **The tack's label follows the durable pin only.** It never flips underneath a drag. An earlier
   version derived the label from transient state, which made the panel look like it was jumping to
   the default corner.
2. **A position is held locally until the section confirms the write.** A Host that rejects the
   field (a half-updated deployment) leaves the panel where it was put, and the control reports
   honestly that the pin did not stick — because a reload would lose the position anyway.

A pin saved on a larger window is corrected against the current window before it is applied, so a
resize can never strand the panel off screen where its only drag handle is unreachable.

## Build stamps

The host half is loaded from disk when the DSH process starts; the browser half when the page loads.
Either can outlive the code on disk, and a mismatch looks like a broken feature rather than a
deployment problem.

`HOST_BUILD` (`src/settings.js`) and `CLIENT_BUILD` (`lib/client.js`) are bumped whenever the
respective half's behaviour changes. `GET /config` returns the host stamp alongside the section, and
the settings page footer renders both, so a stale half is always visible rather than guessed at.

**When you change either half's behaviour, bump its stamp.** See
[CONTRIBUTING.md](CONTRIBUTING.md#build-stamps).
