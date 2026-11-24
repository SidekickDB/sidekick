<!-- SidekickDB: plain-text header in place of upstream's logo, badges and links. -->

# @sidekickdb/admin

Part of [SidekickDB](https://github.com/SidekickDB/sidekick), an independent continuation of the Apache-2.0 InstantDB code. It is not affiliated with or endorsed by Instant.

Welcome to SidekickDB's admin SDK.

```javascript
import { init, tx, id } from '@sidekickdb/admin';

const adminDB = init({
  appId: 'my-instant-app-id',
  apiURI: process.env.INSTANT_API_URI,
  adminToken: process.env.INSTANT_APP_ADMIN_TOKEN,
});

const data = await adminDB.query(
  { bookshelves: { books: {} } }, // wohoo!
);
```

# Get Started

Head on over to the [SidekickDB on the Backend](https://github.com/SidekickDB/sidekick/blob/main/client/www/app/docs/backend/page.md) page in the docs to get started!

# Questions?

If you have any questions, feel free to open an issue on [GitHub](https://github.com/SidekickDB/sidekick/issues).
