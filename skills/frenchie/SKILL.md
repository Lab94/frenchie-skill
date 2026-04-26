---
name: frenchie
description: MCP-first multimodal utility that makes agents more capable. Today — OCR (PDF/images → Markdown), transcription (audio/video → Markdown), and image generation (text → PNG). Next — file extraction (Excel → Markdown) and Markdown-to-file generation.
---

# Frenchie — Your Agent's Best Friend

Frenchie is an MCP-first multimodal utility that expands what agents can do. When installed via `npx @lab94/frenchie install`, Frenchie runs as a local stdio MCP server and results are auto-saved to `.frenchie/<name>/`. Hosted/web agents connect over HTTP at `https://mcp.getfrenchie.dev` — both transports are supported.

**Shipping today:** OCR for PDFs and images, transcription for audio and video, and image generation from text prompts.
**Rolling out next:** file extraction (Excel → Markdown) and Markdown-to-file generation (Word, Excel). New tools appear in this skill as they launch.

## MCP Tools

Use the Frenchie MCP server. Never call model provider APIs directly.

| Tool | Purpose | Input |
|------|---------|-------|
| `ocr_to_markdown` | PDF/Image to Markdown | `file_path` (stdio) or `uploaded_file_reference` (HTTP) |
| `transcribe_to_markdown` | Audio/Video to Markdown | `file_path` (stdio) or `uploaded_file_reference` (HTTP) |
| `generate_image` | Text prompt to image | `prompt`, optional `style`/`size`/`quality`/`format`/`background`/`output_dir` |
| `get_job_result` | Poll async job result | `job_id` |
| `upload_file` | Get presigned upload URL (HTTP only) | `filename`, `file_size`, `mime_type` |
| `fetch_result_file` | Download result image (HTTP only) | `object_key` |

All tools accept optional `api_key` (only needed if `FRENCHIE_API_KEY` is not already set).

## File Access by Transport Mode

- **stdio** (default when installed locally): the MCP server runs on the same machine, so `file_path` works with absolute local paths. Results are auto-saved to `.frenchie/<name>/` next to the source file.
- **HTTP** (hosted agents): the MCP server runs remotely, so local file paths do not exist on the server. NEVER send `file_path` over HTTP. Upload first, then use `uploaded_file_reference`.

Hard rule: if the MCP server is configured with `url` or `serverUrl`, NEVER send `file_path`. `file_path` is only valid for local stdio MCP.
Hard rule: HTTP mode MUST persist the final Markdown to `.frenchie/{name}/result.md` before concluding the task. This rule is HTTP-only because stdio mode already writes `.frenchie/...` automatically.
Hard rule: in stdio mode the tool response returns **metadata only** (`savedTo`, `wordCount`, `imageCount`) — no inline markdown. If you need the content, call your own file-reading tool on `savedTo`. Do NOT call `ocr_to_markdown` / `transcribe_to_markdown` again expecting the markdown inline; re-processing will just burn more credits.

### HTTP upload flow (use `upload_file` tool)

1. Call the `upload_file` MCP tool with `filename`, `file_size` (bytes), and `mime_type`
2. The tool returns `upload_url`, `object_key`, and `expires_in`
3. PUT the file to `upload_url` with the correct `Content-Type` header (e.g. via `curl -X PUT -H "Content-Type: application/pdf" -T file.pdf "<upload_url>"`)
4. Pass `object_key` as `uploaded_file_reference` to `ocr_to_markdown` or `transcribe_to_markdown`

## OCR Workflow

1. **HTTP:** NEVER send `file_path`. Upload first, then call `ocr_to_markdown` with `uploaded_file_reference`
   **stdio:** call `ocr_to_markdown` with `file_path` (absolute path to local file)
2. If `status: "done"` in HTTP mode — persist the final Markdown to `.frenchie/{name}/result.md` before concluding the task
3. If `status: "done"` in stdio mode — the server has already written `.frenchie/<name>/result.md`. The response contains `savedTo`, `wordCount`, and `imageCount` — read the file with your own file tool only if the task needs the content
4. If `status: "processing"` — store `jobId`, then poll with `get_job_result`

Supported formats: PDF, PNG, JPG/JPEG, WebP

## Transcription Workflow

1. **HTTP:** NEVER send `file_path`. Upload first, then call `transcribe_to_markdown` with `uploaded_file_reference`
   **stdio:** call `transcribe_to_markdown` with `file_path` (absolute path to local file)
   If the user already told you the language, also pass `language` as an ISO 639-1 code.
