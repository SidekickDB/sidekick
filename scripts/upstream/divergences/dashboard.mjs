export default {
  title:
    "Dashboard decoupled from Instant services (Berkeley Mono, star count, docs feedback/AI chat/GitHub webhook removed; self-hosted: no Stripe.js, billing hidden, image serves only the dashboard, docs and admin tools)",
  resolve:
    "Keep the removals. If upstream changed a file SidekickDB deleted, keep it deleted. If upstream " +
    "re-introduces the font (stopaio.s3.amazonaws.com), the star count, the feedback app or the chat, drop " +
    "that part. Keep loadStripe from @stripe/stripe-js/pure (loaded only at checkout) and the self-hosted " +
    "billing/Google-login conditions, the narrow public/ copy in client/Dockerfile.www and the self-hosted " +
    "allowlist in next.config.js (add a public file there only if the dashboard loads it). Take upstream's " +
    "other changes in these files.",
};
