const RETRYABLE_STATUS = new Set([502, 503, 504, 429]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export class BackendWakingError extends Error {
  constructor(message = 'Backend is starting up. Retrying…') {
    super(message);
    this.name = 'BackendWakingError';
  }
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { retries?: number; baseDelayMs?: number },
): Promise<Response> {
  const retries = options?.retries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 800;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(input, init);
      if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
        await sleep(baseDelayMs * (attempt + 1));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt >= retries) break;
      await sleep(baseDelayMs * (attempt + 1));
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new BackendWakingError();
}
