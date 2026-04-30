import {
  imageGenerationJobCreateResponseSchema,
  extractionJobCreateResponseSchema,
  jobResponseSchema,
  jobResultResponseSchema,
  ocrJobCreateResponseSchema,
  resultDownloadUrlResponseSchema,
  resultPresignStoreResponseSchema,
  transcriptionJobCreateResponseSchema,
  uploadPresignResponseSchema,
  type ImageGenerationBackground,
  type ImageGenerationFormat,
  type ImageGenerationJobCreateResponse,
  type ExtractionJobCreateResponse,
  type ImageGenerationQuality,
  type ImageGenerationSize,
  type JobResponse,
  type JobResultResponse,
  type OcrJobCreateResponse,
  type ResultDownloadUrlResponse,
  type ResultPresignStoreResponse,
  type TranscriptionJobCreateResponse,
  type UploadPresignResponse
} from "../shared/index.js";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly payload?: unknown
  ) {
    super(message);
  }
}

export interface ApiClientOptions {
  apiUrl: string;
  fetchFn?: typeof fetch;
}

export class ApiClient {
  private readonly apiUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/+$/, "");
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async uploadFile(
    apiKey: string,
    file: { buffer: Buffer; filename: string; mimeType: string }
  ): Promise<{ objectKey: string }> {
    // 1. Get presigned URL from worker
    const presign = await this.presignUpload(apiKey, {
      filename: file.filename,
      fileSize: file.buffer.length,
      mimeType: file.mimeType
    });

    // 2. Upload directly to storage via presigned URL
    const uploadResponse = await this.fetchFn(presign.uploadUrl, {
      method: "PUT",
      headers: { "content-type": file.mimeType },
      body: file.buffer
    });

    if (!uploadResponse.ok) {
      throw new ApiError(
        `Direct upload failed with status ${uploadResponse.status}`,
        uploadResponse.status
      );
    }

    return { objectKey: presign.objectKey };
  }

  async presignUpload(
    apiKey: string,
    input: { filename: string; fileSize: number; mimeType: string }
  ): Promise<UploadPresignResponse> {
    const payload = await this.requestJson("POST", "/uploads/presign", apiKey, input);
    return uploadPresignResponseSchema.parse(payload);
  }

  async createOcrJob(
    apiKey: string,
    input: {
      objectKey: string;
      mimeType?: string;
    }
  ): Promise<OcrJobCreateResponse> {
    const payload = await this.requestJson("POST", "/jobs/ocr", apiKey, input);
    return ocrJobCreateResponseSchema.parse(payload);
  }

  async createTranscriptionJob(
    apiKey: string,
    input: {
      objectKey: string;
      mimeType?: string;
      options?: { language?: string; speakers?: boolean; speakerNames?: Record<string, string> };
    }
  ): Promise<TranscriptionJobCreateResponse> {
    const payload = await this.requestJson("POST", "/jobs/transcribe", apiKey, input);
    return transcriptionJobCreateResponseSchema.parse(payload);
  }

  async createImageGenerationJob(
    apiKey: string,
    input: {
      prompt: string;
      style?: string;
      size?: ImageGenerationSize;
      quality?: ImageGenerationQuality;
      format?: ImageGenerationFormat;
      background?: ImageGenerationBackground;
    }
  ): Promise<ImageGenerationJobCreateResponse> {
    const payload = await this.requestJson("POST", "/jobs/image", apiKey, input);
    return imageGenerationJobCreateResponseSchema.parse(payload);
  }

  async createExtractionJob(
    apiKey: string,
    input: {
      objectKey: string;
      mimeType?: string;
    }
  ): Promise<ExtractionJobCreateResponse> {
    const payload = await this.requestJson("POST", "/jobs/extract", apiKey, input);
    return extractionJobCreateResponseSchema.parse(payload);
  }

  async getJob(apiKey: string, jobId: string): Promise<JobResponse> {
    const payload = await this.requestJson("GET", `/jobs/${jobId}`, apiKey);
    return jobResponseSchema.parse(payload);
  }

  async getJobResult(apiKey: string, jobId: string): Promise<JobResultResponse> {
    const payload = await this.requestJson("GET", `/jobs/${jobId}/result`, apiKey);
    return jobResultResponseSchema.parse(payload);
  }

  async storeResultFile(
    apiKey: string,
    file: { jobId: string; filename: string; contentType: string; data: string }
  ): Promise<{ objectKey: string }> {
    // 1. Get presigned URL from Worker
    const presign = await this.presignStoreResult(apiKey, {
      jobId: file.jobId,
      filename: file.filename,
      contentType: file.contentType
    });

    // 2. Upload binary directly to S3 via presigned URL
    const uploadResponse = await this.fetchFn(presign.uploadUrl, {
      method: "PUT",
      headers: { "content-type": file.contentType },
      body: Buffer.from(file.data, "base64")
    });

    if (!uploadResponse.ok) {
      throw new ApiError(
        `Result file upload failed with status ${uploadResponse.status}`,
        uploadResponse.status
      );
    }

    return { objectKey: presign.objectKey };
  }

  async presignStoreResult(
    apiKey: string,
    input: { jobId: string; filename: string; contentType: string }
  ): Promise<ResultPresignStoreResponse> {
    const payload = await this.requestJson("POST", "/results/presign-store", apiKey, input);
    return resultPresignStoreResponseSchema.parse(payload);
  }

  async getResultDownloadUrl(
    apiKey: string,
    objectKey: string
  ): Promise<ResultDownloadUrlResponse> {
    const payload = await this.requestJson("POST", "/results/download-url", apiKey, { objectKey });
    return resultDownloadUrlResponseSchema.parse(payload);
  }

  private async requestJson(
    method: "GET" | "POST",
    path: string,
    apiKey: string,
    body?: unknown
  ): Promise<unknown> {
    const response = await this.fetchFn(`${this.apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        ...(body ? { "content-type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const payload = await readJsonSafely(response);
    if (!response.ok) {
      throw new ApiError(extractErrorMessage(payload, response.status), response.status, payload);
    }

    return payload;
  }
}

async function readJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

function extractErrorMessage(payload: unknown, statusCode: number): string {
  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload.trim();
  }

  if (payload && typeof payload === "object") {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim();
    }

    if (message && typeof message === "object") {
      const nestedMessage = JSON.stringify(message);
      if (nestedMessage.length > 0) {
        return nestedMessage;
      }
    }
  }

  return `API request failed with status ${statusCode}`;
}
