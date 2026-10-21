# Admisión durable — E1-I02

La [issue #14](https://github.com/ngarayc/Nexo/issues/14) prepara pg-boss, admite lotes mediante HTTP y permite consultar sus recibos durables. El [consumidor de E1-I03](classification.md) clasifica cada posición y confirma sus efectos y continuación conjuntamente. Un lote que termina dentro del plazo devuelve 200 con resultados durables; un trabajo aún pendiente conserva su respuesta 503 consultable. La pantalla conserva el acceso inicial de E0.

## Contratos HTTP y acceso

| Ruta                                    | Acceso      | Resultado                                                                               |
| --------------------------------------- | ----------- | --------------------------------------------------------------------------------------- |
| `POST /api/events/batch`                | `X-API-Key` | Admisión durable y espera de resultados; 200 solo con todas las posiciones clasificadas |
| `GET /api/ingestions/:ingestionId`      | `X-API-Key` | 200 al leer el recibo, aunque siga pendiente; 404 si no es visible                      |
| `GET /api/demo/ingestions/:ingestionId` | Sesión demo | La misma lectura sin entregar la API key a Angular; 404 fuera del modo demo             |

La clave se valida en middleware antes de cuotas y lectura del cuerpo; una cookie, Origin o token CSRF no la sustituyen. Las peticiones de productor no consultan el almacén de sesiones. El guard comprueba una marca interna del request que solo se obtiene al validar la clave, sin copiarla al objeto ni revelar su valor. Las lecturas de demo usan la cuota compartida de sesión; sus rechazos de acceso conservan el contrato de [acceso](access.md).

Se aceptan `application/json` UTF-8 y contenido sin compresión. Las cuotas del productor son 1.200 POST/minuto y otras 1.200 lecturas/minuto, con contadores separados; hay hasta 16 POST activos, liberados al finalizar/desconectar. JSON malformado da 400 MALFORMED_JSON; sobre incorrecto/vacío, 400; tamaño/posiciones excesivos, 413; contenido ajeno, 415. Ninguno crea una recepción nueva. Los rechazos por capacidad dan 503 y los de frecuencia 429. Clave inválida da 403 incluso con JSON incorrecto dentro del transporte admitido.

`Idempotency-Key` es opcional y debe ser UUID v4; si falta, se genera. Su reutilización con otro cuerpo da 409 INGESTION_ID_CONFLICT. La igualdad de recepción conserva cadenas de fecha exactas y difiere de la igualdad temporal de eventos. No se reutiliza eventId como identidad del envío ni se reenvía automáticamente ante incertidumbre.

Los errores de ingesta usan `application/problem+json`: type, title, status, detail, code y requestId. Conservan los contadores mínimos. Con lectura coherente añaden el recibo, `resultsAvailable: true` y `admission: admitted`; un pendiente da 503 INGESTION_RESULT_PENDING y un fallo técnico comprobado da 500 INGESTION_PROCESSING_FAILED. Un GET leído correctamente sigue siendo 200 en ambos casos. Los detalles técnicos de SQL/cola no se exponen.

Ante un estado no comprobable se devuelve 503 INGESTION_STATUS_UNAVAILABLE, `resultsAvailable: false`, contadores cero sin listas/revisión inventadas y admission admitted/not_admitted/unknown según lo confirmado. Esos ceros no afirman ausencia de efectos. Un 404 tampoco descarta una admisión concurrente todavía sin confirmar. La API no guarda el primer error HTTP como resultado final de un recibo.

El presupuesto total comienza en el middleware y es de 60 segundos. Se reservan 8 segundos para lectura/respuesta, y una lectura lenta queda acotada dejando un segundo para formar la respuesta. Vencer el plazo o desconectar detiene la espera HTTP; no cancela ni demuestra rollback de una transacción. El proxy permite 75 segundos y los clientes nativos de prueba usan 90. No se conserva una conexión SQL durante los intervalos de espera.

NGINX admite 2 MiB, transmite sin buffering completo y conserva los errores JSON del backend. Su propio 413 también es JSON identificable con no-store y cabeceras de seguridad. El transporte puede rechazar antes de que la aplicación autentique; no se promete 403 para framing o tamaño rechazados por esa frontera. Fuentes: [request buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_request_buffering), [error_page](https://nginx.org/en/docs/http/ngx_http_core_module.html#error_page) y [Problem Details](https://www.rfc-editor.org/rfc/rfc9457.html).

## Cola y preparación

Se fija pg-boss 12.38.0 con su esquema 46 separado en `pgboss`; sus objetos pertenecen a la biblioteca. El preparador propietario inicia la migración, crea `telemetry.ingest` y actualiza sus ajustes mutables antes de servir HTTP. El backend carece de contraseña de propietario. No se añaden servicios permanentes ni FK desde recibos a jobs.

| Ajuste                               | Valor                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| Política y partición                 | standard, sin partición dedicada                                               |
| Reintentos automáticos               | retryLimit 0 en cola y publicación                                             |
| Expiración de ejecución              | 30 segundos                                                                    |
| Retención de jobs pendientes         | 7 días                                                                         |
| Limpieza de completados              | Después de 24 horas                                                            |
| Aviso de trabajo                     | NOTIFY habilitado; listener con polling de respaldo al incorporar consumidores |
| Supervisión, monitor y mantenimiento | 5 segundos en la instancia de ejecución                                        |

Estas cantidades son elecciones de Nexo. No garantizan tiempo de finalización. Las tablas propias conservan entrada/resultados hasta reset; limpiar un job no elimina un recibo. El consumidor comprueba generación/jobId/cursor/notBefore y reserva la primera oportunidad de cada posición siguiente. La recuperación de fallos y tres oportunidades se completa con el reconciliador de E1-I04. No se utiliza el contador de jobs como contador de eventos.

`platform/queue/prepare.ts` usa el propietario; `policy.ts` y `QueueConnection` distinguen esa preparación de la instancia runtime con `migrate: false`, `createSchema: false`, pool máximo 4 y listener dedicado. Se inicia antes de servir HTTP, con `nexo_app` y sin CREATE en el esquema. Puede leer/escribir/eliminar los objetos internos de la biblioteca y ejecutar sus funciones; los permisos de las tablas de dominio continúan separados. Esto no concede DDL o borrado de eventos/recibos al runtime.

Fuentes: [instalación](https://pgboss.io/install), [constructor](https://pgboss.io/api/constructor), [opciones de jobs](https://pgboss.io/api/jobs). El coste de compartir PostgreSQL es coordinar migraciones, permisos, mantenimiento y conexiones con las operaciones de dominio; no se afirma aislamiento de recursos entre ambas cargas.

## Sobre, identidad y capacidad

`modules/ingestion/domain/batch.ts` valida el sobre estricto y conserva posiciones originales mediante [OriginalJson](persistence.md). Admite hasta 1.000 posiciones y 2 MiB de cuerpo. Un JSON legible puede contener posiciones inválidas; su validación de dominio se hace después. Los límites son independientes y se comprueban en el valor exacto y con uno adicional. La clave opcional de recepción debe ser UUID v4; su representación canónica no modifica los IDs de eventos o vehículos.

`INGEST_MAX_EVENTS_PER_BATCH` e `INGEST_MAX_BODY_BYTES` permiten reducir esos valores dentro del perfil soportado. Superar 1.000/2 MiB se rechaza al arrancar para no ocultar incompatibilidad con el esquema/proxy. Cambiar el perfil exige revisar y verificar ambas capas; demo y CI ordinario conservan los valores predeterminados. No se aumenta un límite solo para obtener verde.

`AdmissionStore.admit` recupera primero un recibo existente: cuerpo estructuralmente igual devuelve existing; diferente produce conflicto sin sobrescritura. Para uno nuevo limita la espera local, abre una transacción, adquiere un bloqueo asesor transaccional de admisión y vuelve a leer en una sentencia posterior. La decisión de capacidad observa entonces las admisiones anteriores y conserva READ COMMITTED.

| Reserva conjunta        | Máximo inicial |
| ----------------------- | -------------- |
| Lotes activos           | 64             |
| Posiciones pendientes   | 20.000         |
| Bytes lógicos activos   | 64 MiB         |
| Posiciones retenidas    | 200.000        |
| Bytes lógicos retenidos | 512 MiB        |

Los bytes suman cuerpo y fragmentos de posiciones realmente conservados; incluyen copias lógicas, sin atribuirse al tamaño físico de PostgreSQL. Los agregados se obtienen de los recibos, sin tabla de contadores extra. Un lote terminal libera capacidad activa y conserva retención. Consultar/reutilizar un recibo no vuelve a reservarla. La medición del coste de estos agregados sobre el volumen final sigue pendiente.

La transacción guarda recibo, posiciones y primera oportunidad: generación/presupuesto 1, job identificado y tiempo de base. Publica mediante `fromDrizzle(tx, sql)` y exige el ID reservado. Un fallo tras publicar revierte también el job. Se conserva input en las posiciones posteriores sin habilitarlas todavía. La aplicación no mantiene ese bloqueo o una conexión SQL mientras espera un resultado HTTP.

Fuentes: [adaptador transaccional Drizzle](https://pgboss.io/api/adapters), [bloqueos asesores](https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS). El encadenamiento, presupuestos y recibos son adaptaciones de Nexo; el adaptador no demuestra por sí solo tolerancia a un commit incierto o ACK perdido.

## Lecturas y presupuesto SQL

`ReceiptReader.find` obtiene padre y posiciones en una sentencia, sin mezclar revisiones. Sus resultados clasificados, índices pendientes e índices técnicos fallidos particionan total. Solo todas las posiciones clasificadas permiten complete; los fallos técnicos no cuentan como rejected. Devuelve únicamente el identificador del evento y diagnóstico acotado, sin extras o input original al cliente. Una inconsistencia se trata como fallo técnico, nunca como recibo vacío.

El pool compartido de consultas/sesiones/salud tiene máximo 4 conexiones. `DatabaseSlots` limita operaciones admitidas y espera, además del tamaño del pool: una espera vencida se retira y no ejecuta luego su operación. Los adaptadores de ingesta reciben ese mismo presupuesto de lectura. Para admisión se reserva un turno de escritura, hasta 15 esperando y adquisición de dos segundos; las transacciones usan límite total PostgreSQL de 10 segundos, además de lock/sentencia de 1/5 segundos. WriteDatabase dispone de máximo 6 conexiones, compartidas con los consumidores/recuperación posteriores; biblioteca 4, consultas 4 y listener 1. Outbox reservará la conexión restante del presupuesto de 16. Las pruebas de carga y cierre durante trabajo activo se completan en E1-I04/I06.

## Evidencia y siguiente límite

La suite nativa comprueba esquema/política, publicación/reclamación/confirmación con permisos runtime y rollback mediante el adaptador real. Añade admisión original/recibo pendiente, carrera de la misma identidad, equivalencias decimales/conflictos, fallo después del send y competencia por la última plaza activa. Las pruebas del sobre y de los turnos SQL conservan límites exactos y vencimiento sin ejecución tardía. [Verificación](verification.md) registra conteos y candidatos; los fixtures de cuota son sintéticos y separados de la demo oficial.

La integración HTTP adicional pasa por API y NGINX reales sin puertos de host, y verifica clave antes de JSON, formato/tamaño/número, cuerpos fragmentados, 1.000 posiciones y exactamente 2 MiB, reutilización/conflicto, lectura por sesión y conservación de recibos/jobs tras reinicio. Comprueba los bytes lógicos originales; no publica cuerpos, claves o cookies. Un buffer de captura SQL insuficiente y una carrera de readiness del test se corrigieron sin modificar límites de la aplicación.

E1-I03 añade clasificación y resultado final real, incluyendo ambas pasadas del fixture por HTTP y sin reset entre ellas. Las pruebas unitarias de transporte siguen sustituyendo puertos explícitamente; los casos nativos ejecutan consumidor, SQL y proxy reales. Faltan recuperación completa bajo fallos, consultas del dominio y despacho SSE. No se afirma ejecución exactamente una vez ni capacidad productiva.
