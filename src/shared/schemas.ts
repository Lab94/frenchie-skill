import { z } from "zod";
import {
  BILLING_MODES,
  CREDIT_PACK_IDS,
  DEFAULT_LEDGER_LIST_LIMIT,
  DEFAULT_JOB_LIST_LIMIT,
  DASHBOARD_RECENT_JOBS_LIMIT,
  FILE_SIZE_LIMIT_BYTES,
  IMAGE_GENERATION_BACKGROUNDS,
  IMAGE_GENERATION_COMBINED_MAX_LENGTH,
  IMAGE_GENERATION_FORMATS,
  IMAGE_GENERATION_PROMPT_MAX_LENGTH,
  IMAGE_GENERATION_QUALITIES,
  IMAGE_GENERATION_SIZES,
  IMAGE_GENERATION_STYLE_MAX_LENGTH,
  MIN_STRIPE_TOP_UP_AMOUNT_USD_CENTS,
  MAX_LEDGER_LIST_LIMIT,
  MAX_JOB_LIST_LIMIT,
  RESULT_IMAGE_MIME_TYPES,
  SUPPORTED_EXTRACTION_MIME_TYPES,
  SUPPORTED_MIME_TYPES,
  SUPPORTED_OCR_MIME_TYPES,
  SUPPORTED_TRANSCRIPTION_MIME_TYPES
} from "./constants";

const mimeTypeSchema = z
  .string()
  .min(1)
  .refine((value) => SUPPORTED_MIME_TYPES.includes(value as (typeof SUPPORTED_MIME_TYPES)[number]), {
    message: "Unsupported file type"
  });

const integerQueryParamSchema = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value[0];
  }

  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }

    if (!/^[+-]?\d+$/.test(trimmed)) {
      return Number.NaN;
    }

    return Number.parseInt(trimmed, 10);
  }

  return value;
}, z.number().int().finite().optional());

const jobTypeSchema = z.enum(["ocr", "transcription", "image_generation", "extraction"]);
const creditAmountSchema = z.number().finite();
const nonnegativeCreditAmountSchema = creditAmountSchema.nonnegative();

export const strongPasswordSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/[A-Z]/, "Must contain at least one uppercase letter")
  .regex(/[a-z]/, "Must contain at least one lowercase letter")
  .regex(/[0-9]/, "Must contain at least one number")
  .regex(/[^A-Za-z0-9]/, "Must contain at least one special character");

export const registerSchema = z.object({
  email: z.string().email(),
  password: strongPasswordSchema,
  name: z.string().trim().min(1).max(120).optional()
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128)
});

export const googleAuthSchema = z.object({
  idToken: z.string().min(1)
});

export const githubAuthSchema = z.object({
  accessToken: z.string().min(1)
});

export const forgotPasswordSchema = z.object({
  email: z.string().email()
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: strongPasswordSchema
});

export const setPasswordSchema = z.object({
  password: strongPasswordSchema
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1)
});

export const resendVerificationSchema = z.object({
  email: z.string().email()
});

export const authProviderSchema = z.enum(["CREDENTIALS", "GOOGLE", "GITHUB"]);

export const providerInfoSchema = z.object({
  provider: authProviderSchema,
  linkedAt: z.string().datetime()
});

export const linkedProvidersResponseSchema = z.object({
  providers: z.array(providerInfoSchema)
});

export const messageResponseSchema = z.object({
  message: z.string().min(1)
});

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional()
});

export const authUserResponseSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  emailVerified: z.boolean(),
  name: z.string().min(1).optional()
});

export const authResponseSchema = z.object({
  user: authUserResponseSchema,
  bootstrapApiKey: z.string().min(1).optional()
});

export const apiKeyListItemSchema = z.object({
  id: z.string().min(1),
  keyPrefix: z.string().min(1),
  name: z.string().min(1).optional(),
  status: z.enum(["ACTIVE", "REVOKED"]),
  lastUsedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime()
});

export const apiKeyListResponseSchema = z.array(apiKeyListItemSchema);

export const apiKeyCreateResponseSchema = apiKeyListItemSchema.extend({
  apiKey: z.string().min(1)
});

export const topUpSchema = z.object({
  amount: z.number().int().positive(),
  description: z.string().trim().min(1).max(240).optional()
});

