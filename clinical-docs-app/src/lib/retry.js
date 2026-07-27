/** Retry an async operation with exponential backoff. */
export async function withRetry(fn, { retries = 2, baseDelayMs = 1500, onRetry } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      if (attempt === retries) break;
      onRetry?.(e, attempt + 1);
      await new Promise(r => setTimeout(r, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastErr;
}
