import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AccessFacade } from '../access/access-facade';

@Component({
  selector: 'nexo-welcome-page',
  templateUrl: './welcome-page.html',
  styleUrl: './welcome-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WelcomePage {
  readonly access = inject(AccessFacade);
}
