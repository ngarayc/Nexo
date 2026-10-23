import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AccessFacade } from '../features/access/access-facade';
import { LiveMonitor } from '../features/live-monitoring/live-monitor';
import { FleetFacade } from '../features/fleet/fleet-facade';
import { AlertsFacade } from '../features/alerts/alerts-facade';
import { ReplayPanel } from '../features/demo-replay/replay-panel';
import { formatTime } from '../platform/presentation/format-time';
import { Icon } from '../platform/presentation/icon';
import { ActionTooltip } from '../platform/presentation/action-tooltip';

@Component({
  selector: 'nexo-app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ReplayPanel, Icon, ActionTooltip],
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
