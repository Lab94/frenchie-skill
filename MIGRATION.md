# Upgrading Frenchie

> Latest web version with cross-links to troubleshooting and agent guides: [getfrenchie.dev/docs/migrate](https://getfrenchie.dev/docs/migrate). This file ships inside the npm tarball and is kept in sync at publish time.

> Upgrading from 0.1.x, 0.2.x, 0.3.0, 0.3.1, or 0.3.2? Follow the matching section below, in order. Each section is self-contained — do the steps in order and you'll be back on the happy path.

## 0.3.2 → 0.4.0

0.4.0 adds image generation and moves all tool responses onto the shared `result` envelope:

1. **`generate_image` MCP tool and `/generate-image` command.** Agents can now generate PNG/JPEG/WebP images from a prompt. Stdio saves the image locally under `.frenchie/<slug>/generated.<ext>`; HTTP returns a temporary download URL.
2. **Shared result envelope.** OCR, transcription, and image generation now return `{ status, jobId, creditsUsed, resultExpiresAt, result }`. Code that read top-level `markdown`, `savedTo`, or `imageUrl` should branch on `result.kind` instead.
3. **Updated registry metadata.** `server.json`, the static MCP server card, and Smithery metadata now advertise OCR, transcription, and image generation together.

### Upgrade steps

```bash
cd <your project>
npx @lab94/frenchie@latest install
```

Restart your agent after `install` finishes. If you hand-wrote or pinned your MCP config, update the package spec to `@lab94/frenchie@0.4.0` or re-run `install` and let the installer write it.

---

## 0.3.1 → 0.3.2

0.3.2 ships two unrelated improvements:

1. **`install` reuses your existing API key.** Re-running `install` no longer requires `--api-key` — the installer reads `FRENCHIE_API_KEY` from your current MCP config and rewrites the file with the same key. Matters because Frenchie keys are shown only once at creation, so "paste it again" is a dead end if you lost the plaintext. You can still pass `--api-key fr_new_key` to rotate.
2. **npm package metadata no longer leaks the private GitHub repo.** `repository` is dropped and `bugs` now points to `getfrenchie.dev/docs/troubleshooting`. No behavior change — just a cleaner `npmjs.com/package/@lab94/frenchie` page, and "Report issues" lands on the symptom-first fix guide instead of a 404.

### Upgrade steps

```bash
cd <your project>
npx @lab94/frenchie@latest install
```

No `--api-key` needed if you already have Frenchie configured. Restart your agent after `install` finishes.

---

## 0.3.0 → 0.3.1 (critical fix)

0.3.0 moved stdio tool responses to metadata-only so agents read `.frenchie/<name>/result.md` instead of burning context on inline markdown. That contract was silently broken for any user whose `npx` cache held an older `@lab94/frenchie` bundle — `install` ran 0.3.0, but the MCP config's unpinned `"args": ["-y", "@lab94/frenchie", "mcp"]` let npx keep spawning the cached 0.2.x server. Agents saw the full 25k-token markdown dump, not the promised ~200-token response.

0.3.1 pins the package spec in every MCP config the installer writes: `["-y", "@lab94/frenchie@0.3.1", "mcp"]`. The spawned server version is now locked to whatever the installer shipped with.

### Upgrade steps

```bash
cd <your project>
npx @lab94/frenchie@latest install --api-key fr_your_key_here
```

Pass `--api-key` again on 0.3.1 — the installer doesn't yet reuse the key from your existing MCP config (that's coming in 0.3.2). Restart your agent after `install` finishes. The next OCR/transcription call should return metadata only (a short "Saved to …" note), not inline markdown.

### If you hand-wrote your MCP config

Change `"args": ["-y", "@lab94/frenchie", "mcp"]` to `"args": ["-y", "@lab94/frenchie@0.3.1", "mcp"]` — or re-run `install` and let the installer do it.

### Verifying the fix

Call `/ocr` or `/transcribe` on a small file. A correct 0.3.1 stdio response looks like:

```json
{
  "status": "done",
  "savedTo": ".frenchie/<name>/result.md",
  "wordCount": 1234,
  "imageCount": 0,
  "creditsUsed": 2,
  "resultExpiresAt": "..."
}
```

No `markdown` field. If you still see `"markdown": "..."` in the response, your agent is spawning a cached 0.2.x bundle — clear the npx cache (`rm -rf ~/.npm/_npx`) and re-run `install`.

---

## 0.2.x → 0.3.0

Frenchie 0.3.0 ships three changes that may affect existing installs:

1. **Stdio tool responses now return metadata only, not full markdown.** The server still writes `.frenchie/<name>/result.md` to disk as before — the response just stops re-sending the markdown inline. Your agent reads the file if it needs the content. This cuts tool responses from ~25k tokens to ~200 tokens on a 17-page PDF.
2. **MCP configs now bake in absolute paths.** `install` writes the absolute path to `npx` into `command`, plus a scoped `PATH` into `env`. This makes stdio MCP spawn correctly under GUI-launched agents (Antigravity, Claude Desktop, Windsurf, Zed) that don't inherit shell `PATH`.
3. **`mcp --help` / `--version` / `--selftest` subcommand flags.** The bundled stdio server no longer hangs when an agent preflights it with `--help`. Good news for VS Code Copilot and any future agent that validates before wiring up MCP.

