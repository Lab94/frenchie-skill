import {
  CREDIT_RATES,
  FILE_SIZE_LIMIT_BYTES,
  IMAGE_GENERATION_BACKGROUNDS,
  IMAGE_GENERATION_FORMATS,
  IMAGE_GENERATION_PROMPT_MAX_LENGTH,
  IMAGE_GENERATION_QUALITIES,
  IMAGE_GENERATION_SIZES,
  IMAGE_GENERATION_STYLE_MAX_LENGTH,
  RESULT_RETENTION_MINUTES,
  SUPPORTED_MIME_TYPES,
  imageGenerationJobCreateSchema,
  mcpFetchResultFileInputSchema,
  mcpGetJobResultInputSchema,
  mcpOcrInputSchema,
  mcpToolResultSchema,
  mcpTranscriptionInputSchema,
  type FetchResultFileToolInput,
  type GetJobResultToolInput,
  type CapabilityResult,
  type ImageGenerationJobCreateResponse,
  type ImageGenerationJobCreateSchema,
  type JobResultResponse,
  type McpToolResult,
  type OcrToMarkdownToolInput,
  type TranscribeToMarkdownToolInput
} from "../shared/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import { z } from "zod";
import { ApiClient, ApiError } from "./api-client.js";
import { prepareOcrLocalFile, prepareTranscriptionLocalFile } from "./local-file.js";

export interface ToolOptions {
  apiClient: ApiClient;
  defaultApiKey?: string;
  /** Already-validated session-level language fallback for transcription jobs. */
  defaultLanguage?: string;
  smartWaitIntervalMs: number;
  smartWaitTimeoutMs: number;
  outputDir: string;
  transportMode: "stdio" | "http";
}

const HTTP_FILE_PATH_ERROR =
  "HTTP transport does not accept file_path. Upload the file first and call the tool again with uploaded_file_reference.";

const createJobToolInputShape = {
  file_path: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Absolute local file path. Stdio transport only — over HTTP, upload via upload_file first and pass uploaded_file_reference instead."
    ),
  uploaded_file_reference: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Object key returned by upload_file. Required for HTTP transport; ignored when file_path is provided in stdio."
    ),
  api_key: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional Frenchie API key (fr_...). Falls back to the FRENCHIE_API_KEY env var when omitted."
    )
};

const transcriptionToolInputShape = {
  ...createJobToolInputShape,
  language: z
    .string()
    .min(2)
    .max(10)
    .optional()
    .describe(
      "Optional ISO 639-1 language code (e.g. 'th', 'en', 'ja') for better accuracy; omit for auto-detection."
    )
};

const generateImageToolInputShape = {
  prompt: z
    .string()
    .min(1)
    .max(IMAGE_GENERATION_PROMPT_MAX_LENGTH)
    .describe(
      "Required. Plain-language description of the image to generate (e.g. 'poster of a ramen shop at night')."
    ),
  style: z
    .string()
    .max(IMAGE_GENERATION_STYLE_MAX_LENGTH)
    .optional()
    .describe(
      "Optional style direction (e.g. 'flat vector, neon palette'). Merged into the provider prompt by Frenchie."
    ),
  size: z
    .enum(IMAGE_GENERATION_SIZES)
    .optional()
    .describe("Optional output size. Defaults to model auto."),
  quality: z
    .enum(IMAGE_GENERATION_QUALITIES)
    .optional()
    .describe("Optional output quality."),
  format: z
    .enum(IMAGE_GENERATION_FORMATS)
    .optional()
    .describe("Optional output format. Defaults to png."),
  background: z
    .enum(IMAGE_GENERATION_BACKGROUNDS)
    .optional()
    .describe(
      "Optional background. transparent is rejected when format is jpeg."
    ),
  output_dir: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Stdio mode only: absolute directory under which .frenchie/<slug>/generated.<ext> is saved. " +
      "Defaults to the MCP server's process cwd. Recommended: pass your workspace root so the image lands next to your work instead of $HOME."
    ),
  api_key: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional Frenchie API key (fr_...). Falls back to the FRENCHIE_API_KEY env var when omitted."
    )
};

const getJobResultToolInputShape = {
  job_id: z
    .string()
    .min(1)
    .describe(
      "Job ID returned by ocr_to_markdown, transcribe_to_markdown, or generate_image when status was 'processing'."
    ),
  api_key: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional Frenchie API key (fr_...). Falls back to the FRENCHIE_API_KEY env var when omitted."
    )
};

const fetchResultFileToolInputShape = {
  object_key: z
    .string()
    .min(1)
    .describe("The object key parsed from a frenchie-result:<objectKey> reference in the result markdown."),
  api_key: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional Frenchie API key (fr_...). Falls back to the FRENCHIE_API_KEY env var when omitted."
    )
};

const uploadFileToolInputShape = {
  filename: z
    .string()
    .min(1)
    .max(255)
    .describe("Original filename with extension (e.g. 'report.pdf')."),
  file_size: z
    .number()
    .int()
    .positive()
    .max(FILE_SIZE_LIMIT_BYTES)
    .describe("File size in bytes."),
  mime_type: z
    .string()
    .min(1)
    .describe("MIME type (e.g. 'application/pdf', 'audio/mpeg')."),
  api_key: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional Frenchie API key (fr_...). Falls back to the FRENCHIE_API_KEY env var when omitted."
    )
};

const uploadFileOutputShape = {
  upload_url: z.string().url().describe("Presigned URL — PUT the file here with the correct Content-Type header"),
  object_key: z.string().min(1).describe("Pass this as uploaded_file_reference to ocr_to_markdown or transcribe_to_markdown"),
  expires_in: z.number().int().positive().describe("URL expiry in seconds")
};

