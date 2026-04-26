# Frenchie Configuration

## Required environment

- `FRENCHIE_API_KEY`

## Recommended MCP setup: stdio (local)

`npx @lab94/frenchie install --api-key fr_...` wires up stdio MCP for the detected agent. The installer writes the MCP config file for your agent and copies the skill files.

The generated MCP entry looks like this (JSON form, used by Claude Code / Cursor / Antigravity / Windsurf / VS Code / Gemini CLI / Claude Desktop):

```json
{
  "mcpServers": {
    "frenchie": {
      "command": "npx",
      "args": ["-y", "@lab94/frenchie@0.3.1", "mcp"],
      "env": { "FRENCHIE_API_KEY": "fr_..." }
    }
  }
}
```

TOML form (Codex, `.codex/config.toml` or `~/.codex/config.toml`):

```toml
[mcp_servers.frenchie]
command = "npx"
args = ["-y", "@lab94/frenchie@0.3.1", "mcp"]

[mcp_servers.frenchie.env]
FRENCHIE_API_KEY = "fr_..."
```

Zed uses `context_servers` instead of `mcpServers`:

```json
{
  "context_servers": {
    "frenchie": {
      "source": "custom",
      "command": "npx",
      "args": ["-y", "@lab94/frenchie@0.3.1", "mcp"],
      "env": { "FRENCHIE_API_KEY": "fr_..." }
    }
  }
}
```

The `@0.3.1` pin matches the installer's own version. `install` bakes this in automatically so the spawned server can never drift from the installer that wrote the config. If you hand-wrote a config without a version pin and see stdio returning full markdown, re-run `install` or bump your pin manually — unpinned `@lab94/frenchie` lets npx serve a stale cached bundle.

In stdio mode, agents can pass `file_path` directly. The local MCP server auto-saves results to `.frenchie/<name>/`.

## Fallback: HTTP (hosted / web agents)

For agents that can't run local npm binaries (Lovable, Manus, Claude.ai, ChatGPT.com, Le Chat):

```bash
# URL:    https://mcp.getfrenchie.dev
# Header: Authorization: Bearer fr_...
```

Example Cursor HTTP config:

```json
{
  "mcpServers": {
    "frenchie": {
      "url": "https://mcp.getfrenchie.dev",
      "headers": { "Authorization": "Bearer fr_..." }
    }
  }
}
```

In HTTP mode, local `file_path` does not work. Upload files via `upload_file` first, then use `uploaded_file_reference`.

Relevant runtime variables on the hosted MCP server (only relevant if you self-host):

- `MCP_TRANSPORT=http`
- `MCP_HTTP_ENABLED=true`
- `MCP_PORT=4100`

## Status command access

`/frenchie-status` uses backend REST endpoints and requires the same API key:

- `Authorization: Bearer fr_...`
- `GET https://api.getfrenchie.dev/balance`
- `GET https://api.getfrenchie.dev/jobs?limit=10`

## HTTP mode result handling

In HTTP mode, OCR result images are stored on the server and referenced as `frenchie-result:{objectKey}` in the markdown. Use `fetch_result_file` to get a temporary download URL, then save with curl.

Agents using HTTP mode must persist the final Markdown to `.frenchie/{name}/result.md` before concluding the task. This rule is HTTP-only because stdio mode already writes `.frenchie/...` automatically.

Download URLs expire in 15 minutes. Results are auto-deleted from the server after 30 minutes.

## Notes

- Prefer environment-based API key configuration over passing `api_key` on every tool call.
- Use `api_key` per call only when the host tool cannot inject environment variables.
