export default {
  title:
    "Dashboard decoupled from Instant services",
  resolve:
    "Keep the removals. If upstream changed a file SidekickDB deleted, keep it deleted. If upstream " +
    "re-introduces the font (stopaio.s3.amazonaws.com), the star count, the feedback app or the chat, drop " +
    "that part. Keep loadStripe from @stripe/stripe-js/pure (loaded only at checkout) and the self-hosted " +
    "billing/Google-login conditions, the narrow public/ copy in client/Dockerfile.www and the self-hosted " +
    "allowlist in next.config.js (add a public file there only if the dashboard or the docs load it). " +
    "Keep the local Monaco assets (scripts/copy-editor-assets.mjs, lib/monacoLoader.ts, public/monaco in the image and " +
    "in selfHostedStaticDirs), NEXT_PUBLIC_GOOGLE_ANALYTICS_ID with no default and the self-hosted gates in the docs; " +
    "a new CDN, font or analytics load becomes local or hosted-only (__tests__/self-hosted-network.test.tsx). " +
    "Take upstream's other changes in these files.",
};
