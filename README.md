[![Frenchie — your agent's best friend.](https://getfrenchie.dev/brand/frenchie-readme-wordmark.svg)](https://getfrenchie.dev)

# @lab94/frenchie

**Frenchie — your agent's best friend.**

Install Frenchie in your coding agent with one command. Read PDFs and images, transcribe audio and video, and generate images from text prompts — no plumbing required.

> **Upgrading from 0.1.x or 0.2.x?** See [MIGRATION.md](./MIGRATION.md) for the breaking changes in 0.3.0 (stdio metadata-only responses, absolute-path MCP configs, new `mcp --help` / `--selftest` flags).

This package ships:

- The Frenchie **skill pack** (`/ocr`, `/transcribe`, `/generate-image`, `/frenchie-status` commands + HTTP/stdio guidance for agents)
- The Frenchie **stdio MCP server** (`lab94-frenchie mcp`) bundled for `npx`
- An **installer** that wires both into your agent's config file

## Quick start

### 1. Create an account and copy your API key

Create an account at [getfrenchie.dev](https://getfrenchie.dev). You get **100 free credits on your first signup, once per email**. No card required.

Then create an API key in the dashboard. It looks like this:

```text
fr_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4
```

### 2. Install Frenchie with one command

From the root of your project:

```bash
npx @lab94/frenchie install --api-key fr_your_key_here
```

The installer auto-detects your agent, copies the skill files, and writes a project-scoped MCP config so your agent can call `ocr_to_markdown`, `transcribe_to_markdown`, or `generate_image`. OCR/transcription results are saved to `.frenchie/<name>/result.md` automatically; generated images are saved to `.frenchie/<slug>/generated.<ext>`.

To target a specific agent:

```bash
npx @lab94/frenchie install --agent claude   --api-key fr_…
npx @lab94/frenchie install --agent cursor   --api-key fr_…
npx @lab94/frenchie install --agent codex    --api-key fr_…
npx @lab94/frenchie install --agent vscode   --api-key fr_…
npx @lab94/frenchie install --agent gemini   --api-key fr_…
```

User-level installs (Antigravity, Windsurf, Zed, Claude Desktop) need the `--global` flag:

```bash
npx @lab94/frenchie install --agent antigravity   --global --api-key fr_…
npx @lab94/frenchie install --agent windsurf       --global --api-key fr_…
npx @lab94/frenchie install --agent zed            --global --api-key fr_…
npx @lab94/frenchie install --agent claude-desktop --global --api-key fr_…
```

### 3. Restart your agent

The installer prints the restart hint for your agent. After that, ask:

```
OCR ./report.pdf with Frenchie
```

…and Frenchie takes it from there.

## Hosted agents (Lovable, Manus, Claude.ai, ChatGPT.com, Le Chat)

These agents can't run local npm binaries. Use the hosted MCP endpoint instead:

```
URL:    https://mcp.getfrenchie.dev
Header: Authorization: Bearer fr_your_key_here
```

The same `@lab94/frenchie` skill files work in HTTP mode — install them once with `install --agent <name>` and the included SKILL.md will tell the agent to upload files via `upload_file` before calling OCR/transcription. Image generation does not need an upload step in HTTP mode; it returns a short-lived `imageUrl` that the agent should download for the user.

## What you get

| Command | What it does |
|---------|-------------|
| `/ocr <file>` | Parse a PDF or image into Markdown |
| `/transcribe <file>` | Parse audio or video into a Markdown transcript |
| `/generate-image <prompt>` | Generate a single image from a text prompt |
| `/frenchie-status` | Check credits and recent jobs |

Under the hood, Frenchie exposes these MCP tools:

- `ocr_to_markdown`
- `transcribe_to_markdown`
- `generate_image`
- `get_job_result`
- `upload_file` (HTTP mode only)
- `fetch_result_file` (HTTP mode only)

## Invocation — how to call Frenchie in each agent

Every agent handles MCP a little differently. `/ocr` is a Claude Code-only slash command; other agents use natural language, `@`-mention, or a server-name slash command. All facts below are dogfood-verified.

| Agent | Invoke | Full guide |
|-------|--------|------------|
| Claude Code | `/ocr TOR.pdf` | [docs](https://getfrenchie.dev/docs/tools/claude-code) |
| Cursor | `Use Frenchie to OCR TOR.pdf` | [docs](https://getfrenchie.dev/docs/tools/cursor) |
| Codex (Desktop / CLI / IDE) | `/frenchie TOR.pdf` · `@frenchie ocr TOR.pdf` · natural language | [docs](https://getfrenchie.dev/docs/tools/codex) |
| Antigravity | `/frenchie TOR.pdf` (invokes by server name) | [docs](https://getfrenchie.dev/docs/tools/antigravity) |
| VS Code Copilot | `/frenchie TOR.pdf` | [docs](https://getfrenchie.dev/docs/tools/vscode) |
| Claude Desktop | `Use Frenchie to OCR TOR.pdf` | [docs](https://getfrenchie.dev/docs/tools/claude-desktop) |
| Windsurf | `OCR TOR.pdf via Frenchie` | [docs](https://getfrenchie.dev/docs/tools/windsurf) |
| Gemini CLI | `OCR TOR.pdf with Frenchie` | [docs](https://getfrenchie.dev/docs/tools/gemini-cli) |
| Zed | `OCR TOR.pdf via Frenchie` | [docs](https://getfrenchie.dev/docs/tools/zed) |

Something not working? See the [symptom-first troubleshooting guide](https://getfrenchie.dev/docs/troubleshooting) — every error we've hit in dogfood has a canonical entry.

## Pricing

Simple numbers. No subscriptions.

| Action | Cost |
|--------|------|
| OCR | 1 credit per page |
| Transcription | 2 credits per minute |
| Image generation | 20 credits per image |

**$1 = 100 credits.** Credits don't expire.

## Privacy

Files are processed and deleted. Results expire about 30 minutes after first delivery. If you need a durable copy, save the Markdown when it comes back.

## Supported formats

**OCR:** PDF, PNG, JPG, JPEG, WebP

**Transcription:** MP3, M4A, WAV, MP4, MOV, WebM

**Image generation:** PNG, JPEG, WebP output from text prompts

## Need help?

- [Docs](https://getfrenchie.dev/docs)
- [Dashboard](https://getfrenchie.dev/dashboard)
- [LAB94](https://lab94.io)
- [support@getfrenchie.dev](mailto:support@getfrenchie.dev)
