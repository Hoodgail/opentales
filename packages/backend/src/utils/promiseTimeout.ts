import { HttpError } from '../http/HttpError.js';

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new HttpError(503, message)), ms);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
