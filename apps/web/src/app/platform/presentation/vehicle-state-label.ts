import type { VehicleState } from '@nexo/contracts';

export const stateLabels: Readonly<Record<VehicleState, string>> = Object.freeze({
  OFF: 'Apagado',
  MOVING: 'En movimiento',
  STOPPED: 'Detenido',
});