### Upgrade steps

```bash
cd <your project>
npx @lab94/frenchie@latest install --api-key fr_your_key_here
```

That's the whole happy path. The installer will detect your agent markers and overwrite the stale `command: "npx"` entries with the new absolute-path form. You then need to restart the agent.

### If you pinned the version

If you have `@lab94/frenchie@0.2.x` hard-coded anywhere (CI, Dockerfile, other repos), bump to `^0.3.0` so the new stdio behavior takes effect.

### If you wrote MCP config by hand

Re-run `install --api-key ...` once per project and per user-level agent. Hand-written `command: "npx"` configs will keep working on terminal-launched agents, but fail on GUI-launched ones. The installer fix is the path forward.

---

## 0.1.x → 0.2.0

Frenchie 0.2.0 made stdio the primary integration path. Local coding agents now spawn a local stdio MCP server via `npx @lab94/frenchie mcp` instead of connecting to `mcp.getfrenchie.dev` over HTTP. HTTP remains available for hosted/web agents.

If you're upgrading from 0.1.x, follow these steps in order:

### 1. Remove the old HTTP MCP entry

**Claude Code:**

```bash
claude mcp list                      # check scope — likely "local" or "user"
claude mcp remove frenchie -s local  # or -s user / -s project as needed
```

**Cursor:** edit `~/.cursor/mcp.json` and remove the `frenchie` block with `"url": "https://mcp.getfrenchie.dev"`.

**Codex:** edit `~/.codex/config.toml` and remove any `[mcp_servers.frenchie]` block that uses `url = "..."` rather than `command = "npx"`.

### 2. Re-install with --api-key

```bash
cd <your project>
npx @lab94/frenchie@latest install --api-key fr_your_key_here
```

This writes project-scoped stdio MCP configs for every agent marker found in the project (Claude Code / Cursor / Codex / VS Code / Gemini CLI / Windsurf / Zed).

For user-level installs (Windsurf, Zed, Claude Desktop), add `--global`.

### 3. Restart your agent

Fully quit and reopen. A reload-window is not always enough — MCP subprocesses persist across soft reloads.

### 4. Verify

**Claude Code:**

```bash
claude mcp list
```

Should show:

```
frenchie: /usr/local/bin/npx -y @lab94/frenchie mcp (stdio)
```

Not:

```
frenchie: https://mcp.getfrenchie.dev (HTTP)
```

---

## Troubleshooting

### Agent still uploads + curl PUTs files after upgrade

Old HTTP entry in user/local scope is shadowing the new project entry. Claude Code's precedence is **local > project > user** — so even a correctly-written project `.mcp.json` gets ignored if a leftover HTTP entry exists at a higher-priority scope.

Fix: `claude mcp remove frenchie -s local` (and `-s user` if needed), then re-install.

### Codex Desktop shows "Auth unsupported" for frenchie

Informational — stdio servers with env-var auth don't have a UI control in Codex Desktop. Server still works. Invoke via `@frenchie`, `/frenchie`, or natural language ("OCR TOR.pdf with Frenchie") — `/ocr` is Claude Code-only.

### `/ocr` doesn't work in my agent

Expected. `/ocr` is a Claude Code-only slash command. In other agents:

- **Codex (Desktop / CLI / IDE):** `@frenchie`, `/frenchie`, or natural language.
- **Antigravity:** `/frenchie <file>` (Antigravity invokes MCP servers by their server name, not skill names).
- **VS Code Copilot:** `/frenchie <file>` once the server is registered.
- **Cursor / Claude Desktop / Windsurf:** natural language.

### "MCP server does not exist: frenchie" (Cursor)

Dogfood-reproduced: Cursor has surfaced cases where a newly-installed MCP server is disabled by default in the agent's settings, even though the config file was written correctly. Open `Settings → MCP`, find `frenchie`, toggle it on. Then restart Cursor.

### "exec: npx not found" or "env: node: No such file or directory"

GUI-launched agents (Antigravity, Claude Desktop, etc.) don't inherit your shell's `PATH`. 0.3.0 fixes this automatically — re-run `install --api-key ...` to pick up the absolute-path form. If you hand-wrote your config, replace `"command": "npx"` with `"command": "/absolute/path/to/npx"` (find it with `which npx`), and add a `PATH` key to the `env` block that includes your Node install dir.

### `npx @lab94/frenchie mcp --help` hangs

Known gap in 0.1.x and 0.2.x (fixed in 0.3.0). Upgrade with `npm install -g @lab94/frenchie@latest`, or wait for the fix to ship through your agent's auto-install path.

---

For more symptom-first fixes, see the [troubleshooting guide](https://getfrenchie.dev/docs/troubleshooting). Full upgrade guide at [getfrenchie.dev/docs/migrate](https://getfrenchie.dev/docs/migrate). Full docs at [getfrenchie.dev/docs](https://getfrenchie.dev/docs).
