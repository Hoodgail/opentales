export interface TransactionRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export async function retryTransactionConflict<T>(
  operation: () => Promise<T>,
  options: TransactionRetryOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 5);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 10);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 250);

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts - 1 || !isTransactionConflict(error)) throw error;
      const delayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
        + (baseDelayMs > 0 ? Math.floor(Math.random() * baseDelayMs) : 0);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export function isTransactionConflict(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const value = error as { code?: unknown; meta?: { code?: unknown; message?: unknown }; message?: unknown };
    if (value.code === 'P2034') return true;
    if (value.code === 'P2010' && (value.meta?.code === '40001' || value.meta?.code === '40P01')) return true;
    if (/\b40001\b|\b40P01\b|could not serialize access|serialization failure|write conflict|deadlock/i.test(
      `${value.message ?? ''} ${value.meta?.message ?? ''}`
    )) return true;
  }
  return false;
}
