# Frenchie Skill Instructions

Frenchie is an MCP-first multimodal utility that makes agents more capable. Today: OCR (PDF/images → Markdown), transcription (audio/video → Markdown), and image generation (text → PNG). Next releases: file extraction (Excel → Markdown) and Markdown-to-file generation. These instructions cover the currently-shipping tools — new capabilities will be added here as they launch.

## Primary path

Use the Frenchie MCP server first. The recommended local install is `npx @lab94/frenchie install --api-key fr_...`, which configures the stdio MCP server for your agent. Hosted agents that can't run local binaries connect to the public HTTP endpoint at `https://mcp.getfrenchie.dev`.

1. Confirm the user has a valid Frenchie API key.
2. Confirm the MCP server is configured with `FRENCHIE_API_KEY` or an `Authorization: Bearer fr_...` header.
3. Use MCP tools instead of calling provider APIs directly:
   - `upload_file` — get a presigned upload URL (HTTP mode only)
   - `ocr_to_markdown`
   - `transcribe_to_markdown`
   - `generate_image`
   - `get_job_result`
   - `fetch_result_file` (HTTP mode only — download result images)

## File access by transport

- **stdio mode** (default after `npx @lab94/frenchie install`): the MCP server runs on the same machine as the agent. Use `file_path` with an absolute path. Results are auto-saved to `.frenchie/<name>/` next to the input file.
- **HTTP mode** (hosted/web agents): the MCP server runs remotely, so local file paths do not exist on the server. NEVER send `file_path` over HTTP. Upload first, then use `uploaded_file_reference`.

Hard rule: if the MCP server is configured with `url` or `serverUrl`, NEVER send `file_path`. `file_path` is only valid for local stdio MCP.
Hard rule: HTTP mode MUST persist the final Markdown to `.frenchie/{name}/result.md` before concluding the task. This rule is HTTP-only because stdio mode already writes `.frenchie/...` automatically.

### HTTP upload flow (use `upload_file` tool)

1. Call the `upload_file` MCP tool with `filename`, `file_size` (bytes), and `mime_type`
2. The tool returns `upload_url`, `object_key`, and `expires_in`
3. PUT the file to `upload_url` with the correct `Content-Type` header (e.g. via `curl -X PUT -H "Content-Type: application/pdf" -T file.pdf "<upload_url>"`)
4. Pass `object_key` as `uploaded_file_reference` to `ocr_to_markdown` or `transcribe_to_markdown`

### How to detect transport mode

- If the MCP server is configured with `url` or `serverUrl`, treat it as HTTP and upload first.
- If the MCP server is configured with `command` and `args`, treat it as stdio and use `file_path`.

## OCR workflow

- **HTTP:** NEVER send `file_path`. Upload first, then call `ocr_to_markdown` with `uploaded_file_reference`
- **stdio:** call `ocr_to_markdown` with `file_path`
- optional `api_key` only when the environment is not already configured
- If the tool returns `status: "done"` in HTTP mode, persist the final Markdown to `.frenchie/{name}/result.md` before concluding the task
- If the tool returns `status: "done"` in **stdio** mode, the response is **metadata-only** (`savedTo`, `wordCount`, `imageCount`, `creditsUsed`) — no inline `markdown` field. The server already wrote `result.md` to the path in `savedTo`. Read that file with your own file-reading tool if the task needs the content. Do NOT call `ocr_to_markdown` again hoping to get the markdown inline — it will reprocess and burn credits.
- If the tool returns `status: "processing"`, store the `jobId` and follow up with `get_job_result`

Supported formats: PDF, PNG, JPG/JPEG, WebP

## Transcription workflow

- **HTTP:** NEVER send `file_path`. Upload first, then call `transcribe_to_markdown` with `uploaded_file_reference`
- **stdio:** call `transcribe_to_markdown` with `file_path`
- optional `api_key` only when the environment is not already configured
- optional `language` (ISO 639-1 code, e.g. `th`, `en`, `ja`) for better accuracy
- If the user mentions the language, or the file/context clearly implies it, pass `language`
- If unsure, ask: "What language is the audio in? (e.g. th, ja, en — or leave blank for auto-detect)"
- If the tool returns `status: "done"` in HTTP mode, persist the final Markdown to `.frenchie/{name}/result.md` before concluding the task
- If the tool returns `status: "done"` in **stdio** mode, the response is **metadata-only** (`savedTo`, `wordCount`, `creditsUsed`) — no inline `markdown` field. The server already wrote `result.md` to the path in `savedTo`. Read that file with your own file-reading tool if the task needs the transcript text. Do NOT re-invoke the tool to try to get markdown inline — it will reprocess and burn credits.
- If the tool returns `status: "processing"`, poll with `get_job_result`

Supported formats: MP3, M4A, WAV, MP4, MOV, WebM

## Image generation workflow

