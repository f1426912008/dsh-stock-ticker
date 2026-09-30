# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.1.0] - 2026-09-30

The first public release. Both halves are exercised end-to-end against a real cordis Context, a real
HTTP listener, and a jsdom page.

### Added

- **Mini-window** in the `shell.overlay` seat: one draggable, collapsible panel showing every watched
  instrument, with an intraday 分时 curve for the first `maxCurves` rows.
- **Detail card on hover** — open/high/low/previous close, volume, turnover, turnover rate,
  amplitude, volume ratio, market cap, float cap, P/E/P/B, and the limit-up / limit-down prices —
  rendered without reflowing the list underneath the pointer. Rows outside the curve budget fetch
  their curve on demand.
- **Watchlist settings page** (股票盯盘) as a `settings.section`: search by code or Chinese name, add,
  reorder, and remove instruments, and set the curve budget, refresh cadence, panel opacity, and
  visibility.
- **Durable placement** with an explicit pin: dragging moves the panel for the session, the header
  tack makes the position durable and locks the panel while it is pinned.
- **A-share colour convention** — a rise is red and a fall is green, including the curve stroke.
- **Host-side quote proxy** under `/api/stock-ticker` (`/config`, `/quotes`, `/trends`, `/search`),
  so the `Referer`-requiring upstream is reached from the process and one cache serves every tab.
- **Three durable backings**, chosen in priority order: a registered settings namespace, then
  `$DSH_HOME/stock-ticker.json` (atomic writes, mode `0600`), then process memory.
- **Strict patch validation** — unknown keys and wrongly-typed values are refused with `400` rather
  than silently merged.
- **Rate-limit discipline** — TTL caching with in-flight deduplication, bounded upstream concurrency
  (3), two transport attempts, and a 45 s cooldown after four consecutive failures, surfaced to the
  panel as 行情源限流 · 显示最后数据.
- **Build stamps** for both halves (`HOST_BUILD` / `CLIENT_BUILD`), shown in the settings page footer
  so a stale half is visible rather than guessed at.
- **Zero runtime dependencies and no build step**: `lib/client.js` is the hand-authored
  loader-factory artifact the shell serves.

### Fixed

These behaviours carry dedicated regression coverage because each was a reported defect:

- **The tack no longer flips underneath a drag.** Its label follows the durable pin only, which is
  what made an earlier version look like it was jumping to the default corner.
- **A refused pin write no longer moves the panel.** The position is held locally until the section
  confirms it, and the control honestly reports that the pin did not stick.
- **An off-screen pin is brought back on screen** and re-persisted, so a resize on a larger window
  can never strand the panel where its only drag handle is unreachable.
- **Prices and curves survive a transient upstream outage**, and are dropped only when a refresh
  genuinely succeeds again.
- **Every detail-card label resolves to real copy**, asserted by rendering under a deliberately
  unhelpful translator.

[Unreleased]: https://github.com/f1426912008/dsh-stock-ticker/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/f1426912008/dsh-stock-ticker/releases/tag/v0.1.0
