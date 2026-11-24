<!-- SidekickDB: plain-text header in place of upstream's logo, badges and links. -->

# create-sidekick-app

Part of [SidekickDB](https://github.com/SidekickDB/sidekick), an independent continuation of the Apache-2.0 InstantDB code. It is not affiliated with or endorsed by Instant.

Welcome to `create-sidekick-app`.

# Get Started

Run the command to spin up different apps!

```bash
INSTANT_CLI_API_URI=https://sidekick.example.com \
INSTANT_CLI_DASH_URI=https://dash.sidekick.example.com \
npx create-sidekick-app
```

`INSTANT_CLI_API_URI` is required (there is no default server) and is written into the generated project. `INSTANT_CLI_DASH_URI` is needed to log in from the browser.

And you're ready to go!

# Development

Build or develop code with `pnpm run build` or `pnpm run dev`

Then link with pnpm: `pnpm link --global`

Now you can use the command anywhere! `create-sidekick-app`

Once you're done, you can unlink: `pnpm uninstall create-sidekick-app --global`
