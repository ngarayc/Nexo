import { expect, it } from 'vitest';
import { DemoMaintenance, DemoMaintenanceBusy } from './demo-maintenance.js';

it('excluye limpiezas concurrentes e invalida admisiones iniciadas antes de limpiar', async () => {
  const maintenance = new DemoMaintenance();
  const previous = maintenance.generation;
  const release = maintenance.begin();
  expect(() => maintenance.begin()).toThrow(DemoMaintenanceBusy);
  await expect(maintenance.ingestion(maintenance.generation, async () => true)).rejects.toThrow(
    DemoMaintenanceBusy,
  );
  release();
  release();
  await expect(maintenance.ingestion(previous, async () => true)).rejects.toThrow(
    DemoMaintenanceBusy,
  );
  await expect(maintenance.ingestion(maintenance.generation, async () => true)).resolves.toBe(true);
});

it('no limpia mientras una admisión conserva trabajo aunque el cliente deje de esperar', async () => {
  const maintenance = new DemoMaintenance();
  let finish!: () => void;
  const pending = maintenance.ingestion(
    maintenance.generation,
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  expect(() => maintenance.begin()).toThrow(DemoMaintenanceBusy);
  finish();
  await pending;
  const release = maintenance.begin();
  release();
  await expect(
    maintenance.ingestion(maintenance.generation, async () => {
      throw new Error('fallo');
    }),
  ).rejects.toThrow('fallo');
  maintenance.begin()();
});