export const billingModeSchema = z.enum(BILLING_MODES);
export const creditPackIdSchema = z.enum(CREDIT_PACK_IDS);
export const creditPackSchema = z.object({
  id: creditPackIdSchema,
  name: z.string().min(1),
  credits: z.number().int().positive(),
  amountUsdCents: z.number().int().positive(),
  description: z.string().min(1)
});

export const checkoutSessionCreateSchema = z.object({
  amountUsdCents: z.number().int().min(MIN_STRIPE_TOP_UP_AMOUNT_USD_CENTS)
});

export const checkoutSessionCreateResponseSchema = z.object({
  checkoutUrl: z.string().url()
});

export const uploadFileRequestSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  fileSize: z.number().int().positive().max(FILE_SIZE_LIMIT_BYTES),
  mimeType: mimeTypeSchema
});

export const uploadFileResponseSchema = z.object({
  objectKey: z.string().min(1)
});

export const uploadPresignResponseSchema = z.object({
  uploadUrl: z.string().url(),
  objectKey: z.string().min(1),
  expiresIn: z.number().int().positive()
});

export const jobCreateSchema = z.object({
  objectKey: z.string().trim().min(1).max(1024)
});

export const ocrJobCreateSchema = jobCreateSchema.extend({
  mimeType: z
    .string()
    .refine(
      (value) => SUPPORTED_OCR_MIME_TYPES.includes(value as (typeof SUPPORTED_OCR_MIME_TYPES)[number]),
      "Unsupported OCR file type"
    )
    .optional()
});

export const transcriptionJobOptionsSchema = z
  .object({
    speakers: z.boolean().optional().default(true),
    speakerNames: z.record(z.string().min(1), z.string().min(1).max(100)).optional(),
    language: z.string().min(2).max(10).optional()
  })
  .optional();

export const transcriptionJobCreateSchema = jobCreateSchema.extend({
  mimeType: z
    .string()
    .refine(
      (value) =>
        SUPPORTED_TRANSCRIPTION_MIME_TYPES.includes(
          value as (typeof SUPPORTED_TRANSCRIPTION_MIME_TYPES)[number]
        ),
      "Unsupported transcription file type"
    )
    .optional(),
  options: transcriptionJobOptionsSchema
});

export const extractJobCreateSchema = jobCreateSchema.extend({
  mimeType: z
    .string()
    .refine(
      (value) =>
        SUPPORTED_EXTRACTION_MIME_TYPES.includes(
          value as (typeof SUPPORTED_EXTRACTION_MIME_TYPES)[number]
        ),
      "Unsupported extraction file type"
    )
    .optional()
});

export type ExtractJobCreateSchema = z.infer<typeof extractJobCreateSchema>;

export const imageGenerationFormatSchema = z.enum(IMAGE_GENERATION_FORMATS);
export const imageGenerationSizeSchema = z.enum(IMAGE_GENERATION_SIZES);
export const imageGenerationQualitySchema = z.enum(IMAGE_GENERATION_QUALITIES);
export const imageGenerationBackgroundSchema = z.enum(IMAGE_GENERATION_BACKGROUNDS);

export const imageGenerationJobCreateSchema = z
  .object({
    prompt: z.string().trim().min(1).max(IMAGE_GENERATION_PROMPT_MAX_LENGTH),
    style: z.string().trim().max(IMAGE_GENERATION_STYLE_MAX_LENGTH).optional(),
    size: imageGenerationSizeSchema.optional(),
    quality: imageGenerationQualitySchema.optional(),
    format: imageGenerationFormatSchema.optional(),
    background: imageGenerationBackgroundSchema.optional()
  })
  .refine(
    (value) =>
      value.prompt.length + (value.style?.length ?? 0) <=
      IMAGE_GENERATION_COMBINED_MAX_LENGTH,
    {
      message: `Combined prompt + style length must not exceed ${IMAGE_GENERATION_COMBINED_MAX_LENGTH} characters`,
      path: ["prompt"]
    }
  )
  .refine(
    (value) => !(value.background === "transparent" && value.format === "jpeg"),
    {
      message: "background=transparent is not supported with format=jpeg",
      path: ["background"]
    }
  );

