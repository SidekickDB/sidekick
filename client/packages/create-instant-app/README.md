<p align="center">
  <a href="https://instantdb.com">
    <img alt="Shows the Instant logo" src="https://instantdb.com/img/icon/android-chrome-512x512.png" width="10%">
  </a>
  <h1 align="center">create-sidekick-app</h1>
</p>

<p align="center">
  <a
    href="https://discord.com/invite/VU53p7uQcE" >
    <img height=20 src="https://img.shields.io/discord/1031957483243188235" />
  </a>
  <img src="https://img.shields.io/github/stars/instantdb/instant" alt="stars">
</p>

<p align="center">
   <a href="https://www.instantdb.com/docs/start-vanilla">Get Started</a> ·
   <a href="https://instantdb.com/examples">Examples</a> ·
   <a href="https://www.instantdb.com/docs/start-vanilla">Docs</a> ·
   <a href="https://discord.com/invite/VU53p7uQcE">Discord</a>
<p>

Welcome to `create-sidekick-app`.

# Get Started

Run the command to spin up different instant apps!

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
