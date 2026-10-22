# Velocidad observada

La [issue #72](https://github.com/ngarayc/Nexo/issues/72) incorpora Chart.js 4.6.1 mediante un adaptador de presentación. `VehicleDetailFacade.items` sigue siendo la única colección histórica; gráfico, [trayectoria](cartography.md) y tabla comparten `focusedEvent`. El gráfico no abre consultas o streams ni calcula una velocidad a partir de posiciones.

## Muestras y referencia

Cada observación aceptada produce un punto con su velocidad recibida y conserva el EventView original, eventId e instante exacto. Las uniones son rectas, con tensión cero y sin animación; no se generan muestras intermedias. Una muestra aparece como un punto sin segmento observado. El vacío tiene un mensaje explícito y no crea una instancia gráfica.

La referencia horizontal de 80 km/h es un dataset separado, con línea discontinua y sin puntos seleccionables o tooltip de observación. La interfaz aclara «Alerta cuando supera 80 km/h». Esa referencia no clasifica eventos ni crea alertas: los conteos siguen viniendo del servidor. Los puntos de 80 y 81 km/h conservan exactamente esos valores del DTO.

El eje vertical expresa km/h, incluye cero y alcanza al menos la referencia. Sus límites permanecen finitos incluso para la velocidad máxima finita admitida por el contrato; cinco marcas y notación científica para valores grandes evitan etiquetas desmesuradas. Los puntos del borde se dibujan completos mediante el control de recorte del dataset, sin agregar datos fuera del intervalo.

## Tiempo y precisión visual

El eje horizontal es [lineal](https://www.chartjs.org/docs/latest/axes/cartesian/linear.html): representa milisegundos transcurridos desde la primera observación. La diferencia de segundos se calcula antes de convertir a Number y la fracción se aproxima exclusivamente para dibujar. No requiere adaptador de fechas. Las etiquetas muestran fecha y hora Bogotá en formato 24h; tooltip y detalle conservan la observación seleccionada.

Ese número no participa en orden, igualdad o deduplicación. El historial conserva su comparador exacto y cada punto conserva la cadena temporal completa del DTO. Muestras con tiempos iguales a resolución de píxel, incluso por debajo del nanosegundo, permanecen separadas por eventId y pueden elegirse en la tabla. Con un intervalo gráfico nulo se usa un margen visual de 1ms para dibujar la referencia; no se incorpora otra observación.

Un tardío se inserta según el historial, puede modificar el intervalo visible y conserva la selección por ID aunque cambien índices. Un duplicado no agrega muestras. Las actualizaciones no cambian el foco del usuario. Cambiar de vehículo o cerrar sesión usa la cancelación y limpieza existentes del detalle.

## Interacción y accesibilidad

Pulsar un punto selecciona su evento original y sincroniza fila, trayectoria y detalle numérico. Elegir una fila por teclado o abrir una alerta produce la misma selección. Los puntos coincidentes se desambiguan mediante los botones nativos del historial, sin depender de precisión del puntero.

El canvas tiene nombre y descripción, y presenta texto que remite a esa tabla con todas las muestras y acciones equivalentes. La selección muestra identidad, hora y km/h como texto. Esta alternativa sigue la [advertencia de accesibilidad de Chart.js](https://www.chartjs.org/docs/latest/general/accessibility.html): una etiqueta del canvas no expone todos sus datos a lectores de pantalla. La referencia usa trazo discontinuo además de color y tiene explicación visible.

## Adaptación, recursos y límites

`speed-series` construye únicamente el modelo gráfico y conserva referencias a los eventos originales. `VehicleSpeedChart` recibe inputs y emite intenciones; su puerto permite probar ese contrato sin sustituir el constructor por una implementación de canvas ficticia. `ChartJsSpeed` realiza el dibujo y destruye su instancia al salir.

Se registran solo controlador de línea, elementos de línea/punto, escala lineal y tooltip, conforme a la [integración modular](https://www.chartjs.org/docs/latest/getting-started/integration.html). Las [opciones de línea](https://www.chartjs.org/docs/latest/charts/line.html) sustentan trazo recto, puntos y recorte; la selección/coordinación y el modelo exacto son decisiones de Nexo. La [API de Chart.js](https://www.chartjs.org/docs/latest/developers/api.html) aporta update sin animación y destroy para liberar listeners. Los recursos y avisos MIT se distribuyen en la imagen web; no se agregan CDN, servicios o permisos CSP.

La colección se representa completa, sin decimación o normalización que presuponga tiempos únicos. Esto conserva muestras y tiene un coste de memoria/dibujo proporcional al historial; no acredita capacidad productiva sin medirla. La precisión gráfica y las etiquetas numéricas son aproximaciones de presentación. [Verificación](verification.md) registra pruebas ejecutadas, fallos y resultados del candidato.