const markdownResultOutputShape = z.object({
  kind: z.literal("markdown"),
  markdown: z.string().optional().describe("HTTP mode: inline markdown. Stdio mode: omitted (read savedTo instead)"),
  savedTo: z.string().optional().describe("Stdio mode: relative path from output root to the saved result.md"),
  pages: z.number().int().nonnegative().optional().describe("Number of pages processed — OCR only"),
  wordCount: z.number().int().nonnegative().optional().describe("Approximate word count of the markdown"),
  imageCount: z.number().int().nonnegative().optional().describe("Number of embedded images saved alongside result.md")
});

const imageResultOutputShape = z.object({
  kind: z.literal("image"),
  format: z.enum(IMAGE_GENERATION_FORMATS),
  mimeType: z.string(),
  size: z.enum(IMAGE_GENERATION_SIZES).optional(),
  background: z.enum(IMAGE_GENERATION_BACKGROUNDS).optional(),
  style: z.string().optional(),
  imageUrl: z.string().url().optional().describe("HTTP mode: presigned HTTPS link (~30 min expiry)"),
  savedTo: z.string().optional().describe("Stdio mode: relative path to the persisted image file")
});

/**
 * Spec section 6.1 — shared result envelope. No top-level `markdown`,
 * `savedTo`, `imageUrl`, or `objectKey`. Read the typed payload off
 * `result` and branch on `result.kind`.
 */
const toolResultOutputShape = {
  status: z.enum(["done", "processing"]),
  jobId: z.string().min(1).optional(),
  creditsUsed: z.number().int().nonnegative().optional(),
  resultExpiresAt: z.string().datetime().optional(),
  estimatedCompletion: z.string().datetime().optional(),
  result: z.discriminatedUnion("kind", [markdownResultOutputShape, imageResultOutputShape]).optional()
};

// Cap in-memory job bookkeeping so a long-running stdio MCP server (Claude
// Desktop and other GUI hosts can stay up for days) doesn't leak entries
// whenever an agent queues a job but never polls get_job_result. Entries are
// normally deleted on terminal status; the cap is the safety net for abandoned
// ones. 256 is well above any realistic concurrent-job-per-session ceiling
// (rate limits are 5 concurrent jobs per user) so well-behaved agents never
// hit the bound. Eviction is insertion-order (oldest-first) which matches the
// intent: drop stale queued-but-never-polled entries first.
const JOB_METADATA_MAX_ENTRIES = 256;

