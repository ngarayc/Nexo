# Mapa de últimas posiciones

La [issue #67](https://github.com/ngarayc/Nexo/issues/67) incorpora Leaflet 1.9.4 como adaptador de presentación. `FleetFacade.visibleItems` alimenta tanto tabla como marcadores; búsqueda y estado se combinan con AND. El mapa no consulta telemetría, no mantiene otra colección de dominio y no abre una conexión SSE. La [sincronización existente](frontend-sync.md) conserva el último estado y el [historial](dashboard.md) conserva todas las observaciones aceptadas. La imagen web distribuye el archivo `3rdpartylicenses.txt` generado por Angular, incluidos los avisos BSD de Leaflet, junto a los assets.

## Posiciones e interacción

Cada marcador conserva la identidad original del vehículo y recibe `[latitude, longitude]`, según [Leaflet LatLng](https://leafletjs.com/reference.html#latlng). Muestra estado mediante símbolo y texto, velocidad recibida y fecha/hora Bogotá en formato 24h. El tooltip usa elementos DOM con `textContent`; no convierte identidades en HTML. La etiqueta accesible representa el ID completo mediante los mismos escapes visibles que la tabla.

La primera colección no vacía ajusta el encuadre a sus posiciones, con zoom inicial máximo 16. No se usa la zona horaria como centro geográfico. Una colección vacía muestra un mensaje y carece de marcadores inventados. Las actualizaciones posteriores conservan los elementos existentes por ID y el encuadre; un tardío no reemplaza la última posición. Ver flota visible permite ajustar el conjunto actual expresamente.

Seleccionar una fila o marcador abre el mismo detalle y centra su marcador si está visible. Enter y espacio activan los marcadores y la tabla sigue ofreciendo todas las acciones por teclado. Filtrar puede ocultar el marcador sin cerrar el detalle; su aviso permite limpiar los filtros. Al desaparecer un marcador enfocado, el foco vuelve a la región del mapa. El componente destruye mapa, listeners y observador de tamaño al salir, también al cerrar sesión.

La proyección Web Mercator tiene un alcance visual menor que el rango de latitud admitido por el contrato. Si una posición lo supera, aparece un aviso y se conservan sus valores originales; no se rechaza o modifica la telemetría. No se calculan rutas, distancias, velocidades, geocodificación o movimiento interpolado. La trayectoria histórica se incorpora en un incremento posterior.

## Configuración y seguridad

[infra/map-provider.json](../infra/map-provider.json) es la única configuración revisada del proveedor: plantilla HTTPS, origen permitido, atribución, enlace y zoom máximo. No existe un campo de usuario para cambiar URLs. El validador compartido `readMapProvider` se ejecuta en build y cliente: exige forma conocida, origen exacto, URL canónica sin credenciales, tres coordenadas de tile explícitas y ausencia de query/fragmento. Rechaza comodines e intentos de inyección de cabeceras.

[scripts/map-provider.mjs](../scripts/map-provider.mjs) genera el asset público y la configuración NGINX desde ese JSON. Añade solamente ese origen a `img-src` en todas las políticas previstas y falla si no puede comprobarlas. Scripts, estilos y marcadores se sirven localmente; permanecen `script-src 'self'`, `connect-src 'self'`, nonce de estilos por respuesta y ausencia de JavaScript inline/eval. El asset generado queda ignorado en Git y Docker; los comandos web lo regeneran antes de construir, servir o ejecutar pruebas. Node 24 ejecuta el validador TypeScript sin dependencias Angular o Node, mediante su [soporte de tipos eliminables](https://nodejs.org/docs/latest-v24.x/api/typescript.html).

Cambiar proveedor requiere revisar sus condiciones y modificar ese JSON, reconstruir la imagen web y desplegarla. Esta decisión evita desalinear el origen autorizado por CSP y la URL usada por el cliente; no ofrece cambio en caliente. La configuración pública no contiene secretos. Una configuración no válida o inaccesible muestra un error y permite reintento manual, sin borrar flota o historial.

## Proveedor de la demo

La capa estándar de OpenStreetMap usa `https://tile.openstreetmap.org/{z}/{x}/{y}.png` y atribución visible [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Su [política de tiles](https://operations.osmfoundation.org/policies/tiles/) exige identificación y referente adecuados, respeto de caché y ausencia de descargas masivas u offline. No garantiza disponibilidad comercial.

Las imágenes se solicitan directamente desde el navegador, con su identificación normal y caché HTTP habitual. Se desactivan actualizaciones durante zoom y margen extra de tiles; no se incorpora descarga anticipada, almacenamiento offline, proxy o API key cartográfica. El [referrerPolicy de TileLayer](https://leafletjs.com/reference.html#tilelayer-referrerpolicy) se fija en `strict-origin-when-cross-origin`: transmite el origen y evita rutas/consultas de Nexo. La política general sigue siendo `no-referrer`. Credenciales de ingesta y CSRF no se adjuntan a estas imágenes; la cookie de sesión pertenece al host de la aplicación.

El proveedor recibe información de red del navegador y las coordenadas de tiles que describen el área solicitada. La UI informa de esa dependencia externa. Un error de tiles muestra un aviso localizado y Reintentar mapa; no bloquea sesión, filtros, tabla, historial o SSE. El reintento es manual y no hay un bucle de recarga.

## Comprobación

Las pruebas de configuración comprueban rechazo de URLs inseguras y correspondencia entre proveedor y todas las CSP. Las de componentes usan un puerto de renderizado para comprobar colección compartida, identidad, selección, vacío, latitudes polares, recuperación y destrucción. Ese nivel no acredita el renderizado real de Leaflet.

Los recorridos Chromium usan API, PostgreSQL y NGINX reales. El fixture de navegador intercepta tiles con imágenes sintéticas y bloquea el resto de red externa, también en contextos explícitos de dos clientes; no sustituye API o SSE ni consume el servicio público. Comprueban ejes y hemisferio, datos oficiales, filtros, foco, identidad de marcador, encuadre estable ante SSE, fallo de tiles, texto inerte y política efectiva del navegador. Los resultados ejecutados y limitaciones se registran en [verificación](verification.md). Una comprobación final moderada del proveedor real queda separada de las suites y no acredita disponibilidad futura.
