Generate a single image from the prompt: $ARGUMENTS

1. Call the `generate_image` MCP tool with `prompt` set to the description. In stdio mode, also pass `output_dir` with the absolute path of the current workspace root so the image saves next to the user's work (otherwise GUI-spawned agents like Claude Desktop save to `$HOME`).
2. If the user mentioned style, size, quality, format, or background preferences, pass them as the corresponding optional parameters; otherwise omit them and let the model defaults apply.
3. If `status` is `"done"`:
   - **stdio mode** — the MCP server already saved the image to `.frenchie/<slug>/generated.<ext>`. The response includes `savedTo`. Tell the user the file path so they can open it.
   - **HTTP mode** — the response includes a presigned `imageUrl` that expires in 30 minutes. You MUST download the image to the user's machine (or render it inline if the agent UI supports that) before concluding the task. Do not just hand the user a URL.
4. If `status` is `"processing"`, poll with `get_job_result` using the returned `jobId` until done.
5. If the result has expired (status 410), tell the user the image is no longer available and ask whether to regenerate.

Pricing: 20 credits per image, refunded automatically on failure.
Rate limits: 50 images / hour and 250 images / day per user.
