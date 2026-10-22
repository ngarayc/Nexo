import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AccessFacade } from '../../features/access/access-facade';
import { LiveMonitor } from '../../features/live-monitoring/live-monitor';
import { FleetFacade } from '../../features/fleet/fleet-facade';
import { AlertsFacade } from '../../features/alerts/alerts-facade';
import { formatTime } from '../presentation/format-time';

@Component({
  selector: 'nexo-app-shell',
  imports: [RouterOutlet],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShell {
  readonly access = inject(AccessFacade);
  readonly monitor = inject(LiveMonitor);
  readonly fleet = inject(FleetFacade);
  readonly alerts = inject(AlertsFacade);
  readonly formatTime = formatTime;
}
