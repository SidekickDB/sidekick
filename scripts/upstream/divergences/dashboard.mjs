export default {
  title:
    "Dashboard decoupled from Instant services (Berkeley Mono, star count, docs feedback/AI chat/GitHub webhook removed; self-hosted: no Stripe.js, billing hidden; editor and its types served locally, analytics id from env, no outside loads)",
  resolve:
    "Keep the removals. If upstream changed a file SidekickDB deleted, keep it deleted. If upstream " +
    "re-introduces the font (stopaio.s3.amazonaws.com), the star count, the feedback app or the chat, drop " +
    "that part. Keep loadStripe from @stripe/stripe-js/pure (loaded only at checkout) and the self-hosted " +
    "billing/Google-login conditions. Keep the local Monaco assets (scripts/copy-editor-assets.mjs, lib/monacoLoader.ts), " +
    "NEXT_PUBLIC_GOOGLE_ANALYTICS_ID with no default and the self-hosted gates in the docs; a new CDN, font or analytics " +
    "load becomes local or hosted-only (__tests__/self-hosted-network.test.tsx). Take upstream's other changes in these files.",
};
