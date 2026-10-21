import { expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { WriteTransactions } from './write-transactions.js';

function connection() {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const release = vi.fn();
  const connect = vi.fn().mockResolvedValue({ query, release });
  return { pool: { connect } as unknown as Pool, query, release, connect };
}

it('confirma antes de devolver el resultado y solo entonces reutiliza el cliente', async () => {
  const c = connection();
  const result = await new WriteTransactions(c.pool).run(async (tx) => {
    await tx.execute(sql`SELECT 1`);
    expect(c.release).not.toHaveBeenCalled();
    return 'confirmed';
  });
  expect(result).toBe('confirmed');
  expect(c.query.mock.calls[0]?.[0]).toBe('BEGIN ISOLATION LEVEL READ COMMITTED');
  expect(c.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  expect(c.release).toHaveBeenCalledExactlyOnceWith(false);
});

it('un COMMIT incierto descarta el socket y propaga incertidumbre sin reejecutar', async () => {
  const c = connection();
  const uncertain = new Error('REPLY_LOST');
  c.query.mockImplementation(async (text) => {
    if (text === 'COMMIT') throw uncertain;
    return { rows: [] };
  });
  const operation = vi.fn().mockResolvedValue('value');
  await expect(new WriteTransactions(c.pool).run(operation)).rejects.toBe(uncertain);
  expect(operation).toHaveBeenCalledOnce();
  expect(c.connect).toHaveBeenCalledOnce();
  expect(c.release).toHaveBeenCalledExactlyOnceWith(true);
});

it('un fallo antes del commit tampoco devuelve una transacción abierta al pool', async () => {
  const c = connection();
  const fault = new Error('WORK_FAILED');
  await expect(
    new WriteTransactions(c.pool).run(async () => {
      throw fault;
    }),
  ).rejects.toBe(fault);
  expect(c.query.mock.calls.some(([text]) => text === 'COMMIT')).toBe(false);
  expect(c.release).toHaveBeenCalledExactlyOnceWith(true);
});