export const markdownResultSchema = z.object({
  kind: z.literal("markdown"),
  markdown: z.string().optional(),
  savedTo: z.string().optional(),
  pages: z.number().int().nonnegative().optional(),
  wordCount: z.number().int().nonnegative().optional(),
  imageCount: z.number().int().nonnegative().optional()
});

export const imageResultSchema = z.object({
  kind: z.literal("image"),
  format: imageGenerationFormatSchema,
  mimeType: z.string().min(1),
  size: imageGenerationSizeSchema.optional(),
  background: imageGenerationBackgroundSchema.optional(),
  style: z.string().optional(),
  imageUrl: z.string().url().optional(),
  savedTo: z.string().optional()
});

export const capabilityResultSchema = z.discriminatedUnion("kind", [
  markdownResultSchema,
  imageResultSchema
]);

export const capabilitySyncResponseSchema = z.object({
  jobId: z.string().min(1),
  status: z.literal("done"),
  creditsUsed: nonnegativeCreditAmountSchema,
  resultExpiresAt: z.string().datetime(),
  result: capabilityResultSchema
});

export const ocrJobSyncResponseSchema = capabilitySyncResponseSchema;
export const transcriptionJobSyncResponseSchema = capabilitySyncResponseSchema;
export const imageGenerationJobSyncResponseSchema = capabilitySyncResponseSchema;

export const asyncJobQueuedResponseSchema = z.object({
  jobId: z.string().min(1),
  status: z.literal("queued"),
  estimatedSeconds: z.number().int().positive().optional()
});

export const ocrJobCreateResponseSchema = z.union([
  ocrJobSyncResponseSchema,
  asyncJobQueuedResponseSchema
]);

export const transcriptionJobCreateResponseSchema = z.union([
  transcriptionJobSyncResponseSchema,
  asyncJobQueuedResponseSchema
]);

export const imageGenerationJobCreateResponseSchema = z.union([
  imageGenerationJobSyncResponseSchema,
  asyncJobQueuedResponseSchema
]);

export const extractionJobCreateResponseSchema = z.union([
  capabilitySyncResponseSchema,
  asyncJobQueuedResponseSchema
]);

export const jobStatusSchema = z.enum(["queued", "processing", "done", "failed"]);
export const creditLedgerEntryTypeSchema = z.enum(["topup", "debit", "refund", "adjustment"]);
export const processingModeSchema = z.enum(["sync", "async"]);

/**
 * Dashboard metadata for image jobs — the user-facing image payload
 * (imageUrl, mimeType, format) lives on the envelope's `result` field,
 * not here. Dashboards call `/jobs/:id/result` for the fresh presigned
 * URL and read the generation details from this block on `/jobs/:id`.
 *
 * `prompt` + `style` are optional: they are cleared when the job result
 * expires so image jobs inherit the same retention policy as
 * OCR/transcription content (see RESULT_RETENTION_MINUTES).
 */
export const imageJobDetailResponseSchema = z.object({
  prompt: z.string().min(1).optional(),
  style: z.string().optional(),
  requestedSize: z.string().optional(),
  requestedQuality: z.string().optional(),
  requestedFormat: z.string().optional(),
  requestedBackground: z.string().optional(),
  effectiveSize: z.string().optional(),
  effectiveQuality: z.string().optional(),
  effectiveFormat: z.string().optional(),
  effectiveBackground: z.string().optional()
});

export const jobResponseSchema = z.object({
  id: z.string().min(1),
  type: jobTypeSchema,
  status: jobStatusSchema,
  syncOrAsync: processingModeSchema,
  inputFilename: z.string().min(1),
  creditsUsed: nonnegativeCreditAmountSchema.optional(),
  pageCount: z.number().int().optional(),
  durationMinutes: z.number().optional(),
  sheetCount: z.number().int().optional(),
  rowCount: z.number().int().optional(),
  slideCount: z.number().int().optional(),
  extractionFormat: z.enum(["docx", "xlsx", "csv", "tsv", "pptx"]).optional(),
  resultExpiresAt: z.string().datetime().optional(),
  resultAvailable: z.boolean(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  errorMessage: z.string().optional(),
  estimatedSeconds: z.number().int().positive().optional(),
  imageDetail: imageJobDetailResponseSchema.optional()
});

export const jobListQuerySchema = z
  .object({
    page: integerQueryParamSchema,
    limit: integerQueryParamSchema,
    type: jobTypeSchema.optional(),
    status: jobStatusSchema.optional()
  })
  .transform(({ page, limit, type, status }) => ({
    page: Math.max(1, page ?? 1),
    limit: Math.min(MAX_JOB_LIST_LIMIT, Math.max(1, limit ?? DEFAULT_JOB_LIST_LIMIT)),
    type,
    status
  }));

export const jobListResponseSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().positive(),
  hasNextPage: z.boolean(),
  jobs: z.array(jobResponseSchema)
});

