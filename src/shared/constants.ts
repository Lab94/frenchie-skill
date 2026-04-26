export const PROJECT_NAME = "Frenchie";
export const PROJECT_TAGLINE = "Your agent's best friend";

export const BILLING_MODES = ["dev_topup", "stripe", "disabled"] as const;
export const CREDIT_PACK_IDS = ["starter_500", "growth_2000", "scale_10000"] as const;
export const MIN_STRIPE_TOP_UP_AMOUNT_USD_CENTS = 500;
export const WELCOME_BONUS_CREDITS = 100;

export const SUPPORTED_OCR_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp"
] as const;

export const SUPPORTED_TRANSCRIPTION_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mp4",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "audio/webm"
] as const;

export const SUPPORTED_MIME_TYPES = [
  ...SUPPORTED_OCR_MIME_TYPES,
  ...SUPPORTED_TRANSCRIPTION_MIME_TYPES
] as const;

export const CREDIT_RATES = {
  OCR_PER_PAGE: 1,
  TRANSCRIPTION_PER_MINUTE: 2,
  IMAGE_GENERATION_PER_IMAGE: 20
} as const;

export const IMAGE_GENERATION_FORMATS = ["png", "jpeg", "webp"] as const;
export const IMAGE_GENERATION_SIZES = [
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "auto"
] as const;
export const IMAGE_GENERATION_QUALITIES = ["low", "medium", "high", "auto"] as const;
export const IMAGE_GENERATION_BACKGROUNDS = ["transparent", "opaque", "auto"] as const;

export const IMAGE_GENERATION_PROMPT_MAX_LENGTH = 3500;
export const IMAGE_GENERATION_STYLE_MAX_LENGTH = 500;
export const IMAGE_GENERATION_COMBINED_MAX_LENGTH = 4000;

export const CREDIT_PACKS = [
  {
    id: "starter_500",
    name: "Starter 500",
    credits: 500,
    amountUsdCents: 500,
    description: "Entry pack for individual OCR and transcription work."
  },
  {
    id: "growth_2000",
    name: "Growth 2K",
    credits: 2000,
    amountUsdCents: 2000,
    description: "Balanced pack for ongoing agent and automation usage."
  },
  {
    id: "scale_10000",
    name: "Scale 10K",
    credits: 10000,
    amountUsdCents: 10000,
    description: "High-throughput pack for team and heavier async workloads."
  }
] as const;

export const FILE_SIZE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
export const RESULT_RETENTION_MINUTES = 30;
export const DEFAULT_JOB_LIST_LIMIT = 10;
export const MAX_JOB_LIST_LIMIT = 20;
export const DASHBOARD_RECENT_JOBS_LIMIT = 5;
export const DEFAULT_LEDGER_LIST_LIMIT = 10;
export const MAX_LEDGER_LIST_LIMIT = 20;

export const RESULT_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
] as const;

export const RATE_LIMIT_DEFAULTS = {
  REQUESTS_PER_MINUTE: 60,
  CONCURRENT_JOBS: 5,
  OCR_PAGES_PER_HOUR: 500,
  TRANSCRIPTION_MINUTES_PER_HOUR: 120,
  IMAGE_GENERATION_PER_HOUR: 50,
  IMAGE_GENERATION_PER_DAY: 250,
  CREDITS_PER_DAY: 5000,
  GLOBAL_CONCURRENT_WORKERS: 10,
  GLOBAL_MAX_QUEUE_DEPTH: 100,
  LOGIN_ATTEMPTS_PER_EMAIL: 10,
  PASSWORD_RESET_ATTEMPTS_PER_EMAIL: 5
} as const;
