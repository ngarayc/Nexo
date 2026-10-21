import { afterEach, describe, expect, it } from 'vitest';
import session from 'express-session';
import type { SessionData } from 'express-session';
import { BoundedSessionStore } from './session-store.js';

describe('almacén acotado con revocación y tiempo absoluto', () => {
  let now = 1000;
  const stores: BoundedSessionStore[] = [];
  const create = (maximum = 2) => {
    const store = new BoundedSessionStore(maximum, () => now);
    stores.push(store);
    return store;
  };
  const data = (expiresAt = 2000): SessionData => {
    const cookie = new session.Cookie();
    cookie.expires = new Date(expiresAt);
    return {
      cookie,
      identity: { user: { id: 'id', username: 'demo' }, issuedAt: 1000, expiresAt },
      csrfToken: 'token',
    };
  };
  const save = (store: BoundedSessionStore, sid: string, value = data()) =>
    new Promise<void>((resolve, reject) =>
      store.set(sid, value, (error) => (error ? reject(error) : resolve())),
    );
  const get = (store: BoundedSessionStore, sid: string) =>
    new Promise<SessionData | null | undefined>((resolve, reject) =>
      store.get(sid, (error, value) => (error ? reject(error) : resolve(value))),
    );
  afterEach(() => {
    for (const store of stores) store.close();
    stores.length = 0;
    now = 1000;
  });

  it('reserva sin expulsar sesiones y libera el cupo al destruir', async () => {
    const store = create();
    expect(store.reserve('one', 2000)).toBe(true);
    expect(store.reserve('two', 2000)).toBe(true);
    await Promise.all([save(store, 'one'), save(store, 'two')]);
    expect(store.reserve('three', 2000)).toBe(false);
    expect(Boolean(await get(store, 'one')) && Boolean(await get(store, 'two'))).toBe(true);
    store.destroy('one');
    expect(store.reserve('three', 2000)).toBe(true);
  });
  it('set y touch concurrentes posteriores al logout no recrean el SID', async () => {
    const store = create();
    store.reserve('one', 2000);
    await save(store, 'one');
    const stale = await get(store, 'one');
    expect(Boolean(stale)).toBe(true);
    const revoked = new Promise((resolve) => store.once('revoked', resolve));
    store.destroy('one');
    await revoked;
    await expect(save(store, 'one', stale!)).rejects.toThrow();
    store.touch('one', stale!);
    expect(await get(store, 'one')).toBeNull();
  });
  it('vence en el límite exacto, pese a touch y escrituras, y recupera capacidad', async () => {
    const store = create(1);
    store.reserve('one', 2000);
    await save(store, 'one');
    now = 1999;
    store.touch('one', data());
    await save(store, 'one');
    expect(Boolean(await get(store, 'one'))).toBe(true);
    now = 2000;
    expect(await get(store, 'one')).toBeNull();
    expect(store.reserve('two', 3000)).toBe(true);
    expect(store.reserve('expired', 2000)).toBe(false);
    await expect(save(store, 'one')).rejects.toThrow();
  });
  it('una lectura pendiente no devuelve estado revocado entre get y callback', async () => {
    const store = create();
    store.reserve('one', 2000);
    await save(store, 'one');
    const pending = get(store, 'one');
    store.destroy('one');
    expect(await pending).toBeNull();
  });
});
