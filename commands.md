# Frenchie Commands

Frenchie is an MCP-first multimodal utility — today it ships OCR, transcription, extraction, and image generation commands below.

## `/ocr <file>`

Convert a local PDF or image file into Markdown through the Frenchie MCP server.

Preferred tool:

- `ocr_to_markdown`

Inputs (use one, not both):

- `uploaded_file_reference` — object key from the HTTP upload flow
- `file_path` — absolute path to the local file (stdio transport only)
- optional `api_key`

Hard rule: if the MCP server is configured with `url` or `serverUrl`, NEVER send `file_path`. Upload first and use `uploaded_file_reference`.
Hard rule: in HTTP mode, MUST persist the final Markdown to `.frenchie/{name}/result.md` before concluding the task. This rule does not apply to stdio mode because the local MCP server already writes `.frenchie/...` automatically.

HTTP upload flow (use the `upload_file` MCP tool — never call the REST presign endpoint directly):

1. Call the `upload_file` MCP tool with `filename`, `file_size` (bytes), and `mime_type`
2. The tool returns `upload_url`, `object_key`, and `expires_in`
3. `PUT` the file to `upload_url` with the correct `Content-Type` header (e.g. `curl -X PUT -H "Content-Type: application/pdf" -T file.pdf "<upload_url>"`)
4. Pass `object_key` as `uploaded_file_reference` to `ocr_to_markdown`

Supported formats: PDF, PNG, JPG/JPEG, WebP

## `/transcribe <file>`

Convert a local audio or video file into a Markdown transcript through the Frenchie MCP server.

Preferred tool:

- `transcribe_to_markdown`

Inputs (use one, not both):

- `uploaded_file_reference` — object key from the HTTP upload flow
- `file_path` — absolute path to the local file (stdio transport only)
- optional `api_key`
- optional `language` — ISO 639-1 code (e.g. `th`, `en`, `ja`)

Hard rule: if the MCP server is configured with `url` or `serverUrl`, NEVER send `file_path`. Upload first and use `uploaded_file_reference`.
Hard rule: in HTTP mode, MUST persist the final Markdown to `.frenchie/{name}/result.md` before concluding the task. This rule does not apply to stdio mode because the local MCP server already writes `.frenchie/...` automatically.

HTTP upload flow (use the `upload_file` MCP tool — never call the REST presign endpoint directly):

1. Call the `upload_file` MCP tool with `filename`, `file_size` (bytes), and `mime_type`
2. The tool returns `upload_url`, `object_key`, and `expires_in`
3. `PUT` the file to `upload_url` with the correct `Content-Type` header (e.g. `curl -X PUT -H "Content-Type: audio/mpeg" -T recording.mp3 "<upload_url>"`)
4. Pass `object_key` as `uploaded_file_reference` to `transcribe_to_markdown`

Supported formats: MP3, M4A, WAV, MP4, MOV, WebM

## `/extract <file>`

Convert a local Word, Excel, CSV/TSV, or PowerPoint file into Markdown through the Frenchie MCP server.

Preferred tool:

- `extract_to_markdown`

Inputs (use one, not both):

- `uploaded_file_reference` — object key from the HTTP upload flow
- `file_path` — absolute path to the local file (stdio transport only)
- optional `api_key`

Hard rule: if the MCP server is configured with `url` or `serverUrl`, NEVER send `file_path`. Upload first and use `uploaded_file_reference`.
Hard rule: in HTTP mode, MUST persist the final Markdown to `.frenchie/{name}/result.md` before concluding the task. This rule does not apply to stdio mode because the local MCP server already writes `.frenchie/...` automatically.

HTTP upload flow (use the `upload_file` MCP tool — never call the REST presign endpoint directly):

1. Call the `upload_file` MCP tool with `filename`, `file_size` (bytes), and `mime_type`
2. The tool returns `upload_url`, `object_key`, and `expires_in`
3. `PUT` the file to `upload_url` with the correct `Content-Type` header (e.g. `curl -X PUT -H "Content-Type: text/csv" -T data.csv "<upload_url>"`)
4. Pass `object_key` as `uploaded_file_reference` to `extract_to_markdown`

Supported formats: DOCX, XLSX, CSV, TSV, PPTX

## `/generate-image <prompt>`

Generate a single image from a text prompt through the Frenchie MCP server.

Preferred tool:

- `generate_image`

Inputs:

- `prompt` — required; plain-language description of the image to generate
- optional `style` — free-text style direction (e.g. "flat vector, neon palette"); merged into the provider prompt by Frenchie
- optional `size` — `"1024x1024" | "1536x1024" | "1024x1536" | "auto"`
- optional `quality` — `"low" | "medium" | "high" | "auto"`
- optional `format` — `"png" | "jpeg" | "webp"` (default `"png"`)
- optional `background` — `"transparent" | "opaque" | "auto"` (rejected with `format=jpeg`)
- optional `api_key`

Behaviour:

- **stdio mode** — the MCP server downloads the image and saves it to `.frenchie/<slug>/generated.<ext>` automatically. Return the relative path to the user.
- **HTTP mode** — the tool returns a presigned `imageUrl` (expires in 30 minutes). Download the image to the user's machine before the URL expires; do not just hand the user a URL and call the task done.

Pricing: 20 credits per image (refunded automatically on failure).
Rate limits: 50 images / hour and 250 images / day per user.

Hard rule: in HTTP mode you MUST download the image to the user's machine (or render it inline if the agent UI supports that). The presigned URL expires in 30 minutes and the underlying object is deleted shortly after.

## `fetch_result_file`

Get a temporary download URL for a result file stored on the server. Used in HTTP mode when OCR results contain `frenchie-result:` image references.

Preferred tool:

- `fetch_result_file`

Inputs:

- `object_key` — the object key from a `frenchie-result:` reference
- optional `api_key`

Returns a download URL (expires in 15 minutes) and a suggested curl command.

When using HTTP mode, fetching result files is only part of the job. The task is not complete until the final Markdown is persisted to `.frenchie/{name}/result.md`.

## `/frenchie-status`

Show Frenchie account status for the current user.

Use backend REST endpoints:

- `GET https://api.getfrenchie.dev/balance`
- `GET https://api.getfrenchie.dev/jobs?limit=10`

Summarize:

- available credits
- recent jobs
- whether any recent async jobs still need follow-up via `get_job_result`
