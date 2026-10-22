import { expect, it } from 'vitest';
import { RecentMessages } from './recent-messages';

it('la caché de UUID conserva las últimas 5.000 identidades y actualiza la recencia', () => {
  const recent = new RecentMessages();
  for (let i = 0; i < 5000; i++) expect(recent.remember(String(i))).toBe(false);
  expect(recent.remember('0')).toBe(true);
  expect(recent.remember('5000')).toBe(false);
  expect(recent.size).toBe(5000);
  expect(recent.remember('0')).toBe(true);
  expect(recent.remember('1')).toBe(false);
  recent.clear();
  expect(recent.size).toBe(0);
  expect(recent.remember('0')).toBe(false);
});
