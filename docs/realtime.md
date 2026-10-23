# Cambios confirmados por SSE

La [issue #26](https://github.com/ngarayc/Nexo/issues/26) incorpora el transporte backend de tiempo real. Usa la outbox transaccional existente, una instancia API y el mismo origen de la demo. El dashboard Angular y el reproductor conservan sus incrementos propios; este transporte no acredita su interfaz ni la demostración final de dos navegadores.

## Contrato y recuperación

`GET /api/stream` exige la cookie de una sesión vigente. La API key del productor no sustituye esa sesión. El GET del mismo origen puede omitir Origin; si lo envía, debe coincidir exactamente con el origen configurado. La respuesta es `text/event-stream; charset=utf-8`, con `Cache-Control: private, no-store, no-transform` y `X-Accel-Buffering: no`.

La suscripción se registra antes de enviar `stream.ready`, siempre el primer mensaje. Su JSON contiene type, schemaVersion 1, instanceId y heartbeatMilliseconds 15000. Después se envía `stream.heartbeat` cada quince segundos con type, versión e instancia. Ambos son controles sin ID de dominio. La generación se comparte con `GET /api/snapshot`: cambia al reiniciar API y después de recuperar una degradación comprobada.

| Mensaje de dominio | Cuándo se crea                    | data                                      |
| ------------------ | --------------------------------- | ----------------------------------------- |
| telemetry.accepted | Evento nuevo confirmado           | Evento público completo                   |
| vehicle.updated    | El evento cambia latest           | Evento público y state OFF/MOVING/STOPPED |
| alert.created      | Evento aceptado con velocidad >80 | Evento público y type OVERSPEED           |

El sobre contiene messageId UUID v4, schemaVersion 1, type, eventId, vehicleId, observedAt y data. La trama usa `id:UUID`, `event:type` y una línea data con JSON, terminada en línea vacía. Los identificadores libres de telemetría permanecen dentro del JSON escapado; nunca forman campos SSE. `observedAt` conserva el instante UTC exacto. El estado del mensaje vehicle.updated se llama state, mientras la proyección de consulta lo presenta como status. La alerta del stream incluye ignitionOn; la colección de consulta expone su vista más pequeña.

La notificación procede del commit de negocio; duplicados y rechazos no añaden mensajes. Un evento tardío puede producir telemetry.accepted y alert.created sin vehicle.updated. UUID identifica la notificación, no su orden temporal. Los consumidores deben poder ignorar una repetición del mismo UUID y comparar el instante/eventId para actualizar latest.

SSE es una notificación en vivo, sin ACK del navegador ni historial garantizado. Una marca published_at confirma la distribución local, no recepción o renderizado de todos los clientes. Sin suscriptores también se marca: quien llegue después obtiene snapshot. `Last-Event-ID` no solicita retransmisión histórica y los mensajes publicados no se vuelven a distribuir al reiniciar.

Para sincronizar, registrar el stream, esperar ready, almacenar temporalmente cambios y pedir snapshot. Solo combinar si versiones/instancias coinciden; después aplicar el buffer y continuar en vivo. Una desconexión, cambio de generación o `stream.resync-required` exige volver a sincronizar. Un snapshot iniciado antes de una transición puede responder con la generación anterior, que permite detectar esa carrera. La [coordinación Angular](frontend-sync.md) implementa captura acotada y recuperación, sin deducir una vista completa del último UUID recibido.

## Despacho y durabilidad

`OutboxDispatcher` ejecuta un único ciclo no solapado cada 250 ms y recibe un aviso local después del commit de una posición clasificada. Los avisos no sustituyen el polling durable. Si quedan grupos, cede al event loop y continúa. El arranque no espera a drenar todo el backlog para habilitar ingesta y diagnóstico; salud permanece degradada hasta una revisión satisfactoria.

`PostgresOutboxStore` usa una conexión reservada, separada de escrituras, consultas y pg-boss. Selecciona hasta cien metadatos elegibles, por available_at/created_at/message_id, y solo después carga los payloads del grupo de hasta 2 MiB. Una trama mayor se procesa sola, sin truncar datos o rechazar telemetría por el límite del transporte. No se usa un cursor global de UUID que pueda perder una transacción que confirme tarde.

El serializador comprueba versión, tipo, UUID, sobre, datos, reglas del dominio y coincidencia exacta de frame_bytes UTF-8. Reutiliza los codecs y reglas de Telemetría. Cada operación SQL devuelve su cliente antes de distribuir a las conexiones; ninguna transacción queda esperando drain o red del navegador.

Después de distribuir se marca el grupo publicado. Si el marcado devuelve error, se relee la verdad durable: los confirmados no se repiten; los pendientes conservan el mismo UUID y diagnóstico cerrado OUTBOX_MARK_UNCONFIRMED. Una lectura ilegible degrada el servicio y no se interpreta como ausencia. Payload incompatible o fallo de distribución conserva su fila con diagnóstico cerrado, sin exponer la causa interna ni bloquear los otros elegibles.

El backoff durable usa bases 1, 2, 4, 8, 16 y 30 segundos con jitter de hasta 25 %, limitado a treinta segundos en total. Attempts, available_at y código se conservan; no existe un descarte final de la notificación. Los publicados se retienen hasta reset explícito. Esto consume espacio creciente y añade operaciones SQL por grupo; no se presenta como cola para réplicas múltiples ni como garantía de entrega exactamente una vez.

## Conexiones, presión y acceso

Cada conexión admite hasta mil tramas pendientes y 2 MiB, contando su cola y writableLength de Node sin duplicar bytes transferidos. `write=false` ya aceptó esa trama: únicamente las siguientes esperan drain. La distribución no espera que el navegador lea. Quince segundos sin progreso real, un exceso o un error cierran y liberan esa conexión una sola vez; encolar heartbeats no prolonga artificialmente la espera.

`stream.resync-required` lleva versión, instancia y reason CLIENT_CAPACITY. Se intenta solo si puede escribirse inmediatamente sin superar el presupuesto; la corrección no depende de que un cliente saturado reciba ese control. Cada cliente recupera snapshot tras el cierre. Las colas de otros clientes y la ingesta siguen independientes.

Se permiten cuatro streams por SID, dieciséis globales y treinta aperturas por minuto para la cuenta, en contador distinto de lecturas. Sesión y origen se comprueban antes de consumir cuota. Sin sesión: 403; cuota: 429 con Retry-After; capacidad: 503 STREAM_CAPACITY_EXCEEDED; dispatcher degradado: 503 REALTIME_UNAVAILABLE, antes de abrir cabeceras SSE. Cada envío vuelve a comprobar acceso y un temporizador absoluto cierra incluso una conexión ociosa al vencer. Logout, regeneración o revocación cierran solo los streams del SID afectado.

NGINX deshabilita buffering, caché y compresión en esa ruta. Sus sesenta segundos entre lecturas de upstream no son una duración máxima del stream; los heartbeats mantienen actividad. La terminación de una respuesta puede producir aborted/error en el cliente HTTP, que debe iniciar la recuperación correspondiente.

## Salud y operación

`GET /api/health` solo devuelve 200 si base/esquema y dispatcher están disponibles. Tiempo real exige una revisión real de menos de diez segundos, ningún fallo pendiente y edad máxima de trabajo pendiente de treinta segundos. Esa edad avanza entre revisiones. Un heartbeat no acredita el funcionamiento del dispatcher.

La degradación cierra/rechaza streams y deja de afirmar salud completa, conservando ingesta y consultas de diagnóstico. La recuperación requiere volver a comprobar la outbox; renueva instanceId sin reiniciar el dominio o las sesiones. La supervisión usa reloj monotónico para frescura. En SIGTERM se detiene polling, se impiden nuevas escrituras entre operaciones y se espera la consulta activa con los plazos SQL existentes antes de cerrar el pool. Una distribución que no alcanzó a marcar permanece pendiente para reinicio.

El proxy depende de que el contenedor API haya iniciado, de modo que puede exponer ingesta y diagnóstico aunque la publicación falle desde el arranque. Los probes de API/web conservan `/api/health` completo: siguen marcando indisponibilidad y `compose up --wait` no aprueba mientras persista el 503. Durante la preparación inicial puede haber 502 transitorios hasta que la API escuche; no se interpretan como ausencia de admisión. La prueba de arranque reproduce primero el bloqueo con la dependencia anterior de salud y verifica después 503 accesible, ingesta confirmada y recuperación real sin cambiar probes.

No se añaden tablas, contenedores, listeners PostgreSQL o dependencias. El presupuesto total de runtime materializa la conexión antes reservada de outbox: seis de escrituras, cuatro de consultas, cuatro del pool de pg-boss más su listener y una de outbox, dieciséis en total. La base permite además las conexiones operativas separadas ya documentadas.

## Archivos y comprobaciones

`modules/realtime/application` contiene selección, despacho, frescura y transición de disponibilidad. Los adaptadores PostgreSQL y HTTP resuelven almacenamiento y salida; `realtime.module.ts` compone los proveedores. `platform/runtime` comparte generación, sondeo de salud y aviso posterior al commit. La ingesta solo emite ese aviso tras confirmar su transacción. `infra/nginx.conf` configura el proxy incremental.

Las pruebas puras verifican selección, confirmación incierta, códigos, aborto, frescura, backpressure, bytes UTF-8, temporizadores y callbacks tardíos. Dos casos con ServerResponse y TCP reales verifican aislamiento de cola saturada y cierre ocioso absoluto. PostgreSQL real comprueba respuesta perdida después de marcado durable, reintento del mismo UUID, backoff, rollback, commits tardíos, grupos de cien y tramas mayores de 2 MiB con bytes exactos. HTTP por NGINX comprueba dos clientes con las 43 identidades originales, repetición sin cambios nuevos, sesiones, cupos, cuotas y recuperación de un fallo SQL real. El inventario incluye además heartbeat por proxy y los escenarios anteriores; [verificación](verification.md) identifica sus resultados efectivos.

```sh
npm run quality
npm run test:unit
npm run test:integration
npm run test:e2e
```

Las pruebas de estado intermedio invocan el dispatcher real sin otro servidor que publique esas filas concurrentemente. Los casos HTTP usan el servidor activo. Los datos adversariales y fallos SQL se limitan a recursos sintéticos propios; no hay hooks públicos o flags que simulen éxito.

La comprobación complementaria de presión por NGINX pausa cuatro lectores y mantiene otro activo durante 128 eventos y 384 mensajes. Verifica progreso del lector activo, ingesta, salud, persistencia y apertura de cuatro reemplazos de la sesión lenta: esos nuevos cupos prueban la liberación en el servidor sin depender de que el lector pausado observe EOF. No se deriva una capacidad productiva de ese escenario sintético.

## Fuentes y adaptación

El [estándar HTML de SSE](https://html.spec.whatwg.org/multipage/server-sent-events.html) define EventSource, UTF-8 y framing. Nexo añade versión, generación, tipos y recuperación por snapshot; la presencia de Last-Event-ID no implica almacenar una sesión histórica.

[Node HTTP](https://nodejs.org/docs/latest-v24.x/api/http.html#responsewritechunk-encoding-callback) documenta write, callbacks y drain. El adaptador propio añade límites de mensajes/bytes, plazo sin progreso y cierre idempotente; su coste es mantener estado acotado por conexión. La comprobación TCP complementa las pruebas de reloj/salida controlados.

[NGINX proxy_buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering) y [proxy_read_timeout](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_read_timeout) sustentan el paso incremental y el plazo entre lecturas. La adaptación está en una ruta específica para conservar el contrato de las demás operaciones HTTP. La outbox transaccional y la relectura de confirmaciones son decisiones propias de Nexo apoyadas en las garantías PostgreSQL ya citadas en [persistencia](persistence.md) y [recuperación](recovery.md).

Las notificaciones nuevas añaden observedAtOriginal dentro de data, conservando el envelope y schemaVersion1. Se contabiliza su tamaño mediante el serializador de la trama completa. La lectura admite mensajes conservados anteriores sin ese campo; no modifica sus bytes/frame_bytes. Cuando el metadato existe se exige una fecha válida del mismo instante exacto, sin aceptar campos adicionales arbitrarios. El original no se utiliza como clave de orden. [API](api.md) y [verificación](verification.md) documentan la corrección.
