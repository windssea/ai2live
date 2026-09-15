export interface RetryPolicy {
  max_attempts: number;
  backoff_ms: number;
  retryable_codes: string[];
}

export const DEFAULT_RETRY: RetryPolicy = {
  max_attempts: 3,
  backoff_ms: 500,
  retryable_codes: ["TIMEOUT", "RATE_LIMIT", "TRANSIENT"],
};

export async function withRetry<T>(
  policy: RetryPolicy,
  fn: (attempt: number) => Promise<T>,
  classify: (err: unknown) => string = () => "UNKNOWN"
): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= policy.max_attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      last = err;
      const code = classify(err);
      if (!policy.retryable_codes.includes(code) || attempt === policy.max_attempts) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, policy.backoff_ms * attempt));
    }
  }
  throw last;
}
