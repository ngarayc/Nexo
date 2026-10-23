import { test as base } from '@playwright/test';
export { expect } from '@playwright/test';

const tile =
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e4eee9"/><path d="M0 128H256M128 0V256" stroke="#8ca59c"/></svg>';

async function network(context) {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return route.continue();
    if (
      url.origin === 'https://tile.openstreetmap.org' &&
      /^\/\d+\/\d+\/\d+\.png$/u.test(url.pathname) &&
      !url.search &&
      !url.username &&
      !url.password
    )
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: tile });
    return route.abort('blockedbyclient');
  });
  return context;
}

// También cubre los contextos explícitos de los casos con dos clientes. No
// sustituye API, sesión, SSE, proxy o CSP; solo evita tráfico externo de la suite.
export const test = base.extend({
  browser: [
    async ({ browser }, use) => {
      const wrapped = new Proxy(browser, {
        get(target, property) {
          if (property === 'newContext')
            return async (...args) => network(await target.newContext(...args));
          if (property === 'newPage')
            return async (...args) => {
              const page = await target.newPage(...args);
              await network(page.context());
              return page;
            };
          const value = Reflect.get(target, property);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      await use(wrapped);
    },
    { scope: 'worker' },
  ],
});
