import { Injectable, computed, inject } from '@angular/core';
import { formatIdentity } from '../../platform/presentation/identity-text';
import { FleetFacade } from '../fleet/fleet-facade';
import { AlertsFacade } from './alerts-facade';

@Injectable({ providedIn: 'root' })
export class AlertsFilterFacade {
  private readonly alerts = inject(AlertsFacade);
  private readonly fleet = inject(FleetFacade);
  readonly allKey = 'all';
  readonly vehicleId = this.alerts.vehicleId;
  readonly items = this.alerts.visibleItems;
  readonly total = this.alerts.visibleTotal;
  readonly overallTotal = this.alerts.total;
  // Toda identidad string se codifica con comillas JSON; ninguna colisiona
  // con el valor global. La clave es estable aunque cambie el orden de flota.
  readonly selectionKey = computed(() => {
    const id = this.vehicleId();
    return id === null ? this.allKey : JSON.stringify(id);
  });
  readonly missing = computed(() => {
    const id = this.vehicleId();
    return id !== null && this.fleet.get(id) === undefined;
  });
  readonly options = computed(() => {
    const ids = this.fleet.items().map((vehicle) => vehicle.vehicleId);
    const selected = this.vehicleId();
    if (selected !== null && !ids.includes(selected)) ids.push(selected);
    return Object.freeze(
      ids.map((id) =>
        Object.freeze({
          key: JSON.stringify(id),
          label:
            'Vehículo ' +
            formatIdentity(id) +
            (this.fleet.get(id) === undefined ? ' (ausente de la flota)' : ''),
          vehicleId: id,
        }),
      ),
    );
  });
  selectKey(key: string): void {
    if (key === this.allKey) this.showAll();
    else {
      const option = this.options().find((item) => item.key === key);
      if (option) this.alerts.selectVehicle(option.vehicleId);
    }
  }
  showAll(): void {
    this.alerts.selectVehicle(null);
  }
}