function setBounded<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  if (map.has(key)) {
    map.delete(key);
  } else if (map.size >= max) {
    const oldest = map.keys().next().value as K | undefined;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

export function registerTools(server: McpServer, options: ToolOptions): void {
  const registerTool = server.registerTool.bind(server) as (
    name: string,
    config: Record<string, unknown>,
    callback: (args: unknown) => Promise<unknown>
  ) => void;

  // Remember file paths so get_job_result can save output next to the original file
  const jobOutputDirs = new Map<string, string>();
  // Remember friendly names so get_job_result can name folders after the original file
  const jobFriendlyNames = new Map<string, string>();
  // Remember API keys so get_job_result can use the same key for result file storage
  const jobApiKeys = new Map<string, string>();

  const rememberOutputDir = (jobId: string, dir: string): void =>
    setBounded(jobOutputDirs, jobId, dir, JOB_METADATA_MAX_ENTRIES);
  const rememberFriendlyName = (jobId: string, name: string): void =>
    setBounded(jobFriendlyNames, jobId, name, JOB_METADATA_MAX_ENTRIES);
  const rememberApiKey = (jobId: string, key: string): void =>
    setBounded(jobApiKeys, jobId, key, JOB_METADATA_MAX_ENTRIES);

  function buildCtx(apiKey: string, storageJobId: string, localFolderName: string, outDir?: string): ToToolSuccessContext {
    return {
      outputDir: outDir ?? options.outputDir,
      storageJobId,
      localFolderName,
      transportMode: options.transportMode,
      apiClient: options.apiClient,
      apiKey
    };
  }

  registerTool(
    "ocr_to_markdown",
    {
      title: "OCR to Markdown",
      description: "Convert PDF/image files into Markdown through Frenchie",
      inputSchema: createJobToolInputShape,
      outputSchema: toolResultOutputShape,
      annotations: {
        title: "OCR to Markdown",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    withToolErrors(async (args: unknown) => {
      const { result, jobId, friendlyName, filePath, apiKey } = await runOcrTool(args, options);
      const outDir = filePath ? dirname(filePath) : options.outputDir;
      if (filePath) rememberOutputDir(jobId, outDir);
      if (result.status === "processing" && friendlyName) rememberFriendlyName(jobId, friendlyName);
      rememberApiKey(jobId, apiKey);
      return toToolSuccess(result, buildCtx(apiKey, jobId, friendlyName ?? jobId, outDir));
    })
  );

  registerTool(
    "transcribe_to_markdown",
    {
      title: "Transcribe to Markdown",
      description: "Convert audio/video files into Markdown transcripts through Frenchie. Set language (ISO 639-1 code, e.g. 'th', 'en', 'ja') for better accuracy; omit for auto-detection.",
      inputSchema: transcriptionToolInputShape,
      outputSchema: toolResultOutputShape,
      annotations: {
        title: "Transcribe to Markdown",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    withToolErrors(async (args: unknown) => {
      const { result, jobId, friendlyName, filePath, apiKey } = await runTranscriptionTool(args, options);
      const outDir = filePath ? dirname(filePath) : options.outputDir;
      if (filePath) rememberOutputDir(jobId, outDir);
      if (result.status === "processing" && friendlyName) rememberFriendlyName(jobId, friendlyName);
      rememberApiKey(jobId, apiKey);
      return toToolSuccess(result, buildCtx(apiKey, jobId, friendlyName ?? jobId, outDir));
    })
  );

  registerTool(
    "generate_image",
    {
      title: "Generate Image",
      description:
        "Generate a single image from a text prompt through Frenchie (gpt-image-2). " +
        "Required: prompt. Optional: style (free-text style direction), size, quality, format, background. " +
        "stdio mode auto-saves the image to .frenchie/<slug>/generated.<ext>; HTTP mode returns a presigned imageUrl that the agent should download for the user.",
      inputSchema: generateImageToolInputShape,
      outputSchema: toolResultOutputShape,
      annotations: {
        title: "Generate Image",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    withToolErrors(async (args: unknown) => {
      const { input, response, apiKey, outputDir } = await runImageGenerationTool(args, options);
      const friendlyName = imageGenerationFriendlyName(input.prompt);
      // Mirror OCR/transcription: when the caller supplies an anchor (here output_dir,
      // there file_path), save results there instead of process.cwd() — which may be
      // $HOME for GUI agents like Claude Desktop.
      if (response.status === "queued" && outputDir) rememberOutputDir(response.jobId, outputDir);
      const ctx = buildCtx(apiKey, friendlyName, friendlyName, outputDir);
      return toImageGenerationToolSuccess(response, input, ctx);
    })
  );

  registerTool(
    "get_job_result",
    {
      title: "Get Job Result",
      description: "Fetch the latest async Frenchie job result",
      inputSchema: getJobResultToolInputShape,
      outputSchema: toolResultOutputShape,
      annotations: {
        title: "Get Job Result",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    withToolErrors(async (args: unknown) => {
      const parsed = mcpGetJobResultInputSchema.parse(args) as GetJobResultToolInput;
      const apiKey = resolveApiKey(parsed.api_key, options.defaultApiKey);
      const jobId = parsed.job_id;

      // Image jobs need a different rendering path (no markdown body, image
      // file written to disk in stdio mode). Detect the job type up front from
      // the API response so the rest of the flow stays cleanly split.
      const rawResult = await options.apiClient.getJobResult(apiKey, jobId).catch((error) => {
        if (error instanceof ApiError && error.statusCode === 410) {
          throw new Error("Job result has expired and is no longer available.");
        }
        throw error;
      });

      if (rawResult.type === "image_generation") {
        if (rawResult.status === "failed") {
          const job = await options.apiClient.getJob(apiKey, jobId);
          throw new Error(job.errorMessage ?? "Image generation job failed.");
        }

        const synthesised = synthesiseImageGenerationResponse(jobId, rawResult);
        const folderName = imageGenerationFriendlyName(
          rawResult.imageDetail?.prompt ?? jobId
        );
        const outDir = jobOutputDirs.get(jobId);
        if (synthesised.status === "done") {
          jobOutputDirs.delete(jobId);
          jobFriendlyNames.delete(jobId);
          jobApiKeys.delete(jobId);
        }
        const ctx = buildCtx(apiKey, folderName, folderName, outDir);
        const input: ImageGenerationJobCreateSchema = {
          prompt: rawResult.imageDetail?.prompt ?? "",
          style: rawResult.imageDetail?.style ?? undefined
        };
        return toImageGenerationToolSuccess(synthesised, input, ctx);
      }

      const { result, friendlyName } = renderMarkdownJobResult(jobId, rawResult);
      const outDir = jobOutputDirs.get(jobId) ?? options.outputDir;
      const resolvedName = jobFriendlyNames.get(jobId) ?? friendlyName ?? jobId;
      if (result.status === "done") {
        jobOutputDirs.delete(jobId);
        jobFriendlyNames.delete(jobId);
        jobApiKeys.delete(jobId);
      }
      return toToolSuccess(result, buildCtx(apiKey, jobId, resolvedName, outDir));
    })
  );

  // upload_file + fetch_result_file only make sense in HTTP mode. In stdio mode,
  // file_path works directly against the local filesystem and result images are
  // written next to result.md, so the upload → object_key and frenchie-result:
  // → download-url flows are never exercised. Gating them here keeps the stdio
  // surface honest and matches the per-tool descriptions that already say
  // "HTTP mode".
  if (options.transportMode !== "http") return;

  registerTool(
    "upload_file",
    {
      title: "Upload File (HTTP)",
      description:
        "Get a presigned upload URL for use with ocr_to_markdown or transcribe_to_markdown in HTTP mode. " +
        "After calling this tool, PUT the file to upload_url (with the correct Content-Type header), " +
        "then pass object_key as uploaded_file_reference to the processing tool.",
      inputSchema: uploadFileToolInputShape,
      outputSchema: uploadFileOutputShape,
      annotations: {
        title: "Upload File (HTTP)",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    withToolErrors(async (args: unknown) => {
      const input = z.object(uploadFileToolInputShape).parse(args);
      const apiKey = resolveApiKey(input.api_key, options.defaultApiKey);

      if (!(SUPPORTED_MIME_TYPES as readonly string[]).includes(input.mime_type)) {
        throw new Error(
          `Unsupported MIME type: ${input.mime_type}. Supported: ${SUPPORTED_MIME_TYPES.join(", ")}`
        );
      }

      const presign = await options.apiClient.presignUpload(apiKey, {
        filename: input.filename,
        fileSize: input.file_size,
        mimeType: input.mime_type
      });

      return {
        structuredContent: {
          upload_url: presign.uploadUrl,
          object_key: presign.objectKey,
          expires_in: presign.expiresIn
        },
        content: [
          {
            type: "text",
            text:
              `Upload ready.\n\n` +
              `upload_url: ${presign.uploadUrl}\n` +
              `object_key: ${presign.objectKey}\n` +
              `expires_in: ${presign.expiresIn}\n\n` +
              `Next step: PUT the file to upload_url with header "Content-Type: ${input.mime_type}", ` +
              `then call ocr_to_markdown or transcribe_to_markdown with uploaded_file_reference="${presign.objectKey}".`
          }
        ]
      };
    })
  );

  registerTool(
    "fetch_result_file",
    {
      title: "Fetch Result File (HTTP)",
      description:
        "Get a temporary download URL for a result file from OCR/transcription output. " +
        "Use this to download images referenced as frenchie-result: in the result markdown.",
      inputSchema: fetchResultFileToolInputShape,
      outputSchema: {
        download_url: z.string().describe("Temporary HTTPS download URL for the result file."),
        filename: z.string().describe("Suggested filename derived from the original object key."),
        expires_in: z.number().int().positive().describe("URL expiry in seconds (typically 900).")
      },
      annotations: {
        title: "Fetch Result File (HTTP)",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    withToolErrors(async (args: unknown) => {
      const parsed = mcpFetchResultFileInputSchema.parse(args) as FetchResultFileToolInput;
      const apiKey = resolveApiKey(parsed.api_key, options.defaultApiKey);
      const result = await options.apiClient.getResultDownloadUrl(apiKey, parsed.object_key);

      const parts = parsed.object_key.split("/");
      const suggestedDir = parts.length >= 3 ? parts[2] : "download";
      const suggestedFilename = parts.at(-1) ?? "file";

      return {
        structuredContent: {
          download_url: result.downloadUrl,
          filename: result.filename,
          expires_in: result.expiresIn
        },
        content: [
          {
            type: "text" as const,
            text: [
              `Download URL (expires in ${result.expiresIn}s):`,
              result.downloadUrl,
              "",
              "Save to disk with:",
              `curl -o ".frenchie/${suggestedDir}/${suggestedFilename}" "${result.downloadUrl}"`
            ].join("\n")
          }
        ]
      };
    })
  );
}

interface ToolRunResult {
  result: McpToolResult;
  jobId: string;
  apiKey: string;
  friendlyName?: string;
  filePath?: string;
}

interface ImageGenerationToolRunResult {
  input: ImageGenerationJobCreateSchema;
  response: ImageGenerationJobCreateResponse;
  apiKey: string;
  outputDir?: string;
}

async function runImageGenerationTool(
  rawArgs: unknown,
  options: ToolOptions
): Promise<ImageGenerationToolRunResult> {
  const wrapped = z.object(generateImageToolInputShape).parse(rawArgs);
  const { api_key: rawApiKey, output_dir: outputDir, ...rest } = wrapped;
  const args = imageGenerationJobCreateSchema.parse(rest);
  const apiKey = resolveApiKey(rawApiKey, options.defaultApiKey);
  const initialResponse = await options.apiClient.createImageGenerationJob(apiKey, args);

  // Worker enqueues image generation into BullMQ so the HTTP request
  // never blocks on the gpt-image-2 call. Smart-wait polls for up to
  // smartWaitTimeoutMs so well-behaved agents see a `done` response
  // without having to call `get_job_result` explicitly.
  if (initialResponse.status === "done") {
    return { input: args, response: initialResponse, apiKey, outputDir };
  }

  const resolved = await waitForQueuedImageGenerationJob(apiKey, initialResponse, options);
  return { input: args, response: resolved, apiKey, outputDir };
}

async function waitForQueuedImageGenerationJob(
  apiKey: string,
  queuedResponse: { jobId: string; status: "queued"; estimatedSeconds?: number },
  options: ToolOptions
): Promise<ImageGenerationJobCreateResponse> {
  const deadline = Date.now() + options.smartWaitTimeoutMs;

  while (true) {
    const rawResult = await options.apiClient.getJobResult(apiKey, queuedResponse.jobId).catch((error) => {
      if (error instanceof ApiError && error.statusCode === 410) {
        throw new Error("Image generation result has expired and is no longer available.");
      }
      throw error;
    });

    if (rawResult.status === "done") {
      return synthesiseImageGenerationResponse(queuedResponse.jobId, rawResult);
    }

    if (rawResult.status === "failed") {
      const job = await options.apiClient.getJob(apiKey, queuedResponse.jobId);
      throw new Error(job.errorMessage ?? "Image generation job failed.");
    }

    if (Date.now() >= deadline) {
      return {
        jobId: queuedResponse.jobId,
        status: "queued",
        estimatedSeconds:
          rawResult.estimatedSeconds ?? queuedResponse.estimatedSeconds
      };
    }

    await sleep(options.smartWaitIntervalMs);
  }
}

async function runOcrTool(rawArgs: unknown, options: ToolOptions): Promise<ToolRunResult> {
  const args = mcpOcrInputSchema.parse(rawArgs) as OcrToMarkdownToolInput;
  assertFilePathAllowed(args, options.transportMode);
  const apiKey = resolveApiKey(args.api_key, options.defaultApiKey);

  if (isFilePathInput(args)) {
    const file = await prepareOcrLocalFile(args.file_path);
    const upload = await options.apiClient.uploadFile(apiKey, file);
    const response = await options.apiClient.createOcrJob(apiKey, {
      objectKey: upload.objectKey,
      mimeType: file.mimeType
    });
    const result = await resolveCreateJobResponse(apiKey, response, options, friendlyNameFromPath(args.file_path));
    return { ...result, apiKey, filePath: args.file_path };
  }

  const response = await options.apiClient.createOcrJob(apiKey, {
    objectKey: args.uploaded_file_reference
  });
  const result = await resolveCreateJobResponse(apiKey, response, options, friendlyNameFromPath(args.uploaded_file_reference));
  return { ...result, apiKey };
}

async function runTranscriptionTool(
  rawArgs: unknown,
  options: ToolOptions
): Promise<ToolRunResult> {
  const args = mcpTranscriptionInputSchema.parse(rawArgs) as TranscribeToMarkdownToolInput;
  assertFilePathAllowed(args, options.transportMode);
  const apiKey = resolveApiKey(args.api_key, options.defaultApiKey);
  // Tool-level `language` always wins; otherwise fall back to the
  // session-level default (FRENCHIE_DEFAULT_LANGUAGE env / X-Frenchie-Default-Language header).
  const resolvedLanguage = args.language ?? options.defaultLanguage;
  const transcriptionOptions = resolvedLanguage ? { language: resolvedLanguage } : undefined;

  if (isFilePathInput(args)) {
    const file = await prepareTranscriptionLocalFile(args.file_path);
    const upload = await options.apiClient.uploadFile(apiKey, file);
    const response = await options.apiClient.createTranscriptionJob(apiKey, {
      objectKey: upload.objectKey,
      mimeType: file.mimeType,
      options: transcriptionOptions
    });
    const result = await resolveCreateJobResponse(apiKey, response, options, friendlyNameFromPath(args.file_path));
    return { ...result, apiKey, filePath: args.file_path };
  }

  const response = await options.apiClient.createTranscriptionJob(apiKey, {
    objectKey: args.uploaded_file_reference,
    options: transcriptionOptions
  });
  const result = await resolveCreateJobResponse(apiKey, response, options, friendlyNameFromPath(args.uploaded_file_reference));
  return { ...result, apiKey };
}

function renderMarkdownJobResult(
  jobId: string,
  rawResult: JobResultResponse
): { result: McpToolResult; friendlyName?: string } {
  const friendlyName = rawResult.inputFilename
    ? friendlyNameFromPath(rawResult.inputFilename)
    : undefined;

  if (
    rawResult.status === "done" &&
    rawResult.resultAvailable &&
    rawResult.result?.kind === "markdown" &&
    rawResult.result.markdown
  ) {
    return {
      result: {
        status: "done",
        jobId,
        creditsUsed: rawResult.creditsUsed,
        resultExpiresAt: rawResult.resultExpiresAt,
        result: rawResult.result
      },
      friendlyName
    };
  }

  if (rawResult.status === "failed") {
    throw new Error("Job failed.");
  }

  const estimatedCompletion = rawResult.estimatedSeconds
    ? new Date(Date.now() + rawResult.estimatedSeconds * 1000).toISOString()
    : undefined;

  return {
    result: { status: "processing", jobId, estimatedCompletion },
    friendlyName
  };
}

function synthesiseImageGenerationResponse(
  jobId: string,
  rawResult: JobResultResponse
): ImageGenerationJobCreateResponse {
  if (rawResult.status !== "done") {
    return {
      jobId,
      status: "queued",
      estimatedSeconds: rawResult.estimatedSeconds
    };
  }

  const envelope = rawResult.result;
  if (!envelope || envelope.kind !== "image" || !envelope.imageUrl) {
    throw new Error("Image generation result has expired and is no longer available.");
  }

  return {
    jobId,
    status: "done",
    creditsUsed: rawResult.creditsUsed ?? CREDIT_RATES.IMAGE_GENERATION_PER_IMAGE,
    resultExpiresAt:
      rawResult.resultExpiresAt ??
      new Date(Date.now() + RESULT_RETENTION_MINUTES * 60 * 1000).toISOString(),
    result: envelope
  };
}

async function resolveCreateJobResponse(
  apiKey: string,
  response:
    | {
        jobId: string;
        status: "done";
        creditsUsed?: number;
        resultExpiresAt?: string;
        result?: CapabilityResult;
      }
    | { jobId: string; status: "queued"; estimatedSeconds?: number },
  options: ToolOptions,
  friendlyName?: string
): Promise<ToolRunResult> {
  if (response.status === "done") {
    return {
      result: {
        status: "done",
        jobId: response.jobId,
        creditsUsed: response.creditsUsed,
        resultExpiresAt: response.resultExpiresAt,
        result: response.result
      },
      jobId: response.jobId,
      apiKey,
      friendlyName
    };
  }

  // Smart wait: poll internally for up to ~90s before returning "processing"
  return waitForQueuedJob(apiKey, response.jobId, options, friendlyName, response.estimatedSeconds);
}

async function waitForQueuedJob(
  apiKey: string,
  jobId: string,
  options: ToolOptions,
  friendlyName?: string,
  estimatedSeconds?: number
): Promise<ToolRunResult> {
  // Cap smart-wait at the configured timeout (default 90s) so agents aren't blocked
  const timeoutMs = options.smartWaitTimeoutMs;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const { mcpResult } = await fetchJobResult(apiKey, jobId, options);
    if (mcpResult.status === "done") {
      return { result: mcpResult, jobId, apiKey, friendlyName };
    }

    if (Date.now() >= deadline) {
      const remainingSeconds = estimatedSeconds
        ? Math.max(0, estimatedSeconds - Math.floor((Date.now() - (deadline - timeoutMs)) / 1000))
        : undefined;
      const estimatedCompletion = remainingSeconds && remainingSeconds > 0
        ? new Date(Date.now() + remainingSeconds * 1000).toISOString()
        : undefined;

      return {
        result: { status: "processing", jobId, estimatedCompletion },
        jobId,
        apiKey,
        friendlyName
      };
    }

    await sleep(options.smartWaitIntervalMs);
  }
}

interface FetchJobResultOutput {
  mcpResult: McpToolResult;
  inputFilename?: string;
}

async function fetchJobResult(
  apiKey: string,
  jobId: string,
  options: ToolOptions
): Promise<FetchJobResultOutput> {
  try {
    const result = await options.apiClient.getJobResult(apiKey, jobId);
    if (
      result.status === "done" &&
      result.resultAvailable &&
      result.result?.kind === "markdown" &&
      result.result.markdown
    ) {
      return {
        mcpResult: {
          status: "done",
          jobId,
          creditsUsed: result.creditsUsed,
          resultExpiresAt: result.resultExpiresAt,
          result: result.result
        },
        inputFilename: result.inputFilename
      };
    }

    if (result.status === "failed") {
      const job = await options.apiClient.getJob(apiKey, jobId);
      throw new Error(job.errorMessage ?? "Job failed.");
    }

    const estimatedCompletion = result.estimatedSeconds
      ? new Date(Date.now() + result.estimatedSeconds * 1000).toISOString()
      : undefined;

    return {
      mcpResult: {
        status: "processing",
        jobId,
        estimatedCompletion
      },
      inputFilename: result.inputFilename
    };
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 410) {
      throw error;
    }

    throw error;
  }
}

interface ToToolSuccessContext {
  outputDir: string;
  /** Real job ID — used as the storage key for HTTP result files. */
  storageJobId: string;
  /** Human-friendly name for local folder naming (derived from filename). */
  localFolderName: string;
  transportMode: "stdio" | "http";
  apiClient: ApiClient;
  apiKey: string;
}

async function toToolSuccess(result: McpToolResult, ctx: ToToolSuccessContext) {
  const structuredContent = mcpToolResultSchema.parse(result);

  if (structuredContent.status !== "done") {
    const eta = structuredContent.estimatedCompletion
      ? ` Estimated completion: ${structuredContent.estimatedCompletion}.`
      : "";
    return {
      structuredContent,
      content: [
        {
          type: "text" as const,
          text: `Job is processing in the background.${eta} Use get_job_result with jobId="${structuredContent.jobId}" to check when it's done.`
        }
      ]
    };
  }

  // Markdown path (OCR + transcription) — extract embedded base64 images and
  // either stash them as frenchie-result: refs (HTTP) or write them next to
  // the saved result.md (stdio). Non-markdown results fall through to a
  // pass-through: the caller already built a full CapabilityResult envelope
  // in `structuredContent.result` (e.g. image generation), so we just return
  // it unchanged and trust the caller's formatting.
  if (structuredContent.result?.kind !== "markdown") {
    return {
      structuredContent,
      content: [
        {
          type: "text" as const,
          text: `Job done. creditsUsed=${structuredContent.creditsUsed ?? 0}`
        }
      ]
    };
  }

  const rawMarkdown = structuredContent.result.markdown ?? "";
  const { markdownWithPlaceholders, images } = extractEmbeddedImages(rawMarkdown);

  if (ctx.transportMode === "http") {
    return toToolSuccessHttp(structuredContent, markdownWithPlaceholders, images, ctx.storageJobId, ctx);
  }

  return toToolSuccessStdio(structuredContent, markdownWithPlaceholders, images, ctx.localFolderName, ctx.outputDir);
}

type McpDoneStructuredContent = {
  status: "done";
  jobId?: string;
  creditsUsed?: number;
  resultExpiresAt?: string;
  result?: CapabilityResult;
};

async function toToolSuccessHttp(
  structuredContent: McpDoneStructuredContent,
  markdownWithPlaceholders: string,
  images: ExtractedImage[],
  jobId: string,
  ctx: ToToolSuccessContext
) {
  let finalMarkdown = markdownWithPlaceholders;
  const storedKeys: Array<{ objectKey: string; filename: string }> = [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (!img) continue;
    const ext = mimeTypeToExt(img.mimeType);
    const filename = sanitizeImageFilename(img.alt, i, ext);
    const placeholder = `{{FRENCHIE_IMAGE_${i}}}`;

    try {
      const { objectKey } = await ctx.apiClient.storeResultFile(ctx.apiKey, {
        jobId,
        filename,
        contentType: img.mimeType,
        data: img.data
      });
      storedKeys.push({ objectKey, filename });
      finalMarkdown = finalMarkdown.replaceAll(
        placeholder,
        `![${img.alt}](frenchie-result:${objectKey})`
      );
    } catch {
      // Fallback: keep image inline as base64 if upload fails
      finalMarkdown = finalMarkdown.replaceAll(
        placeholder,
        `![${img.alt}](data:${img.mimeType};base64,${img.data})`
      );
    }
  }

  finalMarkdown = finalMarkdown.replace(/\{\{FRENCHIE_IMAGE_\d+\}\}/g, "[image unavailable]");

  const folderName = jobId;
  const downloadNote = storedKeys.length > 0
    ? [
        "",
        "---",
        `This result contains ${storedKeys.length} image(s) stored on the server.`,
        `Save to: .frenchie/${folderName}/`,
        "To download, call `fetch_result_file` for each object_key, then save with curl:",
        ...storedKeys.map(
          (k) => `- object_key: "${k.objectKey}" → curl -o ".frenchie/${folderName}/${k.filename}"`
        ),
        `Then write the markdown (with image refs replaced by local filenames) to .frenchie/${folderName}/result.md`
      ].join("\n")
    : "";

  return {
    structuredContent: {
      ...structuredContent,
      result: { kind: "markdown" as const, markdown: finalMarkdown }
    },
    content: [
      { type: "text" as const, text: finalMarkdown + downloadNote }
    ]
  };
}

async function toToolSuccessStdio(
  structuredContent: McpDoneStructuredContent,
  markdownWithPlaceholders: string,
  images: ExtractedImage[],
  jobId: string,
  outputDir: string
) {
  const { savedPaths } = await saveResultToDisk(
    markdownWithPlaceholders,
    images,
    jobId,
    outputDir
  );

  // Path-only response: the server has already persisted result.md to disk, so
  // returning the full markdown again here would double-book the agent's
  // context window. Instead, the agent sees a one-line note + structured
  // metadata and uses its own file-reading tool on the saved path if it needs
  // the bytes. HTTP mode keeps the inline markdown because remote clients
  // have no disk access.
  const resultMdPath = join(outputDir, ".frenchie", jobId, "result.md");
  const savedResultMd = savedPaths.find((p) => p === resultMdPath) ?? resultMdPath;
  const relPath = normalizeRelativePath(relative(outputDir, savedResultMd));
  const markdownBody =
    structuredContent.result?.kind === "markdown" ? structuredContent.result.markdown ?? "" : "";
  const wordCount = countWords(markdownBody);
  const imageCount = images.length;

  const imageNote = imageCount > 0 ? `, ${imageCount} image${imageCount === 1 ? "" : "s"}` : "";

  return {
    structuredContent: {
      status: structuredContent.status,
      jobId: structuredContent.jobId,
      creditsUsed: structuredContent.creditsUsed,
      resultExpiresAt: structuredContent.resultExpiresAt,
      result: {
        kind: "markdown" as const,
        savedTo: relPath,
        wordCount,
        imageCount
      }
    },
    content: [
      {
        type: "text" as const,
        text: `Saved to ${relPath} (~${wordCount} words${imageNote}). Read that file with your file tool if you need the content — stdio mode does not return markdown inline to keep your context window lean.`
      }
    ]
  };
}

function normalizeRelativePath(p: string): string {
  // Normalize Windows backslashes so the agent sees the same path regardless
  // of platform, and fall back to the raw string if `relative` returned
  // something empty (outputDir === resultMdPath, theoretically impossible).
  return p.replace(/\\/g, "/");
}

function countWords(markdown: string): number {
  const trimmed = markdown.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

interface ExtractedImage {
  alt: string;
  data: string;
  mimeType: string;
}

function extractEmbeddedImages(markdown: string): {
  markdownWithPlaceholders: string;
  images: ExtractedImage[];
} {
  const images: ExtractedImage[] = [];
  let figureIndex = 0;

  // Match ![alt](data:mimeType;base64,base64data)
  // base64data cannot contain ')' so [^)]+ is safe and efficient
  const markdownWithPlaceholders = markdown.replace(
    /!\[([^\]]*)\]\(data:([^;)]+);base64,([^)]+)\)/g,
    (_, alt: string, mimeType: string, base64Data: string) => {
      const index = images.length;
      figureIndex++;
      images.push({ alt: alt || `figure-${figureIndex}`, data: base64Data, mimeType });
      // Use indexed placeholder so we can replace with local path after saving
      return `{{FRENCHIE_IMAGE_${index}}}`;
    }
  );

  return { markdownWithPlaceholders, images };
}

async function saveResultToDisk(
  markdownWithPlaceholders: string,
  images: ExtractedImage[],
  folderName: string,
  outputDir: string
): Promise<{ finalMarkdown: string; savedPaths: string[] }> {
  const jobOutputDir = join(outputDir, ".frenchie", folderName);
  const savedPaths: string[] = [];

  await mkdir(jobOutputDir, { recursive: true });

  // Two versions of markdown:
  // - finalMarkdown: image paths relative to outputDir (for MCP response / notes at project root)
  // - resultMdMarkdown: image paths relative to result.md itself (just the filename)
  let finalMarkdown = markdownWithPlaceholders;
  let resultMdMarkdown = markdownWithPlaceholders;

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (!img) continue;
    const ext = mimeTypeToExt(img.mimeType);
    const filename = sanitizeImageFilename(img.alt, i, ext);
    const filePath = join(jobOutputDir, filename);

    await writeFile(filePath, Buffer.from(img.data, "base64"));
    savedPaths.push(filePath);

    const placeholder = `{{FRENCHIE_IMAGE_${i}}}`;

    // Path from outputDir root (for MCP response markdown)
    const relativeFromOutputDir = join(".frenchie", folderName, filename);
    finalMarkdown = finalMarkdown.replaceAll(
      placeholder,
      `![${img.alt}](${relativeFromOutputDir})`
    );

    // Path relative to result.md (just the filename, since it lives next to the images)
    resultMdMarkdown = resultMdMarkdown.replaceAll(
      placeholder,
      `![${img.alt}](${filename})`
    );
  }

  // Replace any remaining placeholders (images that failed to save)
  finalMarkdown = finalMarkdown.replace(/\{\{FRENCHIE_IMAGE_\d+\}\}/g, "[image unavailable]");
  resultMdMarkdown = resultMdMarkdown.replace(/\{\{FRENCHIE_IMAGE_\d+\}\}/g, "[image unavailable]");

  // Always write result.md (transcription text or OCR with image paths)
  await writeFile(join(jobOutputDir, "result.md"), resultMdMarkdown, "utf8");
  savedPaths.push(join(jobOutputDir, "result.md"));

  return { finalMarkdown, savedPaths };
}

function mimeTypeToExt(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg": return ".jpeg";
    case "image/png": return ".png";
    case "image/webp": return ".webp";
    case "image/gif": return ".gif";
    default: return ".bin";
  }
}

function sanitizeImageFilename(alt: string, index: number, ext: string): string {
  // Use the alt text as filename (Mistral typically gives "img-0.jpeg" etc.)
  // Strip existing extension from alt if present, then re-add the correct one
  const base = alt
    .replace(/\.[^.]+$/, "") // remove existing extension
    .replace(/[^\w-]/g, "-") // replace non-word chars
    .replace(/-+/g, "-")     // collapse multiple dashes
    .slice(0, 80)            // limit length
    || `image-${index}`;
  return `${base}${ext}`;
}

function withToolErrors(callback: (args: unknown) => Promise<unknown>) {
  return async (args: unknown) => {
    try {
      return await callback(args);
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : "Unexpected MCP error."
          }
        ]
      };
    }
  };
}

function resolveApiKey(inputApiKey: string | undefined, defaultApiKey: string | undefined): string {
  const apiKey = inputApiKey?.trim() || defaultApiKey?.trim();
  if (!apiKey) {
    throw new Error("Frenchie API key is required. Provide api_key or set FRENCHIE_API_KEY.");
  }

  return apiKey;
}

function isFilePathInput(
  input: OcrToMarkdownToolInput | TranscribeToMarkdownToolInput
): input is Extract<OcrToMarkdownToolInput, { file_path: string }> {
  return "file_path" in input;
}

function assertFilePathAllowed(
  input: OcrToMarkdownToolInput | TranscribeToMarkdownToolInput,
  transportMode: "stdio" | "http"
): void {
  if (transportMode === "http" && isFilePathInput(input)) {
    throw new Error(HTTP_FILE_PATH_ERROR);
  }
}

function friendlyNameFromPath(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  const name = basename(filePath, extname(filePath))
    .replace(/[^\w-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return name || undefined;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

const IMAGE_FORMAT_TO_EXT: Record<string, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp"
};

function imageGenerationFriendlyName(prompt: string): string {
  // Slug rules from spec section 7.1: derive from prompt only,
  // deterministic, replace spaces and dangerous chars with `-`,
  // truncate to 80 chars, fallback to "image-generation".
  const sanitized = prompt
    .trim()
    .replace(/\s+/g, "-")
    // Strip filesystem-dangerous characters but keep Unicode word characters
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return sanitized.length > 0 ? sanitized : "image-generation";
}

async function toImageGenerationToolSuccess(
  response: ImageGenerationJobCreateResponse,
  input: ImageGenerationJobCreateSchema,
  ctx: ToToolSuccessContext
) {
  if (response.status === "queued") {
    const eta = response.estimatedSeconds
      ? new Date(Date.now() + response.estimatedSeconds * 1000).toISOString()
      : undefined;
    return {
      structuredContent: {
        status: "processing" as const,
        jobId: response.jobId,
        estimatedCompletion: eta
      },
      content: [
        {
          type: "text" as const,
          text:
            `Image generation queued. Use get_job_result with jobId="${response.jobId}" ` +
            `to check when it's done.${eta ? ` Estimated completion: ${eta}.` : ""}`
        }
      ]
    };
  }

  const imageResult = response.result;
  if (imageResult.kind !== "image") {
    throw new Error("Expected image result from generate_image");
  }

  const envelopeBase = {
    status: "done" as const,
    jobId: response.jobId,
    creditsUsed: response.creditsUsed,
    resultExpiresAt: response.resultExpiresAt
  };

  if (ctx.transportMode === "http") {
    return {
      structuredContent: {
        ...envelopeBase,
        result: imageResult
      },
      content: [
        {
          type: "text" as const,
          text:
            `Image generated (${imageResult.format}, ${imageResult.mimeType}).\n\n` +
            `Download URL: ${imageResult.imageUrl}\n\n` +
            `Result expires at ${response.resultExpiresAt}. ` +
            `Download the image to the user's machine before that, ` +
            `or render it directly in the agent UI.`
        }
      ]
    };
  }

  // Stdio: download the image and persist to .frenchie/<slug>/generated.<ext>
  const ext = IMAGE_FORMAT_TO_EXT[imageResult.format] ?? imageResult.format;
  const folder = join(ctx.outputDir, ".frenchie", ctx.localFolderName);
  const filename = `generated.${ext}`;
  const filePath = join(folder, filename);

  await mkdir(folder, { recursive: true });

  if (!imageResult.imageUrl) {
    throw new Error("Image generation result is missing imageUrl");
  }

  // The credit debit happens on the worker before this download — if the
  // fetch fails the user is already charged 20 credits. Surface jobId + a
  // retry hint so the agent can recover via get_job_result within the
  // 30-minute result window without re-generating the image.
  const downloadResponse = await fetch(imageResult.imageUrl).catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Image generation succeeded but the stdio download failed (${detail}). ` +
      `Call get_job_result with jobId="${response.jobId}" within ~30 minutes to retry.`
    );
  });
  if (!downloadResponse.ok) {
    throw new Error(
      `Image generation succeeded but the stdio download failed (HTTP ${downloadResponse.status}). ` +
      `Call get_job_result with jobId="${response.jobId}" within ~30 minutes to retry.`
    );
  }
  const buffer = Buffer.from(await downloadResponse.arrayBuffer());
  await writeFile(filePath, buffer);

  const relPath = normalizeRelativePath(relative(ctx.outputDir, filePath));
  const styleNote = input.style ? ` Style: ${input.style}.` : "";
  return {
    structuredContent: {
      ...envelopeBase,
      result: {
        kind: "image" as const,
        format: imageResult.format,
        mimeType: imageResult.mimeType,
        size: imageResult.size,
        background: imageResult.background,
        style: imageResult.style,
        savedTo: relPath
      }
    },
    content: [
      {
        type: "text" as const,
        text:
          `Image saved to ${relPath} (${imageResult.format}, ${buffer.byteLength} bytes).${styleNote} ` +
          `Stdio mode persisted the image locally — no further download required.`
      }
    ]
  };
}
