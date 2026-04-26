Transcribe the file at $ARGUMENTS into Markdown using the Frenchie MCP server.

Hard rule: in HTTP mode, MUST persist the final Markdown to `.frenchie/{name}/result.md` before concluding the task. This rule does not apply to stdio mode because the local MCP server already writes `.frenchie/...` automatically.

## Language detection

Before calling the tool, determine the audio language:
- If the user explicitly states the language (e.g. "transcribe this Thai video"), use the corresponding ISO 639-1 code (e.g. `th`)
- If the filename or surrounding conversation context suggests a non-English language, ask the user to confirm the language
- If unsure, ask: "What language is the audio in? This helps improve transcription accuracy. (e.g. th for Thai, ja for Japanese, en for English — or leave blank for auto-detect)"
- If the user says "auto" or doesn't specify, omit the `language` parameter

## Steps

1. Determine transport mode and call the tool:
   - **HTTP** (MCP configured with `url`/`serverUrl`): NEVER send `file_path`.
     Call `upload_file` with `filename`, `file_size` (bytes), `mime_type` → get `upload_url` and `object_key`.
     PUT the file to `upload_url` (e.g. `curl -X PUT -H "Content-Type: audio/mpeg" -T file.mp3 "<upload_url>"`).
     Then call `transcribe_to_markdown` with `uploaded_file_reference` set to `object_key`.
   - **stdio** (MCP configured with `command`/`args`): call `transcribe_to_markdown` with `file_path` set to the absolute path
   - If a language was determined, also pass `language` (ISO 639-1 code)
2. If `status` is `"done"`:
   - **stdio mode** → the response is metadata-only (`savedTo`, `wordCount`, `creditsUsed`). Read the file at `savedTo` with your own file tool if the task needs the transcript text; do not re-run the transcription job expecting inline markdown
   - **HTTP mode** → continue to step 5 to save results locally before concluding the task
3. If `status` is `"processing"`:
   a. Tell the user the file is being transcribed and the estimated completion time
   b. Wait until `estimatedCompletion` before the first poll
   c. Call `get_job_result` with the `jobId`
   d. If still `"processing"` and `estimatedCompletion` is returned, wait until that time and retry
   e. If still `"processing"` with no `estimatedCompletion`, wait 30 seconds and retry
   f. Poll at most 15 times total. If still not done, tell the user the job is taking longer than expected and provide the `jobId` so they can check manually
4. If the tool returns an error about an expired result, inform the user that the payload is no longer available (results expire 30 minutes after first delivery)
5. If the result contains `frenchie-result:` image references (HTTP mode), call `fetch_result_file` for each object_key and save to `.frenchie/{name}/` where name is the source filename without extension (e.g. `meeting.mp4` → `.frenchie/meeting/`)
6. In HTTP mode, rewrite any `frenchie-result:` references to local filenames and write the final Markdown to `.frenchie/{name}/result.md`
7. If there are no `frenchie-result:` references, still write the returned Markdown to `.frenchie/{name}/result.md`

Supported formats: MP3, WAV, M4A, MP4, MOV, WebM
