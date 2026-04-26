import {
  SUPPORTED_OCR_MIME_TYPES,
  SUPPORTED_TRANSCRIPTION_MIME_TYPES
} from "../shared/index.js";
import { fileTypeFromBuffer } from "file-type";
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

const EXTENSION_TO_MIME_TYPE: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/m4a",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm"
};

export async function prepareOcrLocalFile(filePath: string) {
  return prepareLocalFile(filePath, SUPPORTED_OCR_MIME_TYPES);
}

export async function prepareTranscriptionLocalFile(filePath: string) {
  return prepareLocalFile(filePath, SUPPORTED_TRANSCRIPTION_MIME_TYPES);
}

/**
 * Validates and sanitises a caller-supplied file path before reading it.
 * Guards against:
 *  - Null-byte injection  (e.g. "/etc/passwd\0.pdf")
 *  - Non-string inputs
 * The resolved absolute path is used for the actual read so that relative
 * ".." segments are normalised by the OS before any access is attempted.
 */
function sanitisedResolvedPath(filePath: string): string {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new Error("File path must be a non-empty string");
  }

  // Null bytes are never valid in file paths and are used in injection attacks.
  if (filePath.includes("\0")) {
    throw new Error("Invalid file path: null bytes are not permitted");
  }

  // resolve() normalises ".." segments and produces an absolute path, which
  // is then handed directly to the OS — no further string manipulation needed.
  return resolve(filePath);
}

async function prepareLocalFile(filePath: string, allowedMimeTypes: readonly string[]) {
  const safePath = sanitisedResolvedPath(filePath);
  const buffer = await readFile(safePath);
  const detectedMimeType = (await fileTypeFromBuffer(buffer))?.mime;
  const fallbackMimeType = EXTENSION_TO_MIME_TYPE[extname(safePath).toLowerCase()];
  const mimeType = chooseSupportedMimeType(detectedMimeType, fallbackMimeType, allowedMimeTypes);

  if (!mimeType) {
    throw new Error(`Unsupported file type for ${basename(safePath)}`);
  }

  return {
    buffer,
    filename: basename(safePath),
    mimeType
  };
}

function chooseSupportedMimeType(
  detectedMimeType: string | undefined,
  fallbackMimeType: string | undefined,
  allowedMimeTypes: readonly string[]
): string | undefined {
  if (detectedMimeType && allowedMimeTypes.includes(detectedMimeType)) {
    return detectedMimeType;
  }

  if (fallbackMimeType && allowedMimeTypes.includes(fallbackMimeType)) {
    return fallbackMimeType;
  }

  return undefined;
}
