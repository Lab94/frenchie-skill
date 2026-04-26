/**
 * Estimate processing time for async jobs.
 * Used by the API to return `estimatedSeconds` so MCP/AI clients
 * can set intelligent polling intervals instead of blind retries.
 */

const TRANSCRIPTION_REALTIME_FACTOR = 0.3;
const TRANSCRIPTION_SPEAKER_MULTIPLIER = 1.2;
const OCR_SECONDS_PER_PAGE = 3;
const MIN_SECONDS = 10;
const MAX_SECONDS = 3600;

interface EstimateInput {
  type: "ocr" | "transcription";
  durationMinutes?: number;
  pageCount?: number;
  hasSpeakers?: boolean;
}

export function estimateProcessingSeconds(input: EstimateInput): number {
  let estimate: number;

  if (input.type === "transcription") {
    const minutes = input.durationMinutes ?? 1;
    estimate = Math.ceil(minutes * TRANSCRIPTION_REALTIME_FACTOR * 60);
    if (input.hasSpeakers) {
      estimate = Math.ceil(estimate * TRANSCRIPTION_SPEAKER_MULTIPLIER);
    }
  } else {
    estimate = (input.pageCount ?? 1) * OCR_SECONDS_PER_PAGE;
  }

  return Math.max(MIN_SECONDS, Math.min(MAX_SECONDS, estimate));
}
