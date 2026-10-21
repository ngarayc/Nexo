# Recuperación durable de ingestas

La [issue #19](https://github.com/ngarayc/Nexo/issues/19) incorpora recuperación independiente del cliente. Perder una respuesta HTTP, detener el emisor o reiniciar API no elimina una recepción confirmada. La verdad está en recibos, posiciones y efectos confirmados en PostgreSQL; el estado del job ayuda a decidir la siguiente transición. No se promete ejecución exactamente una vez.

## Una transición y tres oportunidades

`RecoverItem` sirve tanto al handler que falló como al reconciliador. Abre una transacción nueva, bloquea lote y posición con `FOR UPDATE SKIP LOCKED` y vuelve a comprobar cursor, estado, generación y jobId. Un resultado confirmado o una generación sustituida hacen obsoleto al trabajador anterior. No vuelven a reservar presupuesto ni a modificar dominio o continuación.

La primera oportunidad se reserva al admitir o habilitar una posición. Cada sustitución incrementa juntos generación y oportunidades reservadas, hasta tres por posición; no se reinician al arrancar. pg-boss conserva `retryLimit: 0` tanto en la cola como en cada publicación.

| Sustitución           | Espera desde el fallo comprobado                    |
| --------------------- | --------------------------------------------------- |
| Generación 1 → 2      | 2 segundos + jitter entero uniforme de 0 a 500 ms   |
| Generación 2 → 3      | 4 segundos + jitter entero uniforme de 0 a 1.000 ms |
| Fallo de generación 3 | Cierre técnico; no hay cuarta oportunidad           |

PostgreSQL calcula `max(notBefore anterior, reloj de base + espera)`. La reserva, diagnóstico de la generación anterior, revisión del lote y publicación del nuevo job se confirman juntos mediante `fromDrizzle`. El instante se pasa como ISO UTC con seis decimales, evitando perder microsegundos al convertirlo a `Date`. Durante el backoff no hay una transacción abierta: el scheduler conserva la espera.

Una excepción antes del commit revierte también la publicación y el presupuesto. Una confirmación perdida exige volver a leer: no demuestra rollback ni autoriza repetir el POST. La reserva durable puede haberse confirmado aunque el llamador no recibiera respuesta.

## Inspección y diagnóstico

El reconciliador ejecuta una pasada al iniciar y luego cada cinco segundos. No se solapa consigo mismo; revisa páginas de 20 y hasta 100 lotes por pasada, con presupuesto de diez segundos comprobado entre operaciones. Conserva cursor por `(received_at, ingestion_id)`, avanza también sobre lotes ocupados o no comprobables y vuelve al comienzo al agotar la página final. Solo una operación de control SQL puede ejecutarse a la vez, compartida con la recuperación inmediata del handler.

`findJobs` busca el ID exacto, todos sus estados y dentro de la transacción de inspección. Un fallo de consulta o conexión se conserva como incertidumbre: no se transforma en ausencia.

| Estado comprobado                                        | Acción                                |
| -------------------------------------------------------- | ------------------------------------- |
| created, retry o active, con identidad correcta          | Conservar la oportunidad              |
| Job ausente o failed                                     | Sustituir si queda presupuesto        |
| cancelled                                                | Cerrar con `QUEUE_CANCELLED`          |
| completed sin resultado durable o identidad incompatible | Cerrar con `QUEUE_PROTOCOL_VIOLATION` |
| Política/esquema incompatibles                           | Cerrar con `SCHEMA_INCOMPATIBLE`      |
| Invariante conocida rota                                 | Cerrar con `INGESTION_INVARIANT`      |

Errores operativos no clasificados conservan `PROCESSING_UNCONFIRMED`. La traducción de errores solo inspecciona tipos propios y códigos SQLSTATE, recorriendo una cadena de causas acotada; no copia SQL, payloads o mensajes arbitrarios al broker. Su error serializable contiene mensaje fijo y código cerrado. El handler solo termina con éxito tras comprobar obsolescencia, nueva oportunidad confirmada o cierre confirmado; si el control está ocupado o falla, deja al broker y reconciliador resolver después.

## Cierre y respuesta HTTP

El agotamiento o un diagnóstico no recuperable conservan el prefijo clasificado. La posición causante queda `failed`; el sufijo sin habilitar queda `blocked` con `BLOCKED_BY_PREVIOUS_FAILURE`, generación y oportunidades cero. El lote pasa a `failed` con índice, diagnóstico y revisión en el mismo commit. Otros lotes pueden continuar.

Los fallos técnicos no incrementan `rejected`. `failedIndexes` incluye causante y sufijo, `pendingIndexes` queda vacío y `complete` permanece falso. Un POST que observa ese cierre devuelve 500 `INGESTION_PROCESSING_FAILED`; leer su recibo correctamente mediante GET devuelve 200 con el mismo estado. No existe un endpoint público de reintento o reset. Reiniciar API no reactiva un recibo terminal.

La migración `0002` amplía únicamente el CHECK de cierre técnico temprano a los cuatro códigos no recuperables. No inventa oportunidades para llegar a tres, no permite cierres tempranos por códigos recuperables/desconocidos y conserva las restricciones de presupuesto, metadatos e inmutabilidad. El upgrade desde las migraciones anteriores se verifica con cuenta/hash, dominio, recibos y jobs conservados.

## Recursos, confirmación y detención

`WriteTransactions` reserva un solo cliente para todas las sentencias de una transacción, incluidas las operaciones Drizzle/pg-boss. Devuelve el cliente al pool únicamente tras recibir confirmación de COMMIT. Ante cualquier error destruye ese cliente, evitando reutilizar un socket cuyo estado sea incierto; destruirlo no prueba si hubo commit. El trabajador posterior vuelve a consultar la verdad durable.

El pool de escritura sigue en seis conexiones: cuatro consumidores, una admisión y una operación de control. Consultas/sesiones/salud comparten cuatro, pg-boss cuatro y su listener una; outbox tiene reservada la restante del presupuesto de 16. Adquisición, bloqueo, sentencia y transacción conservan 2/1/5/10 segundos. `query_timeout` de cliente añade seis segundos por llamada, incluidos los clientes internos de la versión fijada de pg-boss. No sustituye el límite del servidor ni equivale a cancelar una transacción.

El cierre deja de iniciar pasadas, señala aborto y espera la operación acotada en curso; no espera dormido durante el backoff. La expiración del job activo sigue en 30 segundos. La recuperación después de una caída depende también de supervisión, polling y disponibilidad de la base: esas cifras no son una garantía de latencia final.

## Pruebas y procedencia

`tests/integration/recovery.test.mjs` ejecuta adaptadores contra PostgreSQL real sin otro consumidor: carreras de recuperadores, instantes exactos, pérdida de jobs durante espera, agotamiento, estados terminales, errores después de send/COMMIT, ACK perdido, consulta ilegible y páginas ocupadas. Los fixtures de capacidad comprueban las cinco cuotas agregadas, incluida reutilización al alcanzar el límite. Los estados retenidos generados por SQL son fixtures consistentes; no acreditan procesar 200.000 posiciones ni rendimiento productivo.

`tests/integration/recovery-http.test.mjs` usa API/proxy reales: fallo transitorio, fallo persistente junto a otro lote sano, caída con job activo y recuperación sin reenviar, SIGTERM con salida normal antes de 15 segundos y cuotas separadas de 1.200 GET/POST con rechazo de la siguiente. Los fallos SQL se introducen exclusivamente mediante DDL del PostgreSQL sintético; no hay flags de fallo en la aplicación. Cada suite elimina solo sus propios recursos. Los oráculos oficiales se ejecutan aparte, sin cambiar sus datos o resultados.

Fuentes: [transacciones de node-postgres](https://node-postgres.com/features/transactions), [liberación de clientes](https://node-postgres.com/apis/pool#releasing-clients) y [timeouts del cliente](https://node-postgres.com/apis/client) sustentan el uso de un cliente y descarte explícito. [Jobs](https://pgboss.io/api/jobs), [workers](https://pgboss.io/api/workers) y [adaptadores](https://pgboss.io/api/adapters) aportan las primitivas de biblioteca. El presupuesto, protocolo de sustitución, cursor justo, códigos y pruebas de confirmación incierta son adaptaciones de Nexo. [Verificación](verification.md) registra los resultados observados y sus límites.
