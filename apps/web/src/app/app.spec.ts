import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, expect, it } from 'vitest';
import { routes } from './app.routes';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';

describe('entrada a Nexo', () => {
  it('redirige a acceso cuando el servidor deniega la sesión', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    });
    const harness = await RouterTestingHarness.create();
    const navigation = harness.navigateByUrl('/');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const http = TestBed.inject(HttpTestingController);
    http
      .expectOne('/api/session')
      .flush({ code: 'SESSION_REQUIRED' }, { status: 403, statusText: 'Forbidden' });
    await navigation;
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Nexo');
    expect(harness.routeNativeElement?.querySelector('input[type="password"]')).toBeTruthy();
    http.verify();
  });
});
