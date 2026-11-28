---
nextjs:
  metadata:
    title: 'Using SidekickDB with LLMs'
    description: 'How to use SidekickDB with LLMs'
---

You can supercharge your Instant experience by using it with LLMs. Just add our Instant rules and you're off to the races!

## Instant Skill

The fastest way to add rules to your LLM tool is to add the Instant skill.

```text {% showCopy="true" %}
npx skills add instantdb/skills
```

This will give your agent the context it needs to work with InstantDB.

You can verify you set up the rules correctly by asking your LLM "How do you
make queries and transactions in InstantDB?" If everything is set up correctly,
you should see a response with information about `db.useQuery` and `db.transact`.

If you'd prefer to manually install the rules instead, see the section below.

## Instant Rules

We've created a set of rules to help LLMs understand how Instant works. If you
start a new project with `create-sidekick-app` you'll get these rules
automatically. If you have an existing project you can add the rules manually.

[Save these rules](/llm-rules/AGENTS.md) at the root of your project as:

- `CLAUDE.md` for Claude Code
- `GEMINI.md` for Gemini
- `AGENTS.md` for Codex, Cursor, Windsurf, Zed, and other tools

You may need to restart your editor for the rules to take effect.

### Markdown Docs and llms.txt

You can attach `.md` to the end of any doc page URL to get raw Markdown. This can be helpful to paste into your LLM if you're stuck on
particular functionality. For example, here are the recommended docs for [adding auth](/docs/auth/magic-codes.md).

We recommend starting with the rules files above and adding more docs as needed.
If you want though you can get all our docs at once in markdown format via
[llms-full.txt](https://sidekickdb.co/llms-full.txt)

## SidekickDB MCP Server

We built [`@sidekickdb/mcp`](https://github.com/SidekickDB/sidekick/tree/main/client/packages/mcp) to enable creating, managing, and updating your SidekickDB apps.
Combine the MCP with our rules file to build full-stack apps directly in your editor.

The MCP server runs locally via `stdio` and talks to your SidekickDB server
with your personal access token. It is not published to npm, so you run it
from a checkout of the SidekickDB repository.

### Build the MCP server

```shell {% showCopy="true" %}
git clone https://github.com/SidekickDB/sidekick.git
cd sidekick/client
pnpm install
pnpm build-packages
```

This builds the server to `client/packages/mcp/dist/index.js` in your checkout.
The examples below use `/path/to/sidekick` for the checkout: replace it with
where you cloned the repository.

### Get your Personal Access Token

If you haven't already, make sure to get a personal access token from your
[dashboard](/dash?s=personal-access-tokens).

Once you have your token, you can set up the SidekickDB MCP server in your
favorite editor with MCP support. In every example, replace `<token>` with your
personal access token and `https://sidekick.example.com` with your SidekickDB
server's URL.

### Cursor/Windsurf/Cline

You can set up the SidekickDB MCP server in Cursor, Windsurf, or Cline by adding
the following configuration to your MCP settings:

```json {% showCopy="true" %}
{
  "mcpServers": {
    "instant": {
      "command": "node",
      "args": [
        "/path/to/sidekick/client/packages/mcp/dist/index.js",
        "--token",
        "<token>",
        "--api-url",
        "https://sidekick.example.com"
      ]
    }
  }
}
```

On Windows, use the Windows path to `index.js`. Save the file and reload the
editor! You should now see the SidekickDB MCP server active and enabled!

### Zed

Open your Zed settings and add the following:

```json {% showCopy="true" %}
{
  "context_servers": {
    "instant": {
      "command": {
        "path": "node",
        "args": [
          "/path/to/sidekick/client/packages/mcp/dist/index.js",
          "--token",
          "<token>",
          "--api-url",
          "https://sidekick.example.com"
        ],
        "env": {}
      },
      "settings": {}
    }
  }
}
```

Save the file and reload the editor. You should now see the SidekickDB MCP
server active and enabled!

### Claude Desktop

You can set up the SidekickDB MCP server in Claude Desktop by following these
steps:

1. Open the file `~/Library/Application Support/Claude/claude_desktop_config.json`
2. Add the following configuration to the `claude_desktop_config.json` file:

```json {% showCopy="true" %}
{
  "mcpServers": {
    "instant": {
      "command": "node",
      "args": [
        "/path/to/sidekick/client/packages/mcp/dist/index.js",
        "--token",
        "<token>",
        "--api-url",
        "https://sidekick.example.com"
      ]
    }
  }
}
```

Save the file and restart Claude Desktop. You should now see the SidekickDB MCP
server active and enabled!

## MCP Tools

Below is a list of the current tools we expose:

- `learn` Fetch rules files if needed to help the LLM understand InstantDB.
- `get-schema` Retrieves the schema for a specific app.
- `get-perms` Retrieves permission rules for an app.
- `push-schema` Applies schema changes to an app.
- `push-perms` Updates permission rules for an app.
