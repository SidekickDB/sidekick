---
nextjs:
  metadata:
    title: 'Create SidekickDB App'
    description: 'Use create-sidekick-app to scaffold a new SidekickDB project'
---

Once you know the basics of Instant, you may find it useful to be able to
quickly scaffold a new Instant project. We built `create-sidekick-app` to do just
that.

We currently offer templates for Next.js, Vite + React, Expo, and Vanilla TypeScript. Follow the quick start below to give it a spin!

## Quick start

If you haven't already, authenticate with the [Instant CLI](/docs/cli) in your
terminal.

```shell {% showCopy=true %}
npx @sidekickdb/cli login
```

This will open a browser window where you can log in or sign up for an account.
Once you've authenticated, any app you create with `create-sidekick-app` will be
associated with your Instant account!

After authenticating, run the following command to scaffold a new Instant app.

```shell {% showCopy=true %}
npx create-sidekick-app instant-demo
```

Run the dev server to see your new app in action!

```shell
cd instant-demo
npm run dev
```

Huzzah! 🎉 You now have a brand new Instant project to play around with!

## One-shot with Claude Code

Got Claude Code? You can use it to one-shot a full-stack Instant app!

Use `create-sidekick-app` with the `--ai` flag and you'll be prompted to describe the app you want to build. Give it a try!

{% tabbed-single tabs={
  "npx": { "label": "npx", "content": "npx create-sidekick-app --ai" },
  "pnpx": { "label": "pnpx", "content": "pnpx create-sidekick-app --ai" },
  "bunx": { "label": "bunx", "content": "bunx create-sidekick-app --ai" }
} defaultTab="npx" storageKey="pkg-manager" /%}

You can think of this as a one-shot app builder in the terminal.
