import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'nexo-welcome-page',
  templateUrl: './welcome-page.html',
  styleUrl: './welcome-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WelcomePage {}
