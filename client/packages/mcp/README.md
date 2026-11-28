<!-- SidekickDB: plain-text header in place of upstream's logo, badges and links. -->

# @sidekickdb/mcp

Part of [SidekickDB](https://github.com/SidekickDB/sidekick), an independent continuation of the Apache-2.0 InstantDB code. It is not affiliated with or endorsed by Instant.

Welcome to SidekickDB's MCP server.

This MCP is a wrapper around the SidekickDB Platform SDK. Add this MCP to your
editor to enable creating, managing, and updating your SidekickDB apps.

The package is not published to npm and there is no hosted server: you build
it from a checkout of this repository and run it locally over `stdio` against
your own SidekickDB server. Its `learn` tool returns the agent rules file that
ships with the version you built.

## Local MCP server

Get a personal access token from your SidekickDB dashboard
(`/dash?s=personal-access-tokens` on your dashboard's host).

Build the server from the repository's `client` directory:

```bash
pnpm install
pnpm build-packages
```

Then run `node client/packages/mcp/dist/index.js --token <token> --api-url <your-sidekick-server-url>` (or set `INSTANT_API_URL`). The server URL is required: there is no default server.

For editor-specific instructions, see `client/www/app/docs/using-llms/page.md`
in this repository.

# Contributing

## Quick Start

Use the MCP Inspector `@modelcontextprotocol/inspector` to debug and
develop against this server locally.

```bash
# From client/packages/mcp, after building as above
npx @modelcontextprotocol/inspector node ./dist/index.js --token <token> --api-url http://localhost:8888

# Or alternatively via environment variables
INSTANT_ACCESS_TOKEN=<token> INSTANT_API_URL=http://localhost:8888 npx @modelcontextprotocol/inspector node ./dist/index.js
```

If you're using Claude Code you can add the mcp server directly after building:

```bash
claude mcp add --transport stdio sidekick-local -- node <path-to-your-checkout>/client/packages/mcp/dist/index.js --token <token> --api-url http://localhost:8888
```

You can then remove the server directly:

```bash
claude mcp remove sidekick-local
```

You can also configure your editor to connect to your local MCP. Here's an example configuration for MacOS/Linux:

```json
{
  "mcpServers": {
    "instant": {
      "command": "node",
      "args": [
        "<path-to-your-checkout>/client/packages/mcp/dist/index.js",
        "--token",
        "<token>",
        "--api-url",
        "http://localhost:8888"
      ]
    }
  }
}
```

### HTTP mode

The HTTP mode with OAuth is upstream's hosted setup. SidekickDB does not run
it; it needs `INSTANT_API_URL` and the settings in `.env.example`.

```bash
cp .env.example .env
```

Fill in all of the environment variables for your new `.env` file, add
`INSTANT_API_URL` and set `SERVER_TYPE=http`. Then build and start it from
`client/packages/mcp`:

```bash
pnpm run build
node dist/index.js
```

It listens on port 3123 (set `PORT` to change it). Without `SERVER_TYPE=http`
the server runs over `stdio`.

`pnpm run dev` only recompiles on change (`tsc --watch`, into `dist/esm`); it
does not start a server.
