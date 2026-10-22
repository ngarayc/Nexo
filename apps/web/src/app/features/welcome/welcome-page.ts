import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AccessFacade } from '../access/access-facade';
import { LiveMonitor } from '../live-monitoring/live-monitor';
import { FleetFacade } from '../fleet/fleet-facade';
import { AlertsFacade } from '../alerts/alerts-facade';
import { formatTime } from '../../platform/presentation/format-time';

@Component({
  selector: 'nexo-welcome-page',
  templateUrl: './welcome-page.html',
  styleUrl: './welcome-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WelcomePage {
  readonly access = inject(AccessFacade);
  readonly monitor = inject(LiveMonitor);
  readonly fleet = inject(FleetFacade);
  readonly alerts = inject(AlertsFacade);
  readonly formatTime = formatTime;
}
