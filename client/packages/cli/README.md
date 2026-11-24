<!-- SidekickDB: plain-text header in place of upstream's logo, badges and links. -->

# @sidekickdb/cli

Part of [SidekickDB](https://github.com/SidekickDB/sidekick), an independent continuation of the Apache-2.0 InstantDB code. It is not affiliated with or endorsed by Instant.

Welcome to SidekickDB's command line tool. You can create apps, write schema, and push permissions.

```javascript
INSTANT_CLI_API_URI=https://sidekick.example.com \
INSTANT_CLI_DASH_URI=https://dash.sidekick.example.com \
npx @sidekickdb/cli init
```

There is no default server: set `INSTANT_CLI_API_URI` (or `apiURI` in `instant.config.ts`) to your SidekickDB server, and `INSTANT_CLI_DASH_URI` (or `dashURI`) to its dashboard for commands such as `login`.

## Get Started

Start by peeking at the [@sidekickdb/cli docs](https://github.com/SidekickDB/sidekick/blob/main/client/www/app/docs/cli/page.md).

# Contributing

Here's how to set up a local development environment for @sidekickdb/cli.

## Quick Start

```bash
Clone this repo
git clone ..

# If you made any backend changes, run the server locally in a separate terminal
cd server
make dev

# Add --filter @sidekickdb/cli to the 'dev' script in client/package.json to include
# @sidekickdb/cli in the dev process
"dev": "turbo run dev ... --filter @sidekickdb/cli"

# Now run the client to listen to cli changes
cd client
make dev

# Now go into a place where you can test out the CLI in your terminal
cd client/sandbox/cli-nodejs
INSTANT_CLI_DEV=1 npx @sidekickdb/cli ...
```

## Testing local builds

You can link a local build of `@sidekickdb/cli` globally so it's available as a regular command:

```bash
cd client/packages/cli
pnpm build
pnpm link --global
which sidekick-cli # should point to your pnpm global bin dir
```

Now you can run `sidekick-cli` anywhere and it will use your local build.

To unlink:

```bash
pnpm unlink --global @sidekickdb/cli
```

# Questions?

If you have any questions, feel free to open an issue on [GitHub](https://github.com/SidekickDB/sidekick/issues).
