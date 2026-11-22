import { GoogleGenAI } from '@google/genai';

export const GEMINI_MODEL = 'gemini-4-hydrogen';
export const GEMINI_FALLBACK_MODEL = 'gemini-3.1-flash-lite';

let cachedClient: GoogleGenAI | null = null;
let cachedKey: string | undefined;

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Add your Gemini API key in the environment secrets panel to run document verification.'
    );
  }
  if (!cachedClient || cachedKey !== apiKey) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    cachedKey = apiKey;
  }
  return cachedClient;
}

export function isQuotaOrRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('429') ||
    message.includes('RESOURCE_EXHAUSTED') ||
    message.toLowerCase().includes('quota')
  );
}

/**
 * Extracts server-suggested retry delay in milliseconds from a Gemini 429 error message
 * (e.g. "Please retry in 14.3s" or '"retryDelay": "14s"'), if present.
 */
function parseSuggestedRetryDelayMs(message: string): number | null {
  const secMatch =
    message.match(/retry in\s+(\d+(?:\.\d+)?)s/i) ??
    message.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i);
  if (!secMatch) return null;
  const secs = Number(secMatch[1]);
  if (!Number.isFinite(secs) || secs <= 0) return null;
  return Math.min(Math.ceil(secs * 1000) + 500, 18_000);
}

/**
 * True only when the error explicitly indicates daily/account-level exhaustion (limit: 0 or PerDay)
 * rather than a recoverable per-minute (RPM) rate limit.
 */
export function isHardDailyQuotaError(message: string): boolean {
  return (
    /limit:\s*0\b/i.test(message) ||
    /GenerateRequestsPerDay/i.test(message) ||
    /PerDay/i.test(message)
  );
}

// Light global spacing prevents bursty multi-claim pipelines from slamming per-minute RPM limits
let nextAllowedCallAt = 0;
export async function paceGeminiCall(minGapMs = 280): Promise<void> {
  const now = Date.now();
  const waitMs = Math.max(0, nextAllowedCallAt - now);
  nextAllowedCallAt = Math.max(now, nextAllowedCallAt) + minGapMs;
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s.`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: { maxAttempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1200;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await paceGeminiCall();
      return await operation();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const hardDaily = isHardDailyQuotaError(message);
      const isRetryable =
        !hardDaily &&
        (message.includes('429') ||
          message.includes('RESOURCE_EXHAUSTED') ||
          message.includes('503') ||
          message.includes('500') ||
          message.includes('UNAVAILABLE') ||
          message.includes('DEADLINE_EXCEEDED') ||
          message.includes('fetch failed') ||
          message.includes('ECONNRESET'));

      if (!isRetryable || attempt === maxAttempts) {
        throw error;
      }

      const hintedDelay = parseSuggestedRetryDelayMs(message);
      const expDelay = baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 350);
      const delay = hintedDelay ? Math.max(hintedDelay, expDelay) : expDelay;
      console.warn(
        `[geminiClient] Transient error on attempt ${attempt}/${maxAttempts}; retrying in ${delay}ms:`,
        message.slice(0, 160)
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

export function formatGeminiError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes('API_KEY_INVALID') || raw.includes('PERMISSION_DENIED') || raw.includes('403')) {
    return 'Gemini API authentication failed. Please verify your GEMINI_API_KEY in Settings > Secrets.';
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return 'Gemini API rate limit reached. Please wait a few moments and retry your analysis.';
  }
  if (raw.includes('NOT_FOUND') || raw.includes('404')) {
    return 'The requested Gemini model endpoint was not found. Please check model availability and try again.';
  }
  if (raw.includes('GEMINI_API_KEY is not configured')) {
    return raw;
  }
  return raw.length > 260 ? `${raw.slice(0, 260)}…` : raw;
}
