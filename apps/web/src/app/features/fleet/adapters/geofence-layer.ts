import * as L from 'leaflet';
import { demoGeofence } from '../geofence';

export function geofenceBounds(): L.LatLngBounds {
  return L.latLngBounds(
    [demoGeofence.south, demoGeofence.west],
    [demoGeofence.north, demoGeofence.east],
  );
}

export function addGeofenceLayer(map: L.Map): void {
  L.rectangle(geofenceBounds(), {
    color: '#2463eb',
    fillColor: '#2463eb',
    fillOpacity: 0.07,
    weight: 2,
    dashArray: '6 5',
    interactive: false,
    className: 'nexo-geofence',
  }).addTo(map);
}

export function fitGeofence(map: L.Map): void {
  map.invalidateSize({ pan: false });
  map.fitBounds(geofenceBounds(), { padding: [24, 24], animate: false });
}
