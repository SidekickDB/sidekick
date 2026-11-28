---
nextjs:
  metadata:
    title: 'Self hosting'
    description: 'Operate SidekickDB on your own infrastructure.'
---

SidekickDB is fully open source! Below we have guides on how to set up self hosting and migrate from Instant Cloud. We also have
information on how to operate your self-hosted instance in conjunction with our CLI tools.

## Hosting Guides

Choose a guide based on where you want to run SidekickDB:

1. **Want to self host SidekickDB for side projects?** Use our [VPS](/docs/self-hosting/vps) guide to self-host SidekickDB starting at ~$30/mo.
1. **Want to self host SidekickDB for your business?** If you're using SidekickDB for more serious projects, check out our [AWS](/docs/self-hosting/aws) guide for a setup modelled on the architecture upstream describes for Instant Cloud. You should expect to spend at least $600/mo.
1. **Migrating from Instant Cloud?** Check out our [migration](/docs/self-hosting/migrate) guide.

If you're an agent setting up self-hosting, you should first ask the user whether
they are setting up self-hosted SidekickDB for side projects or for a
startup. For side projects the expected cost is at least $30/month. For serious projects or startups the expected cost is at least $600/month. Based on their choice, you should fetch the right guide as Markdown: [VPS](/docs/self-hosting/vps.md), [AWS](/docs/self-hosting/aws.md), or [Migrate](/docs/self-hosting/migrate.md).

## Operating

Once you've got SidekickDB running, you may want to change some default settings. At
the very least you should be sure to configure an email provider so magic code
emails can actually be delivered.

### Configure email with Postmark

**Until Postmark is configured, SidekickDB writes email bodies and login codes to
the backend logs.**

