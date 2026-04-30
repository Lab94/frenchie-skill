export const EXTRACTION_ERRORS = {
  UNSUPPORTED_MIME: {
    code: "EXTRACT_001",
    http: 400,
    message: "Unsupported file type."
  },
  FILE_TOO_LARGE: {
    code: "EXTRACT_002",
    http: 413,
    message: "File exceeds size limit."
  },
  EMPTY_FILE: {
    code: "EXTRACT_003",
    http: 400,
    message: "File is empty (0 bytes)."
  },
  CORRUPT_FILE: {
    code: "EXTRACT_004",
    http: 422,
    message:
      "File couldn't be parsed — it may be corrupt. Try re-saving from the source app."
  },
  ENCRYPTED_FILE: {
    code: "EXTRACT_005",
    http: 422,
    message: "File appears encrypted. Remove encryption before uploading."
  },
  PASSWORD_PROTECTED: {
    code: "EXTRACT_006",
    http: 422,
    message: "Workbook is password-protected. Remove the password to extract."
  },
  LEGACY_BINARY_FORMAT: {
    code: "EXTRACT_007",
    http: 415,
    message:
      "Legacy binary format isn't supported. Open the file in Word/Excel/PowerPoint and save as the modern .docx/.xlsx/.pptx format."
  },
  EXTRACTION_FAILED: {
    code: "EXTRACT_008",
    http: 500,
    message: "Extraction failed. Please retry or report this if it persists."
  },
  PROVIDER_ERROR: {
    code: "EXTRACT_009",
    http: 502,
    message: "The slide-extraction provider returned an error. Retry in a moment."
  },
  INSUFFICIENT_CREDITS: {
    code: "EXTRACT_010",
    http: 402,
    message: "Insufficient credits to start this job."
  }
} as const;

export type ExtractionErrorKey = keyof typeof EXTRACTION_ERRORS;

export interface ExtractionErrorPayload {
  code: string;
  http: number;
  message: string;
  detail?: Record<string, unknown>;
}

export function buildExtractionErrorPayload(
  key: ExtractionErrorKey,
  detail?: Record<string, unknown>
): ExtractionErrorPayload {
  const entry = EXTRACTION_ERRORS[key];
  return {
    code: entry.code,
    http: entry.http,
    message: entry.message,
    detail
  };
}
