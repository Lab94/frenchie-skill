Convert the file at $ARGUMENTS into Markdown using the Frenchie MCP server.

Hard rule: in HTTP mode, MUST persist the final Markdown to `.frenchie/{name}/result.md` before concluding the task. This rule does not apply to stdio mode because the local MCP server already writes `.frenchie/...` automatically.

1. Determine transport mode:
   - **HTTP** (MCP configured with `url`/`serverUrl`): NEVER send `file_path`.
     Call `upload_file` with `filename`, `file_size` (bytes), `mime_type` → get `upload_url` and `object_key`.
     PUT the file to `upload_url` (e.g. `curl -X PUT -H "Content-Type: application/pdf" -T file.pdf "<upload_url>"`).
     Then call `ocr_to_markdown` with `uploaded_file_reference` set to `object_key`.
   - **stdio** (MCP configured with `command`/`args`): call `ocr_to_markdown` with `file_path` set to the absolute path
2. If `status` is `"done"`:
   - **stdio mode** → the response is metadata-only (`savedTo`, `wordCount`, `imageCount`). Read the file at `savedTo` with your own file tool if the task needs the content; do not re-run the OCR job expecting inline markdown
   - **HTTP mode** → continue to step 5 to save results locally before concluding the task
3. If `status` is `"processing"`, poll with `get_job_result` using the returned `jobId` until done
4. If the result has expired, inform the user that the payload is no longer available
5. If the result contains `frenchie-result:` image references (HTTP mode), call `fetch_result_file` for each object_key and save to `.frenchie/{name}/` where name is the source filename without extension (e.g. `report.pdf` → `.frenchie/report/`)
6. In HTTP mode, rewrite any `frenchie-result:` references to local filenames and write the final Markdown to `.frenchie/{name}/result.md`
7. If there are no `frenchie-result:` references, still write the returned Markdown to `.frenchie/{name}/result.md`

Supported formats: PDF, PNG, JPG/JPEG, WebP
