# Geocerca fija de demostración

La [issue #102](https://github.com/ngarayc/Nexo/issues/102) añade una única zona rectangular de consulta. Es un complemento P1: no modifica la ingesta, los estados de encendido/movimiento, las alertas OVERSPEED o los oráculos. No tiene editor, persistencia propia, dependencia nueva ni endpoint adicional.

## Zona y clasificación

`features/fleet/geofence.ts` define sur `14.605`, oeste `−90.545`, norte `14.621` y este `−90.529`. Sus cuatro bordes están incluidos; el nombre «Zona de demostración» no representa una delimitación administrativa real. La función pura compara las coordenadas originales, sin proyectarlas o aproximarlas. Una coordenada inválida se indica como desconocida, nunca como exterior por defecto.

La tabla muestra Dentro/Fuera en una columna independiente. El mapa cuenta la flota visible y dibuja el mismo rectángulo; búsqueda y estado conservan sus filtros. Las actualizaciones usan la colección existente del snapshot/SSE. El control Ver geocerca permite encuadrarla expresamente; recibir nuevos datos no mueve el encuadre por esta funcionalidad.

## Cambios observados

El historial deriva entradas y salidas entre muestras confirmadas, ordenadas con el comparador temporal exacto compartido y eventId como desempate. No modifica el array recibido, no compara vehículos diferentes y no inventa una entrada por la primera muestra. Una posición desconocida interrumpe la continuidad; una muestra repetida no crea otro cambio.

Cada cambio conserva las dos observaciones y permite seleccionar la posterior con el control accesible existente. El intervalo no acredita un punto, recorrido o instante exacto de cruce. Son cambios observados de presentación: no se almacenan ni se suman al contador de alertas. Una muestra tardía puede modificar esa reconstrucción histórica sin reemplazar la última posición de flota.

Con el fixture original terminado, VEH-001 y VEH-002 quedan dentro y los otros seis fuera. Sus historiales contienen dos entradas y seis salidas observadas en total. Repetir el fixture mantiene esa clasificación y los resultados obligatorios 20/2/2 → 0/22/2, 20 eventos, 8 vehículos y 4 alertas. Los límites se eligieron para demostrar ambos lados usando las coordenadas originales; no se alteran datos para hacer cruzar vehículos.

## Implementación y comprobación

Los adaptadores de los dos mapas comparten `geofence-layer.ts` y consumen una sola definición. El rectángulo no captura interacción, no solicita datos y se elimina con el mapa. Se conservan rueda desactivada, mundo único y alternativas de tabla/teclado. Los tooltips usan texto inerte; no se amplía CSP ni se añade proveedor.

Las pruebas puras cubren ejes, bordes, esquinas, datos inválidos, precisión temporal y continuidad. Las de componentes cubren colección derivada y selección original; el recorrido de navegador usa API/DB/proxy reales para observar clasificación por SSE, ambas pasadas y dominio conservado. Las comprobaciones ejecutadas se registran en [verificación](verification.md).

Se aplica la [Rectangle de Leaflet](https://leafletjs.com/reference.html#rectangle) sobre [LatLngBounds](https://leafletjs.com/reference.html#latlngbounds). La clasificación, los bordes incluidos y la interpretación conservadora de muestras son decisiones explícitas de Nexo. No es un motor general de polígonos, seguimiento continuo o alertas productivas de entrada/salida.