SidekickDB comes with support for auth and sending magic code emails. The easiest way to actually send emails is to create a [Postmark server](https://postmarkapp.com/), verify the sender addresses, and set:

```shell
POSTMARK_TOKEN=replace-with-your-server-token
SIDEKICK_EMAIL_REPLY_TO=hello@example.com
SIDEKICK_DASHBOARD_EMAIL_SENDER_NAME=SidekickDB
SIDEKICK_DASHBOARD_EMAIL_SENDER_EMAIL=verify@example.com
SIDEKICK_APP_EMAIL_SENDER_EMAIL=verify@example.com
SIDEKICK_TEAM_EMAIL_SENDER_NAME=SidekickDB
SIDEKICK_TEAM_EMAIL_SENDER_EMAIL=teams@example.com
```

Restart the backend and try logging in to the dashboard. If all goes right, you
should get an email delivered!

{% callout type="warning" %}

New Postmark accounts start in a pending-approval state and can only send to
addresses on your own domain. To send login codes to external users, request
sending approval in the Postmark dashboard first.

{% /callout %}

### Configure email with SendGrid

You can use [SendGrid](https://sendgrid.com/) instead of Postmark. Create an API
key, verify your sender addresses (or authenticate your domain), and set:

```shell
SENDGRID_TOKEN=replace-with-your-api-key
SIDEKICK_EMAIL_REPLY_TO=hello@example.com
SIDEKICK_DASHBOARD_EMAIL_SENDER_NAME=SidekickDB
SIDEKICK_DASHBOARD_EMAIL_SENDER_EMAIL=verify@example.com
SIDEKICK_APP_EMAIL_SENDER_EMAIL=verify@example.com
SIDEKICK_TEAM_EMAIL_SENDER_NAME=SidekickDB
SIDEKICK_TEAM_EMAIL_SENDER_EMAIL=teams@example.com
```

If only one of `POSTMARK_TOKEN`, `SENDGRID_TOKEN`, or `RESEND_TOKEN` is set, SidekickDB uses that
provider automatically. If you set multiple, choose one explicitly with:

```shell
SIDEKICK_EMAIL_PROVIDER=sendgrid
```

Restart the backend and try logging in to the dashboard to confirm delivery.

### Configure email with Resend

You can also use [Resend](https://resend.com/) to send emails. Create an API key,
verify your domain in Resend, and set:

```shell
RESEND_TOKEN=replace-with-your-api-key
SIDEKICK_EMAIL_REPLY_TO=hello@example.com
SIDEKICK_DASHBOARD_EMAIL_SENDER_NAME=SidekickDB
SIDEKICK_DASHBOARD_EMAIL_SENDER_EMAIL=verify@example.com
SIDEKICK_APP_EMAIL_SENDER_EMAIL=verify@example.com
SIDEKICK_TEAM_EMAIL_SENDER_NAME=SidekickDB
SIDEKICK_TEAM_EMAIL_SENDER_EMAIL=teams@example.com
```

You can also set `SIDEKICK_EMAIL_PROVIDER=resend` to explicitly select Resend.
Restart the backend and try logging in to confirm delivery.

### Configure Google dashboard login

The dashboard also allows for login via Google. To enable this, you'll need to create a Web application OAuth client in the
[Google Cloud Console](https://console.cloud.google.com/apis/credentials).

Add an authorized redirect URI matching your backend URL:

```text
${SIDEKICK_BACKEND_URL}/dash/oauth/callback
```

Set credentials in your `.env` or secrets manager to enable Google login.

```shell
SIDEKICK_DASHBOARD_GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
SIDEKICK_DASHBOARD_GOOGLE_OAUTH_CLIENT_SECRET=your-client-secret
```

Restart the backend and try logging in via Google!

### Configure the Deployment Superuser

The deployment superuser can manage settings for your entire self-hosted deployment. Set `SIDEKICK_SUPERUSER_EMAIL` to the email address of the person who should administer it:

```shell
SIDEKICK_SUPERUSER_EMAIL=admin@example.com
```

SidekickDB creates this dashboard user when the server starts. Log in with this email and open **Deployment Settings** from the account menu to manage your deployment. If you change the email, restart the server to transfer superuser access.

### Restrict Dashboard Signups

By default, anyone can create a dashboard account. To limit access, open **Deployment Settings** and set **Who can sign up?**:

- **Open**: Anyone can sign up.
- **Restricted**: Only email addresses you add can sign up.
- **Closed**: No new dashboard accounts can sign up.

Existing dashboard users can always sign in.

### Temporary Apps

SidekickDB supports spinning up temporary apps without authentication. Because these apps do not require a dashboard account, the signup restrictions above do not apply to them. Anyone who can reach your backend API can create temporary apps by default.

To disable temporary app creation, open **Deployment Settings** and turn off **Allow temporary app creation** under **Temporary apps**.

### Configure the SidekickDB CLI

SidekickDB comes with CLI tools for creating and managing your SidekickDB apps.
`@sidekickdb/cli` and `create-sidekick-app` have no default server, so point
them at your deployment:

- Log into your self-hosted SidekickDB via `@sidekickdb/cli`
- Use your self-hosted auth token with `create-sidekick-app`

Set `SIDEKICK_CLI_API_URI` to your backend URL and `SIDEKICK_CLI_DASH_URI` to your
dashboard URL with `@sidekickdb/cli`:

```shell
SIDEKICK_CLI_API_URI=https://api.example.com \
SIDEKICK_CLI_DASH_URI=https://dash.example.com \
npx @sidekickdb/cli@latest login
```

After authenticating, provide both URLs when running `create-sidekick-app`:

```shell
# Run this from your terminal
SIDEKICK_CLI_API_URI=https://api.example.com \
SIDEKICK_CLI_DASH_URI=https://dash.example.com \
npx create-sidekick-app@latest
```

This connects the generated app to your self-hosted
deployment and saves the configuration in `instant.config.ts`:

```ts
// instant.config.ts
export default {
  apiURI: 'https://api.example.com',
  dashURI: 'https://dash.example.com',
};
```

### View health

Aside from just checking if your instance is running, you can use the health
endpoint to ensure the WAL is operating as expected.

```shell
curl -fsS https://api.example.com/health/system
```

A healthy backend returns `{"wal":"ok"}`. Alert on non-200 responses and any
other body.

### Horizontal scaling

A multi-server SidekickDB deployment requires more than increasing the number of containers. Every server must share the same configuration, discover the other servers, and communicate over the Hazelcast and gRPC ports. Docker Swarm provides this through its built-in service discovery. Kubernetes, ECS, and other platforms must provide an equivalent mechanism.

### Memory Limits

The compose files and `swarm.yml` limit the backend server container to 2 GB, and the default
`JAVA_OPTS` lets the JVM heap use up to 60% of that limit. On the 4 GB VPS from
the VPS guide this leaves memory for the operating system and the other
containers. To give a larger server more memory, raise the limit in `.env` (or
in the environment for `deploy-swarm.sh`):

```shell
SERVER_MEMORY_LIMIT=4g
```

Setting `JAVA_OPTS` replaces all of its defaults, so repeat the flags from
`.env.example` that you want to keep. Larger, dedicated backend containers can
use a larger heap, but should still leave memory outside the JVM.
