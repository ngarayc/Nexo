# Reglas de dominio y GPS

El [contrato suministrado](requirements/common-spec.md) y los fixtures son la referencia de aceptación. Esta página concentra decisiones que deben conservar implementación y revisión; no acredita funcionalidad ejecutada.

## Identidad y validación

- `eventId` y `vehicleId`: strings no vacíos; identidad exacta, sin recortar, cambiar mayúsculas ni sustituir el valor por un digest.
- `eventId` es globalmente único con garantía persistente bajo concurrencia. Mismo payload es duplicado; payload distinto es conflicto sin sobrescritura.
- No reparar automáticamente JSON, completar campos ausentes o convertir strings numéricos en números. Sintaxis JSON incorrecta rechaza la petición; un registro inválido de un lote legible se rechaza individualmente.
- Latitud finita entre −90 y 90; longitud finita entre −180 y 180; `speedKph` finito y no negativo; `ignitionOn` booleano estricto.
- Conservar identidad y representación de entrada sin perder información relevante para igualdad y conflicto. [Persistencia](persistence.md) documenta la representación reversible, exclusión por igualdad y JSON original; [clasificación](classification.md) describe su aplicación transaccional y comprobaciones.

## Tiempo, estado y alertas

`observedAt` debe ser ISO 8601 válido con zona. Comparar el instante exacto, conservando la precisión admitida. Ordenar historiales por instante y desempate determinista por `eventId`; elegir el último estado por ese orden, nunca por llegada. Un evento tardío válido permanece en el historial.

`OFF` si `ignitionOn` es falso; `MOVING` si es verdadero y la velocidad supera cero; `STOPPED` si es verdadero y la velocidad es cero.

Cada evento nuevo aceptado con `speedKph > 80` produce una `OVERSPEED`, aunque sea tardío. Exactamente 80 no produce alerta. Duplicados y rechazados no crean efectos de dominio.

La UI muestra español, America/Bogota y hora de 24 horas. No usa la etiqueta formateada para ordenar o comparar.

## Transporte y geografía

Usar `speedKph` recibido; no recalcular velocidad a partir de posiciones ni deducir precisión GPS, ruta vial, altitud o señal no suministradas. Leaflet recibe `[latitud, longitud]`; GeoJSON, si se incorpora, recibe `[longitud, latitud]`.

Los GET exigidos se conservan. Las consultas JSON complementarias de historial y, después en CR-01, de alertas permiten transportar IDs no representables por URL. Reutilizan los mismos casos de uso e identidad; deben devolver iguales datos, orden y totales sobre una misma base, sin efectos de negocio. Su contrato y pruebas se incorporan en E1/E4.

## Oráculos

Primera reproducción ordenada: 20 aceptados, 2 duplicados y 2 rechazados. Segunda sin reset: 0 aceptados, 22 duplicados y 2 rechazados. Permanecen 20 eventos, 8 vehículos y 4 alertas con las identidades de los oráculos.

No se mezclan datos adversariales o de carga con esta demostración. Los controles del reproductor actúan sobre el emisor; no pausan vehículos reales, recepción o procesamiento ya admitido.
