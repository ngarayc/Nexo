import { firstValueFrom, fromEvent, takeUntil, timeout } from 'rxjs';
import type { Observable } from 'rxjs';

export function readResponse<T>(request: Observable<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted)
    return Promise.reject(new DOMException('Solicitud cancelada.', 'AbortError'));
  const bounded = request.pipe(timeout(15000));
  return firstValueFrom(signal ? bounded.pipe(takeUntil(fromEvent(signal, 'abort'))) : bounded);
}
