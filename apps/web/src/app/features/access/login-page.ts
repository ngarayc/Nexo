import { Icon } from '../../platform/presentation/icon';
import { ActionTooltip } from '../../platform/presentation/action-tooltip';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AccessFacade } from './access-facade';

@Component({
  selector: 'nexo-login-page',
  imports: [ReactiveFormsModule, Icon, ActionTooltip],
  templateUrl: './login-page.html',
  styleUrl: './login-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPage {
  readonly access = inject(AccessFacade);
  readonly form = new FormGroup({
    username: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  submit(): void {
    if (this.form.invalid || this.access.pending()) return;
    const { username, password } = this.form.getRawValue();
    this.form.controls.password.reset('');
    void this.access.login(username, password);
  }
}
