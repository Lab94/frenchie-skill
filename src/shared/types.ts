export type JobType = "ocr" | "transcription" | "image_generation" | "extraction";
export type ExtractionFormat = "docx" | "xlsx" | "csv" | "tsv" | "pptx";
export type JobStatus = "queued" | "processing" | "done" | "failed";
export type ProcessingMode = "sync" | "async";
export type CreditLedgerEntryType = "topup" | "debit" | "refund" | "adjustment";
export type BillingMode = "dev_topup" | "stripe" | "disabled";
export type CreditPackId = "starter_500" | "growth_2000" | "scale_10000";

export interface CreditPack {
  id: CreditPackId;
  name: string;
  credits: number;
  amountUsdCents: number;
  description: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface GoogleAuthInput {
  idToken: string;
}

export interface GitHubAuthInput {
  accessToken: string;
}

export interface ForgotPasswordInput {
  email: string;
}

export interface ResetPasswordInput {
  token: string;
  password: string;
}

export type AuthProviderType = "CREDENTIALS" | "GOOGLE" | "GITHUB";

export interface ProviderInfo {
  provider: AuthProviderType;
  linkedAt: string;
}

export interface LinkedProvidersResponse {
  providers: ProviderInfo[];
}

export interface SetPasswordInput {
  password: string;
}

export interface MessageResponse {
  message: string;
}

export interface VerifyEmailInput {
  token: string;
}

export interface ResendVerificationInput {
  email: string;
}

export interface AuthSessionUser {
  id: string;
  email: string;
  name?: string;
  emailVerified: boolean;
}

export interface AuthUserResponse {
  id: string;
  email: string;
  name?: string;
  emailVerified: boolean;
}

export interface AuthResponse {
  user: AuthUserResponse;
  bootstrapApiKey?: string;
}

export interface ApiKeyListItem {
  id: string;
  keyPrefix: string;
  name?: string;
  status: "ACTIVE" | "REVOKED";
  lastUsedAt?: string;
  createdAt: string;
}

export interface ApiKeyCreateInput {
  name?: string;
}

export interface ApiKeyCreateResponse extends ApiKeyListItem {
  apiKey: string;
}

export interface TopUpInput {
  amount: number;
  description?: string;
}

export interface CheckoutSessionCreateInput {
  amountUsdCents: number;
}

export interface CheckoutSessionCreateResponse {
  checkoutUrl: string;
}

export interface JobCreateInput {
  objectKey: string;
}

export type ImageGenerationFormat = "png" | "jpeg" | "webp";
export type ImageGenerationSize =
  | "1024x1024"
  | "1536x1024"
  | "1024x1536"
  | "auto";
export type ImageGenerationQuality = "low" | "medium" | "high" | "auto";
export type ImageGenerationBackground = "transparent" | "opaque" | "auto";

export interface ImageGenerationJobCreateInput {
  prompt: string;
  style?: string;
  size?: ImageGenerationSize;
  quality?: ImageGenerationQuality;
  format?: ImageGenerationFormat;
  background?: ImageGenerationBackground;
}

/**
 * Shared `result` payload for every Frenchie capability.
 *
 * Spec section 6.1: `result` is the single public result container.
 * Top-level convenience fields (markdown, savedTo, imageUrl, objectKey)
 * are not added to the envelope — read them off `result` instead.
 */
export interface MarkdownResult {
  kind: "markdown";
  /** HTTP mode: full markdown inline. Stdio mode: omitted (use savedTo). */
  markdown?: string;
  /** Stdio mode: relative path to the persisted result.md. */
  savedTo?: string;
  pages?: number;
  wordCount?: number;
  imageCount?: number;
}

export interface ImageResult {
  kind: "image";
  format: ImageGenerationFormat;
  mimeType: string;
  size?: ImageGenerationSize;
  background?: ImageGenerationBackground;
  style?: string;
  /** HTTP mode: presigned URL to the stored image (~30 min expiry). */
  imageUrl?: string;
  /** Stdio mode: relative path to the persisted image. */
  savedTo?: string;
}

export type CapabilityResult = MarkdownResult | ImageResult;

/**
 * Spec section 6.1 — every create / get_job_result / smart-wait response
 * uses this envelope. `status` is the job state; `result` is the typed
 * payload, present only when status is "done".
 */
export interface CapabilitySyncResponse {
  jobId: string;
  status: "done";
  creditsUsed: number;
  resultExpiresAt: string;
  result: CapabilityResult;
}

export interface AsyncJobQueuedResponse {
  jobId: string;
  status: "queued";
  estimatedSeconds?: number;
}

export type OcrJobCreateResponse = CapabilitySyncResponse | AsyncJobQueuedResponse;
export type TranscriptionJobCreateResponse =
  | CapabilitySyncResponse
  | AsyncJobQueuedResponse;
export type ImageGenerationJobCreateResponse =
  | CapabilitySyncResponse
  | AsyncJobQueuedResponse;
export type ExtractionJobCreateResponse = CapabilitySyncResponse | AsyncJobQueuedResponse;

/**
 * Dashboard-only metadata about an image generation job — the
 * user-facing result payload lives on the `result` envelope (see
 * {@link CapabilityResult}). This structure captures the requested
 * + effective provider options so the dashboard can show the full
 * generation details panel without a second round-trip.
 */
export interface ImageJobDetailResponse {
  /**
   * The original prompt. Cleared at the retention-window boundary
   * alongside the generated image so image jobs follow the same privacy
   * rules as OCR / transcription content.
   */
  prompt?: string;
  style?: string;
  requestedSize?: string;
  requestedQuality?: string;
  requestedFormat?: string;
  requestedBackground?: string;
  effectiveSize?: string;
  effectiveQuality?: string;
  effectiveFormat?: string;
  effectiveBackground?: string;
}

export interface JobResponse {
  id: string;
  type: JobType;
  status: JobStatus;
  syncOrAsync: ProcessingMode;
  inputFilename: string;
  creditsUsed?: number;
  pageCount?: number;
  durationMinutes?: number;
  sheetCount?: number;
  rowCount?: number;
  slideCount?: number;
  extractionFormat?: ExtractionFormat;
  resultExpiresAt?: string;
  resultAvailable: boolean;
  createdAt: string;
  completedAt?: string;
  errorMessage?: string;
  estimatedSeconds?: number;
  imageDetail?: ImageJobDetailResponse;
}

export interface JobListQuery {
  page: number;
  limit: number;
  type?: JobType;
  status?: JobStatus;
}

export interface JobListResponse {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  jobs: JobResponse[];
}

export interface JobResultResponse {
  id: string;
  status: JobStatus;
  /**
   * Job capability. Required so MCP clients can branch safely on kind
   * (e.g. image_generation → render presigned URL; ocr/transcription →
   * load markdown). Previously optional; promoted to required in the
   * image-generation cutover.
   */
  type: JobType;
  /**
   * Typed result payload. Present when status === "done" and the
   * retention window has not expired. Discriminated by `result.kind`
   * ({@link MarkdownResult} for OCR / transcription, {@link ImageResult}
   * for image generation).
   */
  result?: CapabilityResult;
  creditsUsed?: number;
  imageDetail?: ImageJobDetailResponse;
  resultExpiresAt?: string;
  resultAvailable: boolean;
  estimatedSeconds?: number;
  inputFilename?: string;
}

export interface UploadPresignRequest {
  filename: string;
  fileSize: number;
  mimeType: string;
}

export interface UploadPresignResponse {
  uploadUrl: string;
  objectKey: string;
  expiresIn: number;
}

export interface CreditBalanceResponse {
  credits: number;
}

export interface CreditLedgerListQuery {
  page: number;
  limit: number;
}

export interface CreditLedgerEntryResponse {
  id: string;
  type: CreditLedgerEntryType;
  amount: number;
  balanceAfter: number;
  referenceJobId?: string;
  description?: string;
  stripeReceiptUrl?: string;
  createdAt: string;
}

export interface CreditLedgerListResponse {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  billingMode: BillingMode;
  availableTopUpPacks: CreditPack[];
  canUseDevTopup: boolean;
  entries: CreditLedgerEntryResponse[];
}

export interface DashboardSummaryResponse {
  balanceCredits: number;
  totalJobs: number;
  totalCreditsUsed: number;
  recentJobs: JobResponse[];
}

export interface ApiErrorResponse {
  statusCode: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface McpAsyncResult {
  status: "processing";
  jobId: string;
  estimatedCompletion?: string;
}

export interface McpDoneResult {
  status: "done";
  jobId?: string;
  creditsUsed?: number;
  resultExpiresAt?: string;
  /** Typed payload — markdown or image, discriminated by `result.kind`. */
  result?: CapabilityResult;
}

export type McpToolResult = McpAsyncResult | McpDoneResult;

export interface McpToolFilePathInput {
  file_path: string;
  api_key?: string;
}

export interface McpToolUploadedFileReferenceInput {
  uploaded_file_reference: string;
  api_key?: string;
}

export type OcrToMarkdownToolInput =
  | McpToolFilePathInput
  | McpToolUploadedFileReferenceInput;

export type TranscribeToMarkdownToolInput =
  | (McpToolFilePathInput & { language?: string })
  | (McpToolUploadedFileReferenceInput & { language?: string });

export type ExtractToMarkdownToolInput =
  | McpToolFilePathInput
  | McpToolUploadedFileReferenceInput;

export interface GetJobResultToolInput {
  job_id: string;
  api_key?: string;
}

export interface ResultPresignStoreRequest {
  jobId: string;
  filename: string;
  contentType: string;
}

export interface ResultPresignStoreResponse {
  uploadUrl: string;
  objectKey: string;
  expiresIn: number;
}

export interface ResultDownloadUrlRequest {
  objectKey: string;
}

export interface ResultDownloadUrlResponse {
  downloadUrl: string;
  filename: string;
  expiresIn: number;
}

export interface FetchResultFileToolInput {
  object_key: string;
  api_key?: string;
}

export type DataSubjectRequestType = "deletion" | "export";
export type DataSubjectRequestStatus = "pending" | "completed" | "failed";

export interface AccountExportResponse {
  user: {
    id: string;
    email: string;
    name?: string;
    createdAt: string;
  };
  jobs: {
    id: string;
    type: JobType;
    status: JobStatus;
    inputFilename: string;
    creditsUsed?: number;
    createdAt: string;
    completedAt?: string;
  }[];
  creditLedger: {
    id: string;
    type: CreditLedgerEntryType;
    amount: number;
    balanceAfter: number;
    description?: string;
    createdAt: string;
  }[];
  dataSubjectRequests: {
    id: string;
    type: DataSubjectRequestType;
    status: DataSubjectRequestStatus;
    createdAt: string;
    completedAt?: string;
  }[];
}

export interface AccountDeleteResponse {
  message: string;
}