- Tool: `generate_image`
- Required input: `prompt` (plain-language description of the image)
- Optional inputs:
  - `style` — free-text style direction; merged into the provider prompt by Frenchie
  - `size` — `"1024x1024" | "1536x1024" | "1024x1536" | "auto"`
  - `quality` — `"low" | "medium" | "high" | "auto"`
  - `format` — `"png" | "jpeg" | "webp"` (default `"png"`)
  - `background` — `"transparent" | "opaque" | "auto"` (rejected with `format=jpeg`)
  - `output_dir` — stdio only. Absolute directory under which `.frenchie/<slug>/generated.<ext>` is saved. Defaults to the MCP server's process cwd. Pass your workspace root so the image doesn't land in `$HOME` on GUI-spawned agents like Claude Desktop.
  - `api_key`
- Pricing: 20 credits per image; refunded automatically on failure
- Rate limits: 50 images / hour, 250 images / day per user
- v1 generates exactly one image per call (no `n > 1`); call the tool again for additional variants

Behaviour by transport:

- **stdio** — the MCP server downloads the result and writes `.frenchie/<slug>/generated.<ext>` automatically. Tell the user the relative path so they can open it; no further work required. Always pass `output_dir` with your workspace root (Claude Desktop and other GUI agents spawn the MCP server with `$HOME` as cwd — without `output_dir` the image lands in the wrong place).
- **HTTP** — the tool returns a presigned `imageUrl` that expires in 30 minutes. You MUST download the image to the user's machine (or render it inline if the agent UI supports that) before concluding the task. Do not just hand the user a URL.

If the tool returns `status: "processing"`, store the `jobId` and poll `get_job_result` like the other capabilities.

## Async follow-up

- `get_job_result` accepts `job_id` and optional `api_key`
- When a tool returns `status: "processing"`:
  1. Note the `estimatedCompletion` timestamp and tell the user when the job should be ready
  2. Wait until `estimatedCompletion` before calling `get_job_result`
  3. If still processing and a new `estimatedCompletion` is returned, wait until that time
  4. If still processing with no `estimatedCompletion`, wait 30 seconds before retrying
  5. Poll at most 15 times total. If it is still not done, tell the user and provide the `jobId`
- If the job is done, return the Markdown immediately
- If the result has expired, explain that the retained payload is no longer available

## Status command

`/frenchie-status` is not an MCP tool.

For this command:

1. Call `GET https://api.getfrenchie.dev/balance`
2. Call `GET https://api.getfrenchie.dev/jobs?limit=10`
3. Send header `Authorization: Bearer fr_...`
4. Summarize:
   - current credits
   - up to 10 most recent jobs
   - type, status, filename, credits used, and completion state

## Saving results locally (HTTP mode)

When the MCP server runs in HTTP mode, the final Markdown is not durable until the agent writes it locally. OCR images are stored on the server instead of saved to disk, and the markdown may contain `frenchie-result:` references instead of local file paths.

HTTP mode MUST persist the final Markdown to `.frenchie/{name}/result.md` before concluding the task. Do not tell the user the job is complete until the folder and final markdown file have been written locally.

To save results locally with the same structure as stdio mode:

1. Derive the folder name from the source filename without extension (e.g. `report.pdf` → `report`)
2. Create the output folder: `mkdir -p .frenchie/{name}`
3. For each `frenchie-result:{objectKey}` in the markdown, call `fetch_result_file` with the `object_key`
4. Download each image into the folder: `curl -o ".frenchie/{name}/{filename}" "{download_url}"`
5. Replace every `frenchie-result:{objectKey}` in the markdown with the local relative filename (e.g. `img-0.png`)
6. Write the updated markdown to `.frenchie/{name}/result.md`

If there are no `frenchie-result:` references, still create `.frenchie/{name}/result.md` with the returned Markdown. HTTP mode is not complete until that file exists.

Example for `report.pdf`:

```
.frenchie/report/
├── result.md          ← markdown with relative image paths
├── img-0.png
├── img-1.jpeg
└── ...
```

This matches the structure that stdio mode creates automatically. Download URLs expire in 15 minutes — download all files promptly after receiving the result.

In stdio mode, results are automatically saved to `.frenchie/{jobId}/` — no extra steps needed.

## Important behavior

- Prefer MCP over direct API calls
- Do not call model provider APIs directly
- Frenchie uses smart wait for async jobs before returning `processing`
- Result payloads expire shortly after first successful delivery, typically within 30 minutes
- In HTTP mode, durable output means `.frenchie/{name}/result.md` exists locally before you conclude the task
- Download URLs from `fetch_result_file` expire in 15 minutes — download promptly

## Error handling

- If the API key is missing, ask the user to configure `FRENCHIE_API_KEY`
- If the worker reports insufficient credits, tell the user to top up before retrying
- If a job fails, surface the backend error message when available
- If the result expired, explain that the job history remains but the stored Markdown payload is gone
