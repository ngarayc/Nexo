export async function observeRealtime(page) {
  await page.addInitScript(() => {
    const Native = globalThis.EventSource;
    globalThis.__nexoObserved = { sources: [], messages: {}, frames: 0, invalid: false };
    globalThis.EventSource = class extends Native {
      constructor(url, options) {
        super(url, options);
        globalThis.__nexoObserved.sources.push(this);
        for (const type of ['telemetry.accepted', 'vehicle.updated', 'alert.created']) {
          this.addEventListener(type, (event) => {
            try {
              const value = JSON.parse(event.data);
              if (typeof value.messageId !== 'string' || value.type !== type) throw new Error();
              globalThis.__nexoObserved.frames++;
              globalThis.__nexoObserved.messages[value.messageId] = {
                type,
                eventId: value.eventId,
                vehicleId: value.vehicleId,
              };
            } catch {
              globalThis.__nexoObserved.invalid = true;
            }
          });
        }
      }
    };
  });
}

export async function received(page) {
  return page.evaluate(() => ({
    messages: globalThis.__nexoObserved.messages,
    frames: globalThis.__nexoObserved.frames,
    invalid: globalThis.__nexoObserved.invalid,
    active: globalThis.__nexoObserved.sources.filter((source) => source.readyState === 1).length,
    opened: globalThis.__nexoObserved.sources.length,
  }));
}
