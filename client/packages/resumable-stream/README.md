<!-- SidekickDB: plain-text header in place of upstream's logo, badges and links. -->

# @sidekickdb/resumable-stream

Part of [SidekickDB](https://github.com/SidekickDB/sidekick), an independent continuation of the Apache-2.0 InstantDB code. It is not affiliated with or endorsed by Instant.

Welcome to SidekickDB's resumable-stream library.

This is a drop-in replacement for Vercel's resumable-stream library using SidekickDB streams.

SidekickDB's streams have no dependency on Redis and they never expire.

## Usage

You can provide your `appId`, `adminToken` and `apiURI` as arguments to `createResumableStreamContext` or export `INSTANT_APP_ID`, `INSTANT_APP_ADMIN_TOKEN` and `INSTANT_API_URI`. The server URL is required: there is no default server.

### Idempotent API

```typescript
import { createResumableStreamContext } from '@sidekickdb/resumable-stream';
import { after } from 'next/server';

const streamContext = createResumableStreamContext({
  waitUntil: after,
  appId: YOUR_INSTANT_APP_ID, // or export INSTANT_APP_ID
  adminToken: YOUR_INSTANT_APP_ADMIN_TOKEN, // or export INSTANT_APP_ADMIN_TOKEN
  apiURI: YOUR_SIDEKICK_SERVER_URL, // or export INSTANT_API_URI
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ streamId: string }> },
) {
  const { streamId } = await params;
  const resumeAt = req.nextUrl.searchParams.get('resumeAt');
  const stream = await streamContext.resumableStream(
    streamId,
    makeTestStream,
    resumeAt ? parseInt(resumeAt) : undefined,
  );
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
    },
  });
}
```

### Usage with explicit resumption

```typescript
import { createResumableStreamContext } from '@sidekickdb/resumable-stream';
import { after } from 'next/server';

const streamContext = createResumableStreamContext({
  waitUntil: after,
  appId: YOUR_INSTANT_APP_ID, // or export INSTANT_APP_ID
  adminToken: YOUR_INSTANT_APP_ADMIN_TOKEN, // or export INSTANT_APP_ADMIN_TOKEN
  apiURI: YOUR_SIDEKICK_SERVER_URL, // or export INSTANT_API_URI
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ streamId: string }> },
) {
  const { streamId } = await params;
  const stream = await streamContext.createNewResumableStream(
    streamId,
    makeTestStream,
  );
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
    },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ streamId: string }> },
) {
  const { streamId } = await params;
  const resumeAt = req.nextUrl.searchParams.get('resumeAt');
  const stream = await streamContext.resumeExistingStream(
    streamId,
    resumeAt ? parseInt(resumeAt) : undefined,
  );
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
    },
  });
}
```

# Questions?

If you have any questions, feel free to open an issue on [GitHub](https://github.com/SidekickDB/sidekick/issues).
