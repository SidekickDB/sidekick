<!-- SidekickDB: plain-text header in place of upstream's logo, badges and links. -->

# @sidekickdb/core

Part of [SidekickDB](https://github.com/SidekickDB/sidekick), an independent continuation of the Apache-2.0 InstantDB code. It is not affiliated with or endorsed by Instant.

Welcome to SidekickDB's vanilla javascript SDK.

```javascript
db.subscribeQuery({ todos: {} }, (resp) => {
  if (resp.error) {
    renderError(resp.error.message);
    return;
  }
  if (resp.data) {
    render(resp.data); // wohoo!
  }
});
```

# Get Started

Follow the [getting started in vanilla Javascript](https://github.com/SidekickDB/sidekick/blob/main/client/www/app/docs/start-vanilla/page.md) tutorial to set up a live app in under 5 minutes!

# Questions?

If you have any questions, feel free to open an issue on [GitHub](https://github.com/SidekickDB/sidekick/issues).