export const creditLedgerListQuerySchema = z
  .object({
    page: integerQueryParamSchema,
    limit: integerQueryParamSchema
  })
  .transform(({ page, limit }) => ({
    page: Math.max(1, page ?? 1),
    limit: Math.min(MAX_LEDGER_LIST_LIMIT, Math.max(1, limit ?? DEFAULT_LEDGER_LIST_LIMIT))
  }));

export const creditLedgerEntryResponseSchema = z.object({
  id: z.string().min(1),
  type: creditLedgerEntryTypeSchema,
  amount: creditAmountSchema,
  balanceAfter: creditAmountSchema,
  referenceJobId: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  stripeReceiptUrl: z.string().url().optional(),
  createdAt: z.string().datetime()
});

export const creditLedgerListResponseSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().positive(),
  hasNextPage: z.boolean(),
  billingMode: billingModeSchema,
  availableTopUpPacks: z.array(creditPackSchema),
  canUseDevTopup: z.boolean(),
  entries: z.array(creditLedgerEntryResponseSchema)
});

export const jobResultResponseSchema = z.object({
  id: z.string().min(1),
  status: jobStatusSchema,
  // `type` is required so MCP clients can branch safely on kind
  // (e.g. `image_generation` → render presigned URL).
  type: jobTypeSchema,
  result: capabilityResultSchema.optional(),
  creditsUsed: nonnegativeCreditAmountSchema.optional(),
  imageDetail: imageJobDetailResponseSchema.optional(),
  resultExpiresAt: z.string().datetime().optional(),
  resultAvailable: z.boolean(),
  estimatedSeconds: z.number().int().positive().optional(),
  inputFilename: z.string().optional()
});

export const creditBalanceResponseSchema = z.object({
  credits: nonnegativeCreditAmountSchema
});

export const dashboardSummaryResponseSchema = z.object({
  balanceCredits: nonnegativeCreditAmountSchema,
  totalJobs: z.number().int().nonnegative(),
  totalCreditsUsed: nonnegativeCreditAmountSchema,
  recentJobs: z.array(jobResponseSchema).max(DASHBOARD_RECENT_JOBS_LIMIT)
});

export const apiErrorResponseSchema = z.object({
  statusCode: z.number().int(),
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional()
});

const mcpFilePathInputSchema = z.object({
  file_path: z.string().min(1),
  api_key: z.string().min(1).optional()
}).strict();

const mcpUploadedFileReferenceInputSchema = z.object({
  uploaded_file_reference: z.string().min(1),
  api_key: z.string().min(1).optional()
}).strict();

export const mcpOcrInputSchema = z.union([
  mcpFilePathInputSchema,
  mcpUploadedFileReferenceInputSchema
]);

export const mcpExtractionInputSchema = z.union([
  mcpFilePathInputSchema,
  mcpUploadedFileReferenceInputSchema
]);

const mcpTranscriptionFilePathInputSchema = z.object({
  file_path: z.string().min(1),
  api_key: z.string().min(1).optional(),
  language: z.string().min(2).max(10).optional()
}).strict();

const mcpTranscriptionUploadedInputSchema = z.object({
  uploaded_file_reference: z.string().min(1),
  api_key: z.string().min(1).optional(),
  language: z.string().min(2).max(10).optional()
}).strict();

export const mcpTranscriptionInputSchema = z.union([
  mcpTranscriptionFilePathInputSchema,
  mcpTranscriptionUploadedInputSchema
]);

export const mcpGetJobResultInputSchema = z.object({
  job_id: z.string().min(1),
  api_key: z.string().min(1).optional()
});

export const mcpAsyncResultSchema = z.object({
  status: z.literal("processing"),
  jobId: z.string().min(1),
  estimatedCompletion: z.string().datetime().optional()
});

