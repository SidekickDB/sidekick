<!-- SidekickDB: plain-text header in place of upstream's logo, badges and links. -->

# @sidekickdb/react-native

Part of [SidekickDB](https://github.com/SidekickDB/sidekick), an independent continuation of the Apache-2.0 InstantDB code. It is not affiliated with or endorsed by Instant.

Welcome to SidekickDB's React Native SDK.

```javascript
// ༼ つ ◕_◕ ༽つ Real-time Chat
// ----------------------------------
// * Updates instantly
// * Multiplayer
// * Works offline

import { init, id } from '@sidekickdb/react-native';

const db = init({
  appId: process.env.NEXT_PUBLIC_APP_ID,
  apiURI: process.env.NEXT_PUBLIC_INSTANT_API_URI,
});

function Chat() {
  // 1. Read
  const { isLoading, error, data } = db.useQuery({
    messages: {},
  });

  // 2. Write
  const addMessage = (message) => {
    db.transact(db.tx.messages[id()].update(message));
  };

  // 3. Render!
  return <UI data={data} onAdd={addMessage} />;
}
```

# Get Started

Follow the [getting started](https://github.com/SidekickDB/sidekick/blob/main/client/www/app/docs/start-rn/page.md) tutorial to set up a live React Native app in under 5 minutes!

# Questions?

If you have any questions, feel free to open an issue on [GitHub](https://github.com/SidekickDB/sidekick/issues).
