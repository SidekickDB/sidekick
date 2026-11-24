<!-- SidekickDB: plain-text header in place of upstream's logo, badges and links. -->

# @sidekickdb/vue

Part of [SidekickDB](https://github.com/SidekickDB/sidekick), an independent continuation of the Apache-2.0 InstantDB code. It is not affiliated with or endorsed by Instant.

Welcome to SidekickDB's Vue SDK.

```vue
<!-- ༼ つ ◕_◕ ༽つ Real-time Chat -->
<!-- ---------------------------------- -->
<!-- * Updates instantly -->
<!-- * Multiplayer -->
<!-- * Works offline -->

<script setup>
import { init, id } from '@sidekickdb/vue';

const db = init({
  appId: import.meta.env.VITE_INSTANT_APP_ID,
  apiURI: import.meta.env.VITE_INSTANT_API_URI,
});

// 1. Read
const { isLoading, error, data } = db.useQuery({
  messages: {},
});

// 2. Write
const addMessage = (message) => {
  db.transact(db.tx.messages[id()].update(message));
};
</script>

<template>
  <!-- 3. Render! -->
  <UI :data="data" @add="addMessage" />
</template>
```

# Get Started

Follow the [getting started](https://github.com/SidekickDB/sidekick/blob/main/client/www/app/docs/start-vue/page.md) tutorial to set up a live Vue app in under 5 minutes!

# Questions?

If you have any questions, feel free to open an issue on [GitHub](https://github.com/SidekickDB/sidekick/issues).
