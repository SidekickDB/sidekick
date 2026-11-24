# Contributing to SidekickDB

SidekickDB is an independent continuation of the Apache-2.0 InstantDB code. It
is not affiliated with or endorsed by Instant. Please do not report SidekickDB
problems to Instant, and do not ask Instant's team for support with it.

## Questions and bugs

Open a [GitHub issue](https://github.com/SidekickDB/sidekick/issues). Say what
you ran, what you expected and what happened. For a self-hosted stack, include
the image tags and the output of `docker compose ps`.

Do not open an issue for a vulnerability. [`SECURITY.md`](./SECURITY.md) says
how to report one privately.

## Changes

1. Branch from `main` and open a pull request against `main`.
2. Keep the change small and about one thing.
3. The checks must be green. A maintainer reviews the exact commit that will be
   merged, so a new push needs a new review.
4. Pull requests are merged with a merge commit. Squash and rebase merges are
   switched off, because the history of the upstream project is kept intact.

To run things locally, start with [`client/README.md`](./client/README.md) and
[`server/README.md`](./server/README.md). Useful checks before you push:

```sh
node scripts/upstream/check.mjs
node --test scripts/upstream/*.test.mjs
(cd client && pnpm install && pnpm build-packages && pnpm run check-format)
```

The server (Clojure) tests run in CI.

## Staying close to upstream

Most of this code comes from InstantDB, and SidekickDB merges upstream's
changes regularly. To keep those merges cheap:

- Do not reformat, move or rename inherited code unless the change needs it.
- Mark an intentional difference with a `SidekickDB:` comment that says why,
  where the file format allows a comment.
- Record it in [`UPSTREAM.md`](./UPSTREAM.md) under "Intentional divergences"
  and in `scripts/upstream/divergences.mjs`.

[`UPSTREAM.md`](./UPSTREAM.md) explains how the fork relates to upstream.

## Licence

SidekickDB is licensed under the Apache License, Version 2.0
([`LICENSE.md`](./LICENSE.md), [`NOTICE`](./NOTICE)). By contributing you agree
that your contribution is licensed under the same terms.
