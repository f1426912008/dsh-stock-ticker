<div align="center">

# dsh-stock-ticker

**A realtime stock watch mini-window for the [DeepSeek Harness](https://github.com/deepseek-ai) web GUI.**

A draggable A-share watchlist panel with intraday curves, a hover detail card, and its own settings
page — shipped as a single dependency-free DSH plugin.

[![DeepSeek Harness Plugin](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4B6BFB?style=flat-square)](https://github.com/topics/deepseek-harness)
[![dsh-plugin](https://img.shields.io/badge/tag-dsh--plugin-8A2BE2?style=flat-square)](https://github.com/topics/dsh-plugin)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.3-339933?style=flat-square&logo=node.js&logoColor=white)](package.json)
[![Runtime dependencies](https://img.shields.io/badge/runtime%20deps-0-brightgreen?style=flat-square)](#why-there-is-no-build-step)

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [Configuration](#configuration)
- [HTTP routes](#http-routes)
- [Data source and rate limiting](#data-source-and-rate-limiting)
- [Architecture](#architecture)
- [Development](#development)
- [Troubleshooting a stale build](#troubleshooting-a-stale-build)
- [Known limitations](#known-limitations)
- [Disclaimer](#disclaimer)
- [License](#license)

## Features

### The mini-window

One draggable, collapsible panel in the `shell.overlay` seat, showing every watched instrument.
Rows inside the configured curve budget draw an intraday 分时 curve; hovering a row opens its full
detail card — open/high/low/previous close, volume, turnover, turnover rate, amplitude, volume
ratio, market cap, float cap, P/E/P/B, and the limit-up / limit-down prices — without reflowing the
list underneath the pointer.

**Placement is two separate acts.** Dragging the title bar moves the panel and keeps it there for
the session. The tack in the header is what makes a position durable, and while a panel is pinned
it is **locked**: the header stops being a drag handle (the grab cursor goes away) and attempts to
move it do nothing. Press the tack again to unlock — the panel stays exactly where it is and becomes
draggable again — or use the settings page to clear the pin.

The tack follows the durable pin only, so its label always says what pressing it will do: 钉住 while
the panel is free, 取消钉住 while it is pinned. It never flips underneath a drag, which is what made
an earlier version look like it was jumping to the default corner.

- **A refused pin write does not move the panel.** The position is held locally until the section
  confirms it, so a Host that rejects the field (a half-updated deployment) leaves the panel where
  it was put. The control honestly reports that the pin did not stick, since a reload would lose the
  position.
- **A position saved on a larger window is corrected against the current one** before it is applied,
  so a resize can never strand the panel off screen where its only drag handle is unreachable.

### The watchlist page

A `settings.section` page named 股票盯盘. Search by code or Chinese name, add, reorder, and remove
instruments, and set how many get a curve, the refresh cadence, the panel's opacity, and whether the
mini-window is shown at all.

### Correct by default for A-shares

A rise is red and a fall is green, including the curve stroke — the convention a mainland reader
expects, not the Western one. This carries dedicated regression coverage because it was a reported
defect.

## Requirements

| | |
|---|---|
| DeepSeek Harness | A desktop build whose web GUI serves `window.__DSH_BOOT__` and exposes the `shell.overlay` / `settings.section` extension seats |
| Node.js | `>= 20.3` (the host half uses `AbortSignal.any`) |
| Runtime dependencies | **None** |
| Network | Outbound HTTPS to `push2.eastmoney.com`, `push2his.eastmoney.com`, and `searchapi.eastmoney.com` |

> The plugin targets mainland China A-share markets (Shanghai, Shenzhen, Beijing). It is not a
> general-purpose quote client for other exchanges.

## Install

The plugin is a bundle: one host row plus an auto-discovered client half.

```sh
# from the directory that contains dsh-stock-ticker/
dsh plugin --profile <profile> add ./dsh-stock-ticker
```

To install it into the desktop app, point the app's own CLI at the profile (the app ships one at
`/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`):

```sh
dsh plugin --profile desktop add ./dsh-stock-ticker
```

That appends the bundle to `dsh.profile.bundles` and links the package into the profile.

### Installing straight from GitHub

Because the package has no build step and no dependencies, a clone works as-is:

```sh
git clone https://github.com/f1426912008/dsh-stock-ticker.git
dsh plugin --profile desktop add ./dsh-stock-ticker
```

### Installing by hand

A profile whose composition the app does not manage yet can equivalently take the loader row by hand
in its `cordis.patch.yml`:

```yaml
- insert:
    - id: stock-ticker
      name: dsh-stock-ticker
```

The package has **no runtime dependencies** — not even the harness's schema library — so a row that
names an absolute path works too:

```yaml
- insert:
    - id: stock-ticker
      name: '/absolute/path/to/dsh-stock-ticker/src/index.js'
```

## Configuration

The durable section is resolved through the best backing the running composition offers:

| Backing | When it is chosen | Where the values live |
|---|---|---|
| settings namespace | the settings service exposes `register(namespace, schema)` | the platform's own settings document, under `stock-ticker:` |
| JSON document | otherwise (the normal case on the 0.2 line) | `$DSH_HOME/stock-ticker.json`, mode `0600` |
| process memory | a read-only harness home | for the session only |

The browser half never touches the settings RPC. The Host's Web settings surface serves an allowlist
of in-box namespaces, so an out-of-tree namespace answers `settings-not-exposed`; configuration
therefore travels over this plugin's own `/api/stock-ticker/config` route, and the settings page and
the mini-window are two views of one shared mirror.

### Settings fields

| Field | Default | Meaning |
|---|---|---|
| `watchlist` | `[]` | Instruments, in display order. At most 24. |
| `maxCurves` | `6` | How many rows get an intraday curve (1–24). |
| `refreshMs` | `15000` | Poll cadence during trading hours (5000–300000). |
| `visible` | `true` | Whether the panel is mounted. |
| `opacity` | `1` | Panel opacity, `0.35`–`1`. |
| `pinned` | `null` | `{ left, top }` once the panel has been placed. |

Each watchlist entry is `{ code, name, market }`, where `code` is six digits and `market` is one of
`sh`, `sz`, `bj`.

Writes are **strict**: an unknown key or a wrongly-typed value is refused with `400` rather than
silently merged, because a silently-dropped field looks to the user like a save that did not stick.

## HTTP routes

All routes are same-origin under `/api/stock-ticker`.

| Route | Body | Result |
|---|---|---|
| `GET /config` | — | the resolved section |
| `PATCH /config` | a partial section | the next section; `400` on an invalid field |
| `POST /quotes` | `{ secids? }` | `{ asOf, trading, throttled, quotes }`; defaults to the watchlist |
| `POST /trends` | `{ secid, ndays? }` | `{ points, previousClose, name }` |
| `POST /search` | `{ query }` | `{ results }` |

Request bodies are capped at 4 KB, and every symbol argument must match `^(sh|sz|bj)\d{6}$`.

## Data source and rate limiting

Quotes come from East Money's public push2 endpoints, read from the host process only: a page cannot
set the `Referer` that provider requires, and keeping the traffic host-side is what makes one cache
serve every tab.

Prices arrive as scaled integers (`f59` is the scale for the whole row, percentage fields included)
and are normalized in `src/provider.js`, which is the only module that knows that wire format.

| Concern | Behaviour |
|---|---|
| Quote cache | 8 s while the exchanges are open, 120 s outside those hours |
| Curve cache | 30 s |
| Search cache | 300 s |
| In-flight dedup | Concurrent misses share one upstream request per key |
| Upstream concurrency | Capped at 3 reads at a time |
| Transport retries | 2 attempts, 400 ms backoff, transport noise only |
| Cooldown | After 4 consecutive transport failures, stop asking for 45 s |

The quote response carries `throttled` while the provider is in that cooldown, and the mini-window
turns it into 行情源限流 · 显示最后数据 — keeping the last known numbers on screen rather than replacing
them with an apology. The defaults (15 s cadence, 5 s floor) are set for that same reason: this
provider throttles clients that ask often.

Failures are never cached, so the next poll retries immediately rather than being told the market is
broken for the whole TTL window.

## Architecture

```
src/index.js      host plugin body
src/routes.js     the JSON routes and their request validation
src/provider.js   the upstream quote wire format, isolated
src/settings.js   section shape, defaults, and the one write validator
src/store.js      backing selection (settings namespace → file → memory)
lib/client.js     the browser half: the loader-factory bundle the shell serves
cordis.patch.yml  the bundle layer
```

`lib/client.js` is hand-authored in the loader's factory form rather than compiled, so the package
ships no build step. It depends on nothing but the platform seed modules (`react` and
`@deepseek-ai/dsh-client-ui-primitives`), and it resolves those defensively: every glyph is drawn
inline and the two primitives fall back to native elements, so a renamed or removed export degrades
one control instead of aborting the bundle.

For the design reasoning behind the backing selection, the caching layer, and the transport
policy, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

### Why there is no build step

The harness's schema library is a peer of the harness rather than of a plugin, so a plugin installed
outside the harness's own module tree cannot resolve it. Carrying a hand-written validator keeps this
package installable anywhere — an absolute-path Loader row included — and free of version skew
against the harness's schema release.

## Development

```sh
git clone https://github.com/f1426912008/dsh-stock-ticker.git
cd dsh-stock-ticker
npm run check     # syntax-check every source file, no dependencies required
```

There is nothing to install and nothing to build. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the
full workflow, the code style, and the manual test matrix that covers both halves end-to-end.

### Layout of the two halves

The host half is read from disk when the DSH **process** starts; the browser half is read when the
**page** loads. Either can therefore outlive the code on disk, which is why both carry a build stamp
(see below).

## Troubleshooting a stale build

A mismatch between the two halves looks like a feature that "does not work" rather than a deployment
problem. The settings page footer prints both stamps so this is never a guess:

```
前端 2026-09-30.6 · 宿主 2026-09-30.6
```

| Symptom | Cause | Fix |
|---|---|---|
| **宿主 unknown** | The running Host half predates the stamp | Restart DSH |
| **宿主 older than 前端** | The Host is running an older build than the page | Restart DSH |
| **前端 older than the stamp in this repo** | The page is running a previously served bundle | Hard-reload the page |

`HOST_BUILD` in `src/settings.js` and `CLIENT_BUILD` in `lib/client.js` are bumped whenever the
respective half's behaviour changes, so the stamps always identify the build that produced them.

## Known limitations

- **Quote data is not attributed or licensed for redistribution.** The plugin reads a public
  endpoint intended for a browser page; use it for personal monitoring.
- **A market session is approximated.** Trading hours are computed from Beijing time and weekdays
  only, so an exchange holiday costs a few extra upstream requests rather than correctness — the flag
  only drives a cache TTL and the refresh cadence.
- **The watchlist is capped at 24 instruments**, which is also the per-request ceiling.
- **Rows outside the curve budget fetch their curve on hover**, so the first hover on such a row
  shows its price cells before its card's chart fills in.
- **No pinned-session or multi-workspace scoping**: the overlay is root-scoped, so the watchlist is
  the same in every session.
- **The upstream provider blocks eager clients.** Polling it from one address at a multi-second
  cadence gets that address throttled for a while, independently of this plugin. The cooldown limits
  how much the plugin contributes to that, but cannot make the provider more permissive; when it does
  block, the panel says so and keeps showing the last values it received.
- **Detail-card labels follow the app locale**, resolved through the framework's translator with the
  plugin's own dictionary as a deterministic fallback; a locale the plugin does not ship falls back
  to Chinese.
- **Everything the mini-window displays is user-owned configuration**, not a hardcoded tunable.

## Disclaimer

This project is **not affiliated with, endorsed by, or sponsored by** DeepSeek, East Money
(东方财富), or any exchange. "DeepSeek Harness" and "DSH" are used descriptively to identify the
host application this plugin extends.

Market data is fetched from third-party public endpoints at runtime and is **not** redistributed by
this project. It is provided for personal monitoring only, with no warranty of accuracy,
completeness, or timeliness, and it is **not** investment advice. You are responsible for complying
with the terms of any data source you poll.

## License

[MIT](LICENSE) © 2026 f1426912008
