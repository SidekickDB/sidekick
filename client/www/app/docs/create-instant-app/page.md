---
nextjs:
  metadata:
    title: 'create-sidekick-app'
    description: 'Use create-sidekick-app to scaffold a new SidekickDB project'
---

Once you know the basics of SidekickDB, you may find it useful to be able to
quickly scaffold a new SidekickDB project. We built `create-sidekick-app` to do just
that.

We currently offer templates for Next.js, Vite + React, Expo, and Vanilla TypeScript. Follow the quick start below to give it a spin!

## Quick start

If you haven't already, authenticate with the [SidekickDB CLI](/docs/cli) in your
terminal.

```shell {% showCopy=true %}
npx @sidekickdb/cli login
```

This will open your SidekickDB dashboard in a browser window, where you can log in or sign up for an account (if your server allows signups). The CLI needs to know where your server and dashboard are first: see [Configure the SidekickDB CLI](/docs/self-hosting#configure-the-sidekick-db-cli).
Once you've authenticated, any app you create with `create-sidekick-app` will be
associated with your SidekickDB account!

After authenticating, run the following command to scaffold a new SidekickDB app.

```shell {% showCopy=true %}
npx create-sidekick-app instant-demo
```

Run the dev server to see your new app in action!

```shell
cd instant-demo
npm run dev
```

Huzzah! 🎉 You now have a brand new SidekickDB project to play around with!

## One-shot with Claude Code

Got Claude Code? You can use it to one-shot a full-stack SidekickDB app!

Use `create-sidekick-app` with the `--ai` flag and you'll be prompted to describe the app you want to build. Give it a try!

{% tabbed-single tabs={
  "npx": { "label": "npx", "content": "npx create-sidekick-app --ai" },
  "pnpx": { "label": "pnpx", "content": "pnpx create-sidekick-app --ai" },
  "bunx": { "label": "bunx", "content": "bunx create-sidekick-app --ai" }
} defaultTab="npx" storageKey="pkg-manager" /%}

You can think of this as a one-shot app builder in the terminal.
