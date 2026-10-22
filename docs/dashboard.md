# Flota e historial en Angular

La [issue #30](https://github.com/ngarayc/Nexo/issues/30) incorpora la historia EP-01 visible: tabla de último estado, búsqueda y detalle de observaciones. Reutiliza la [coordinación de snapshot/SSE](frontend-sync.md), sin otro stream o estado duplicado. [EP-03](agent-cycles/EP-03.md) incorpora la lista global de alertas y acceso al evento, antes del filtro CR-01.

## Recorrido

Después de ingresar, la aplicación confirma una base y presenta los vehículos ordenados por su identificador exacto. La tabla muestra última observación, velocidad recibida en km/h, encendido y estado: Apagado, En movimiento o Detenido. Fecha/hora usan español, America/Bogota y formato 00–23 con segundos. Si varias observaciones comparten la etiqueta visual, su orden sigue siendo el del instante exacto y eventId.

Buscar vehículo filtra por subcadena sin distinguir mayúsculas. `%` y `_` son caracteres literales; limpiar restaura la colección. El resumen de estados y los totales globales no se sustituyen por el subconjunto visible. Un resultado sin coincidencias se distingue de una flota vacía confirmada y de la primera carga.

Ver historial selecciona la identidad original y enfoca el panel. Sus observaciones se ordenan cronológicamente, con evento, fecha/hora, velocidad, encendido, latitud y longitud recibidas. No se deducen nuevos atributos GPS. Un evento tardío puede aparecer en el historial sin cambiar la fila del último estado. Cambiar o cerrar selección cancela su captura/HTTP; las respuestas antiguas no reemplazan el vehículo actual. La búsqueda puede ocultar esa fila sin cambiar la selección.

Cerrar historial devuelve foco a la fila si sigue visible; si no, a la búsqueda. Carga, espera por reconexión, error con Reintentar y vacío confirmado tienen mensajes distintos. Un historial previo pendiente se señala como posiblemente desactualizado; un error no borra la flota válida. Si la nueva base ya no contiene el vehículo, la respuesta vacía confirmada lo indica explícitamente.

## Alertas globales

La navegación Flota/Alertas conserva la base y conexión de la sesión. Alertas presenta eventos confirmados con más de 80 km/h, orden descendente exacto y contador global; buscar en flota no filtra esa lista. Ver evento abre el historial del vehículo, conserva eventId y destaca/enfoca la observación original. Otra observación recibida después no roba el foco de búsqueda. Vacío confirmado, primera carga y datos desactualizados se distinguen igual que en flota. La lista todavía no ofrece filtro por vehículo: ese es el cambio CR-01 posterior.

## Identificadores, transporte y seguridad

Las acciones conservan el valor original. Solo la presentación convierte controles, unidades sustitutas aisladas y marcas de dirección invisibles a escapes Unicode; las barras inversas literales se duplican para distinguirlas de esos escapes. No se normaliza, repara o reemplaza la identidad de dominio. Emoji y caracteres visibles permanecen legibles.

Un ID largo tiene un resumen con Ver completo y el texto íntegro en un contenedor desplazable por teclado. Esa presentación no reduce el valor consultado. El adaptador de historial usa GET cuando es representable; IDs largos, con NUL o sustitutos usan el POST JSON complementario con sesión/CSRF, según [consultas](queries.md). NGINX rechaza %00 antes del controlador; esta selección de transporte evita perder una identidad válida. La clave de productor permanece fuera de Angular.

La selección de GET comprueba además que el parser URL conserve exactamente el path construido. Los IDs `.` y `..` también usan JSON: el [estándar URL](https://url.spec.whatwg.org/#single-dot-path-segment) define su tratamiento como segmentos de navegación, que cambiaría la ruta del historial. El cuerpo conserva la identidad original sin reinterpretarla como navegación.

Datos de telemetría se interpolan como texto, sin innerHTML o plantillas generadas desde ellos. [La documentación de seguridad de Angular](https://angular.dev/best-practices/security) explica el tratamiento de datos en bindings/interpolación; Nexo lo combina con CSP y un caso real que presenta una cadena con img/onerror sin crear el elemento o ejecutar código. No se relaja la política para representar un ID.

## Organización, accesibilidad y límites

AppShell mantiene cabecera, acceso y conexión a través del router; FleetPage conecta fachadas e intenciones. FleetTable y VehicleHistory reciben vistas y no consultan red. IdentityText concentra la representación de IDs; formatTime solo da formato. Cada colección mantiene su propietario original y el detalle comparte el presupuesto global existente.

Las tablas usan caption, encabezados con scope y regiones de desplazamiento enfocables, siguiendo [W3C WAI](https://www.w3.org/WAI/tutorials/tables/one-header/). Los estados tienen texto además de color. El historial es una región dentro de la página, con foco explícito y cierre por teclado; no es un modal que bloquee el resto. En pantallas estrechas las tablas desplazan sus columnas dentro de su contenedor.

La vista materializa todas las filas de sus colecciones; no hay paginación de servidor o promesa de capacidad productiva para miles de vehículos. Los reintentos y costes de descarga completa son los documentados en sincronización. La [issue #35](https://github.com/ngarayc/Nexo/issues/35) añade dos navegadores con el fixture original, carreras y recuperación; sus resultados/candidatos están en verificación.

## Comprobaciones

Pruebas de presentación verifican ausencia de ceros/vacíos inventados, estados de historial, representación de Unicode/HTML, selección por identidad y recuperación de foco. Chromium con API/PostgreSQL/NGINX reales comprueba contenido renderizado, búsqueda literal por IDs exactos, tardío recibido por SSE, hora 24h, pantalla de 360 px, teclado y POST JSON para 70.000 caracteres, NUL, una unidad sustituta aislada y los IDs `.`/`..`. [Verificación](verification.md) registra los resultados y candidatos efectivos.
