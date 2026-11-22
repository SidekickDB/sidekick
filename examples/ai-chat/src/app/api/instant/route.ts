import { createInstantRouteHandler } from '@sidekickdb/react/nextjs';

export const { POST } = createInstantRouteHandler({
  appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID!,
});
