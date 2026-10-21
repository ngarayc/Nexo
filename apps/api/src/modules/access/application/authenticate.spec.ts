import { describe, expect, it, vi } from 'vitest';
import { Authenticate, HashCapacityError } from './authenticate.js';

describe('autenticación y admisión al trabajo de hashing', () => {
  const account = { id: 'id', username: 'demo' as const, passwordHash: 'hash' };
  it('un usuario desconocido pasa por el verificador de coste equivalente', async () => {
    const verify = vi.fn(async () => true);
    const useCase = new Authenticate({ findDemo: async () => account }, { verify }, true);
    expect(await useCase.execute({ username: 'Demo', password: 'demo' })).toBeUndefined();
    expect(verify).toHaveBeenCalledWith(undefined, 'demo');
    expect(await useCase.execute({ username: 'demo', password: 'demo' })).toEqual({
      id: 'id',
      username: 'demo',
    });
    expect(verify).toHaveBeenLastCalledWith('hash', 'demo');
  });
  it('rechaza una tercera operación simultánea sin crear cola y recupera cupo al fallar', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const useCase = new Authenticate(
      { findDemo: async () => account },
      {
        verify: async () => {
          await pending;
          throw new Error('técnico');
        },
      },
      true,
    );
    const credentials = { username: 'demo', password: 'demo' };
    const first = useCase.execute(credentials).catch(() => undefined);
    const second = useCase.execute(credentials).catch(() => undefined);
    await expect(useCase.execute(credentials)).rejects.toBeInstanceOf(HashCapacityError);
    release();
    await Promise.all([first, second]);
    await expect(useCase.execute(credentials)).rejects.toThrow('técnico');
  });
  it('no concede acceso ante error técnico ni con demo deshabilitada', async () => {
    const findDemo = vi.fn(async () => {
      throw new Error('base');
    });
    const verify = vi.fn(async () => true);
    await expect(
      new Authenticate({ findDemo }, { verify }, true).execute({
        username: 'demo',
        password: 'demo',
      }),
    ).rejects.toThrow('base');
    expect(verify).not.toHaveBeenCalled();
    findDemo.mockClear();
    expect(
      await new Authenticate({ findDemo }, { verify }, false).execute({
        username: 'demo',
        password: 'demo',
      }),
    ).toBeUndefined();
    expect(findDemo).not.toHaveBeenCalled();
  });
});
