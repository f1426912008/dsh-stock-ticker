## What this changes

<!-- One or two sentences. Link the issue it closes, if any: "Closes #12". -->

## Which half

- [ ] Host (`src/`)
- [ ] Browser (`lib/client.js`)
- [ ] Bundle layer (`cordis.patch.yml`, `package.json`)
- [ ] Docs only

## Checklist

- [ ] `npm run check` passes.
- [ ] The package is still **dependency-free** and has **no build step**.
- [ ] I ran the rows of the [manual test matrix](../CONTRIBUTING.md#manual-test-matrix) my change
      touches, and listed them below.
- [ ] I bumped `HOST_BUILD` and/or `CLIENT_BUILD` if behaviour changed
      ([why](../CONTRIBUTING.md#build-stamps)).
- [ ] I updated **both** `README.md` and `README.zh-CN.md` if anything user-facing changed.
- [ ] I added an entry under `## [Unreleased]` in `CHANGELOG.md` if the change is user-visible.

## Manual test matrix rows run

<!-- e.g. "Window placement: drag, pin, unlock, refused pin write" -->

## Notes for the reviewer

<!-- Anything non-obvious: a rejected alternative, a tradeoff, a follow-up you deliberately left out. -->
