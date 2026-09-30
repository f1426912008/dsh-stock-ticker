# Contributing to dsh-stock-ticker

Thanks for taking the time to contribute. This document covers everything you need to build,
verify, and submit a change.

[English](CONTRIBUTING.md) · [简体中文](CONTRIBUTING.zh-CN.md)

---

## Table of contents

- [Ground rules](#ground-rules)
- [Getting started](#getting-started)
- [Project layout](#project-layout)
- [Code style](#code-style)
- [Build stamps](#build-stamps)
- [Manual test matrix](#manual-test-matrix)
- [Submitting a change](#submitting-a-change)
- [Reporting bugs](#reporting-bugs)
- [Security issues](#security-issues)

## Ground rules

- Be respectful. This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
- **Keep the package dependency-free.** This is the single most important constraint in the
  codebase, and it is load-bearing: see [Why there is no build step](README.md#why-there-is-no-build-step).
  A pull request that adds a runtime dependency, a bundler, or a test framework to the published
  package will be asked to rework that part.
- **Keep the no-build-step property.** `lib/client.js` is the shipped artifact. Do not introduce a
  compile step for it.
- One logical change per pull request.

## Getting started

There is nothing to install and nothing to build.

```sh
git clone https://github.com/f1426912008/dsh-stock-ticker.git
cd dsh-stock-ticker
npm run check
```

`npm run check` syntax-checks every source file using only `node --check`. It requires no
`node_modules`, and it is the same command CI runs.

### Trying it in a running harness

```sh
dsh plugin --profile <profile> add ./dsh-stock-ticker
```

The host half is read from disk at **process** start, so a host-side change needs a DSH restart. The
client half is read at **page** load, so a client-side change needs a page reload (or a hard reload if
a bundle was already served). Both halves carry a build stamp that the settings page displays — see
[Build stamps](#build-stamps).

To uninstall:

```sh
dsh plugin --profile <profile> remove dsh-stock-ticker
```

## Project layout

```
src/index.js       host plugin body
src/routes.js      the JSON routes and their request validation
src/provider.js    the upstream quote wire format, isolated
src/settings.js    section shape, defaults, and the one write validator
src/store.js       backing selection (settings namespace → file → memory)
lib/client.js      the browser half: the loader-factory bundle the shell serves
cordis.patch.yml   the bundle layer
docs/              design notes
```

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) explains the reasoning behind each seam. If your
change touches the store, the cache, the transport policy, or the pin lifecycle, read it first — most
of those decisions were forced by a concrete failure, and the reasoning is recorded so it does not
have to be rediscovered.

## Code style

The source is written in a consistent, deliberately plain style. Match it.

| | |
|---|---|
| Indent | 2 spaces |
| Quotes | single |
| Semicolons | none |
| Line width | 120 columns |
| Modules | ESM (`import` / `export`), `"type": "module"` |
| Line endings | LF (enforced by `.gitattributes`) |
| Trailing whitespace | trimmed (enforced by `.editorconfig`) |

Beyond formatting:

- **Comment the *why*, not the *what*.** The existing comments explain constraints, failure modes,
  and rejected alternatives. A comment that restates the code adds noise.
- **JSDoc every exported function**, including `@param` and `@returns`. The private helpers are
  documented too where the reasoning is non-obvious.
- **Never cache a failure.** Every cache and retry path in this codebase preserves that property.
- **Fail loudly on invalid input, quietly on unreachable symbols.** A bad settings patch is a `400`
  and the caller's fault; one unreachable quote must not blank the whole board.
- **Do not widen the upstream request rate** without a very good reason. The provider throttles
  aggressively, and the conservative defaults exist because of it.

## Build stamps

`HOST_BUILD` in `src/settings.js` and `CLIENT_BUILD` in `lib/client.js` identify which build
produced a running half. They exist because the two halves load at different times and can silently
disagree.

**Bump the stamp of whichever half's behaviour you changed**, using the `YYYY-MM-DD.N` format where
`N` increments within a day. A change that spans both halves bumps both.

If you add behaviour that a user can observe, also add it to the [manual test matrix](#manual-test-matrix)
so the next person can verify it.

## Manual test matrix

Both halves are exercised end-to-end against a real cordis Context, a real HTTP listener, and a
jsdom page. The matrix below is what a change should be checked against before it is submitted —
reviewers will ask which rows you ran.

### Quotes and curves

- [ ] Quotes reach the rows and refresh on the configured cadence.
- [ ] Curves are drawn for exactly `maxCurves` rows.
- [ ] The hover card fetches on demand for a row **outside** the curve budget.
- [ ] The hover card's chart fills in after its price cells (expected — see
      [Known limitations](README.md#known-limitations)).
- [ ] A rise renders red and a fall renders green, **including the curve stroke**.
- [ ] Prices and curves stay on screen through a transient upstream outage, and are dropped only
      when a refresh genuinely succeeds again.
- [ ] Every detail-card label resolves to real copy — assert by rendering under a deliberately
      unhelpful translator.

### Configuration

- [ ] Search by code and by Chinese name.
- [ ] Add, reorder, and remove instruments.
- [ ] A budget change on the settings page reaches the mini-window.
- [ ] Hiding the window from the page unmounts the panel.
- [ ] An invalid patch (unknown key, wrong type, out-of-range value) is refused with `400`.
- [ ] Each backing works: settings namespace, `$DSH_HOME/stock-ticker.json`, and memory.

### Window placement

- [ ] Dragging moves the panel.
- [ ] A drag on its own does **not** pin.
- [ ] The tack stores the position it was pressed at.
- [ ] A pinned panel refuses to move, and its header is no longer a drag handle.
- [ ] Unlocking restores the drag without moving the panel.
- [ ] A reload returns the panel to the pinned spot.
- [ ] Opacity reaches a mounted panel.
- [ ] An off-screen pin is brought back on screen and re-persisted.
- [ ] A refused pin write retains the position and reports that it did not stick.

### Client-primitive compatibility

- [ ] The client half loads against the 0.1 icon names.
- [ ] It loads against the 0.2 icon names.
- [ ] It loads against an empty primitives package, degrading controls rather than aborting.

## Submitting a change

1. Fork the repository and branch from `main`.
2. Make your change, keeping it to one logical unit.
3. Run `npm run check`.
4. Run the rows of the [manual test matrix](#manual-test-matrix) your change touches, and say which
   ones in the pull request description.
5. Bump the relevant [build stamp](#build-stamps) if behaviour changed.
6. Update `README.md` **and** `README.zh-CN.md` if you changed anything user-facing — the two are
   kept in sync, and a pull request that updates only one will be asked to update both.
7. Add an entry under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md) for user-visible changes.
8. Open the pull request and fill in the template.

### Commit messages

Conventional Commits, with a scope when it helps:

```
feat(routes): cache search results for five minutes
fix(client): keep the detail card open while the curve loads
docs(readme): document the bj market prefix
chore(deps): drop the unused schema peer
```

Useful types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.

### What reviewers look for

- Does it keep the package dependency-free and build-step-free?
- Does it preserve the failure semantics (never cache a failure, never blank the board, strict on
  input)?
- Is the *why* recorded in a comment where the reasoning is non-obvious?
- Are both READMEs updated?
- Is the build stamp bumped?

## Reporting bugs

Open an [issue](https://github.com/f1426912008/dsh-stock-ticker/issues/new/choose). A useful report
includes:

- the **build stamps** from the settings page footer (前端 / 宿主) — this rules out a stale half
  immediately and is the single most valuable field;
- your DSH version and platform;
- which settings backing is in use (`$DSH_HOME/stock-ticker.json` present or not);
- what you expected, what happened, and the smallest watchlist that reproduces it.

**Please do not paste personal data.** Your watchlist is yours; a single symbol is usually enough to
reproduce a rendering or quote bug.

## Security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).