/**
 * MCP-wire shape. Intentionally asymmetric with {@link capabilitySyncResponseSchema}:
 * on the worker HTTP API, a `done` response always carries a `result` payload,
 * but the stdio MCP path may omit it (e.g. after the file has been persisted to
 * disk, returning just the `savedTo` hint) so the tool output stays compact.
 * Downstream consumers should therefore treat `result` as optional here.
 */
export const mcpDoneResultSchema = z.object({
  status: z.literal("done"),
  jobId: z.string().min(1).optional(),
  creditsUsed: nonnegativeCreditAmountSchema.optional(),
  resultExpiresAt: z.string().datetime().optional(),
  result: capabilityResultSchema.optional()
});

export const mcpToolResultSchema = z.union([mcpAsyncResultSchema, mcpDoneResultSchema]);

export type RegisterSchema = z.infer<typeof registerSchema>;
export type LoginSchema = z.infer<typeof loginSchema>;
export type GoogleAuthSchema = z.infer<typeof googleAuthSchema>;
export type ApiKeyCreateSchema = z.infer<typeof apiKeyCreateSchema>;
export type AuthUserResponseSchema = z.infer<typeof authUserResponseSchema>;
export type AuthResponseSchema = z.infer<typeof authResponseSchema>;
export type ApiKeyListItemSchema = z.infer<typeof apiKeyListItemSchema>;
export type ApiKeyListResponseSchema = z.infer<typeof apiKeyListResponseSchema>;
export type ApiKeyCreateResponseSchema = z.infer<typeof apiKeyCreateResponseSchema>;
export type TopUpSchema = z.infer<typeof topUpSchema>;
export type BillingModeSchema = z.infer<typeof billingModeSchema>;
export type CreditPackIdSchema = z.infer<typeof creditPackIdSchema>;
export type CreditPackSchema = z.infer<typeof creditPackSchema>;
export type CheckoutSessionCreateSchema = z.infer<typeof checkoutSessionCreateSchema>;
export type CheckoutSessionCreateResponseSchema = z.infer<typeof checkoutSessionCreateResponseSchema>;
export type UploadFileRequestSchema = z.infer<typeof uploadFileRequestSchema>;
export type UploadFileResponseSchema = z.infer<typeof uploadFileResponseSchema>;
export type JobCreateSchema = z.infer<typeof jobCreateSchema>;
export type AsyncJobQueuedResponseSchema = z.infer<typeof asyncJobQueuedResponseSchema>;
export type OcrJobSyncResponseSchema = z.infer<typeof ocrJobSyncResponseSchema>;
export type TranscriptionJobSyncResponseSchema = z.infer<typeof transcriptionJobSyncResponseSchema>;
export type OcrJobCreateResponseSchema = z.infer<typeof ocrJobCreateResponseSchema>;
export type TranscriptionJobCreateResponseSchema = z.infer<
  typeof transcriptionJobCreateResponseSchema
>;
export type ImageGenerationJobCreateSchema = z.infer<typeof imageGenerationJobCreateSchema>;
export type ImageGenerationJobSyncResponseSchema = z.infer<
  typeof imageGenerationJobSyncResponseSchema
>;
export type ImageGenerationJobCreateResponseSchema = z.infer<
  typeof imageGenerationJobCreateResponseSchema
>;
export type ExtractionJobCreateResponseSchema = z.infer<typeof extractionJobCreateResponseSchema>;
export type ImageResultSchema = z.infer<typeof imageResultSchema>;
export type JobResponseSchema = z.infer<typeof jobResponseSchema>;
export type JobListQuerySchema = z.infer<typeof jobListQuerySchema>;
export type JobListResponseSchema = z.infer<typeof jobListResponseSchema>;
export type JobResultResponseSchema = z.infer<typeof jobResultResponseSchema>;
export type VerifyEmailSchema = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationSchema = z.infer<typeof resendVerificationSchema>;
export type CreditLedgerListQuerySchema = z.infer<typeof creditLedgerListQuerySchema>;
export type CreditLedgerEntryResponseSchema = z.infer<typeof creditLedgerEntryResponseSchema>;
export type CreditLedgerListResponseSchema = z.infer<typeof creditLedgerListResponseSchema>;
export type DashboardSummaryResponseSchema = z.infer<typeof dashboardSummaryResponseSchema>;
export type McpAsyncResultSchema = z.infer<typeof mcpAsyncResultSchema>;
export type McpDoneResultSchema = z.infer<typeof mcpDoneResultSchema>;
export type TranscriptionJobOptionsSchema = z.infer<typeof transcriptionJobOptionsSchema>;
export type McpToolResultSchema = z.infer<typeof mcpToolResultSchema>;
export type McpExtractionInputSchema = z.infer<typeof mcpExtractionInputSchema>;

