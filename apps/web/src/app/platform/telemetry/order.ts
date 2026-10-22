import { compareEventOrder, readObservedInstant } from '@nexo/contracts';
import type { EventView, ObservationOrder } from '@nexo/contracts';
import { TelemetryProtocolError } from './telemetry-contract';

type OrderedView = Pick<EventView, 'eventId' | 'observedAt'>;
const orders = new WeakMap<OrderedView, ObservationOrder>();
function order(view: OrderedView): ObservationOrder {
  const known = orders.get(view);
  if (known) return known;
  const observedAt = readObservedInstant(view.observedAt);
  if (!observedAt) throw new TelemetryProtocolError();
  const value = { eventId: view.eventId, observedAt };
  orders.set(view, value);
  return value;
}
export function compareViews(first: OrderedView, second: OrderedView): -1 | 0 | 1 {
  return compareEventOrder(order(first), order(second));
}