2. If `status: "done"` in HTTP mode — persist the final Markdown to `.frenchie/{name}/result.md` before concluding the task
3. If `status: "done"` in stdio mode — the server has already written `.frenchie/<name>/result.md`. The response contains `savedTo` + metadata; read the file yourself only if the task needs the transcript content
4. If `status: "processing"` — store `jobId`, then poll with `get_job_result`

Supported formats: MP3, WAV, M4A, MP4, MOV, WebM

## Image Generation Workflow

1. Call `generate_image` with `prompt` (required). Optional inputs: `style`, `size`, `quality`, `format`, `background`, `output_dir`.
2. In **stdio mode**, pass `output_dir` with the absolute path of your current workspace root so the image lands in `.frenchie/<slug>/generated.<ext>` next to your work. Omit it only if you know the MCP server's process cwd already equals the workspace (Claude Code, Cursor, and most CLI agents do; Claude Desktop and other GUI agents do not — they spawn with `$HOME` as cwd and the image ends up in the wrong place).
3. If `status: "done"` in **stdio mode** — the server already saved the image to `.frenchie/<slug>/generated.<ext>`. The response includes `savedTo`. Tell the user the file path so they can open it.
4. If `status: "done"` in **HTTP mode** — the response includes a presigned `imageUrl` (expires in 30 minutes). You MUST download the image to the user's machine (or render it inline if the agent UI supports that) before concluding the task. Do not just hand the user a URL. `output_dir` is ignored in HTTP mode.
5. If `status: "processing"` — store `jobId`, then poll with `get_job_result`. The original `output_dir` is remembered internally for that job.

Pricing: 20 credits per image (refunded automatically on failure).
Rate limits: 50 images / hour, 250 images / day per user.

Hard rule: v1 generates exactly one image per call. To produce multiple variants, call the tool again.
Hard rule: HTTP mode is not done until the image is on the user's machine. The presigned URL expires in 30 minutes and the underlying object is deleted shortly after.

## Async Follow-up

When a tool returns `status: "processing"`:

1. Note the `jobId` and optional `estimatedCompletion` timestamp
2. Call `get_job_result` with the `job_id`
3. If still running — wait and retry
4. If done — return the Markdown
5. If expired — inform user that the result payload is no longer available

## Saving Results Locally (HTTP Mode)

In HTTP mode, the final Markdown is not durable until the agent writes it locally. OCR images are stored on the server and the markdown may contain `frenchie-result:` references instead of local paths.

HTTP mode MUST persist the final Markdown to `.frenchie/{name}/result.md` before concluding the task. Do not tell the user the job is complete until the folder and final markdown file have been written locally.

Save results with the same structure as stdio mode using the source filename (without extension) as folder name:

1. `mkdir -p .frenchie/{name}` (e.g. `report.pdf` → `.frenchie/report/`)
2. For each `frenchie-result:{objectKey}`, call `fetch_result_file` with `object_key`
3. `curl -o ".frenchie/{name}/{filename}" "{download_url}"` for each image
4. Replace `frenchie-result:{objectKey}` in the markdown with local filenames (e.g. `img-0.png`)
5. Write to `.frenchie/{name}/result.md`

If there are no `frenchie-result:` references, still create `.frenchie/{name}/result.md` with the returned Markdown. HTTP mode is not complete until that file exists.

Result for `report.pdf`:
```
.frenchie/report/
├── result.md       ← markdown with ![alt](img-0.png) relative paths
├── img-0.png
└── ...
```

In stdio mode, this structure is created automatically — no extra steps needed.

## Important Behaviors

- Frenchie uses **smart wait** — async jobs are polled internally for up to 90 seconds before returning `"processing"`
- Result payloads **expire ~30 minutes** after first successful delivery
- In HTTP mode, durable output means `.frenchie/{name}/result.md` exists locally before you conclude the task
- Files are processed and deleted immediately — Frenchie does not store user files
- Download URLs from `fetch_result_file` expire in 15 minutes — download promptly

## Error Handling

| Error | Action |
|-------|--------|
| Missing API key | Ask user to configure `FRENCHIE_API_KEY` or pass `api_key` |
| Insufficient credits | Tell user to top up at the Frenchie dashboard |
| Job failed | Surface the backend error message |
| Result expired | Explain history remains but Markdown payload is gone |

## Status Check

To check account status (not an MCP tool):

1. `GET https://api.getfrenchie.dev/balance` — current credits
2. `GET https://api.getfrenchie.dev/jobs?limit=10` — recent jobs

Both require `Authorization: Bearer fr_...` header.
