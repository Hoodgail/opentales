import { describe, expect, it, vi } from 'vitest';
import { isTransactionConflict, retryTransactionConflict } from './prismaTransaction.js';

describe('retryTransactionConflict', () => {
  it('retries a rolled-back Prisma write conflict', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('write conflict'), { code: 'P2034' }))
      .mockResolvedValue('committed');

    await expect(retryTransactionConflict(operation, { baseDelayMs: 0 })).resolves.toBe('committed');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry application errors', async () => {
    const error = new Error('invalid input');
    const operation = vi.fn().mockRejectedValue(error);

    await expect(retryTransactionConflict(operation, { baseDelayMs: 0 })).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('recognizes PostgreSQL serialization and deadlock codes wrapped by Prisma', () => {
    expect(isTransactionConflict({ code: 'P2010', meta: { code: '40001' } })).toBe(true);
    expect(isTransactionConflict({ code: 'P2010', meta: { code: '40P01' } })).toBe(true);
  });
});