const resultImageMimeTypeSchema = z
  .string()
  .min(1)
  .refine(
    (value) => RESULT_IMAGE_MIME_TYPES.includes(value as (typeof RESULT_IMAGE_MIME_TYPES)[number]),
    { message: "Unsupported result image type" }
  );

export const resultPresignStoreRequestSchema = z.object({
  jobId: z.string().trim().min(1).max(255),
  filename: z.string().trim().min(1).max(255),
  contentType: resultImageMimeTypeSchema
});

export const resultPresignStoreResponseSchema = z.object({
  uploadUrl: z.string().url(),
  objectKey: z.string().min(1),
  expiresIn: z.number().int().positive()
});

export const resultDownloadUrlRequestSchema = z.object({
  objectKey: z.string().trim().min(1).max(1024)
});

export const resultDownloadUrlResponseSchema = z.object({
  downloadUrl: z.string().url(),
  filename: z.string().min(1),
  expiresIn: z.number().int().positive()
});

export const mcpFetchResultFileInputSchema = z.object({
  object_key: z.string().min(1),
  api_key: z.string().min(1).optional()
});

export const dataSubjectRequestTypeSchema = z.enum(["deletion", "export"]);
export const dataSubjectRequestStatusSchema = z.enum(["pending", "completed", "failed"]);

export const accountExportResponseSchema = z.object({
  user: z.object({
    id: z.string().min(1),
    email: z.string().email(),
    name: z.string().min(1).optional(),
    createdAt: z.string().datetime()
  }),
  jobs: z.array(
    z.object({
      id: z.string().min(1),
      type: jobTypeSchema,
      status: jobStatusSchema,
      inputFilename: z.string().min(1),
      creditsUsed: nonnegativeCreditAmountSchema.optional(),
      createdAt: z.string().datetime(),
      completedAt: z.string().datetime().optional()
    })
  ),
  creditLedger: z.array(
    z.object({
      id: z.string().min(1),
      type: creditLedgerEntryTypeSchema,
      amount: z.number().int(),
      balanceAfter: z.number().int(),
      description: z.string().min(1).optional(),
      createdAt: z.string().datetime()
    })
  ),
  dataSubjectRequests: z.array(
    z.object({
      id: z.string().min(1),
      type: dataSubjectRequestTypeSchema,
      status: dataSubjectRequestStatusSchema,
      createdAt: z.string().datetime(),
      completedAt: z.string().datetime().optional()
    })
  )
});

export const accountDeleteResponseSchema = z.object({
  message: z.string().min(1)
});

export type AccountExportResponseSchema = z.infer<typeof accountExportResponseSchema>;
export type AccountDeleteResponseSchema = z.infer<typeof accountDeleteResponseSchema>;
export type GitHubAuthSchema = z.infer<typeof githubAuthSchema>;
export type ForgotPasswordSchema = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordSchema = z.infer<typeof resetPasswordSchema>;
export type SetPasswordSchema = z.infer<typeof setPasswordSchema>;
export type AuthProviderSchema = z.infer<typeof authProviderSchema>;
export type ProviderInfoSchema = z.infer<typeof providerInfoSchema>;
export type LinkedProvidersResponseSchema = z.infer<typeof linkedProvidersResponseSchema>;
export type MessageResponseSchema = z.infer<typeof messageResponseSchema>;
export type ResultPresignStoreRequestSchema = z.infer<typeof resultPresignStoreRequestSchema>;
export type ResultPresignStoreResponseSchema = z.infer<typeof resultPresignStoreResponseSchema>;
export type ResultDownloadUrlRequestSchema = z.infer<typeof resultDownloadUrlRequestSchema>;
export type ResultDownloadUrlResponseSchema = z.infer<typeof resultDownloadUrlResponseSchema>;
export type McpFetchResultFileInputSchema = z.infer<typeof mcpFetchResultFileInputSchema>;
