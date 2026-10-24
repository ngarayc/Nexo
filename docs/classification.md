# Clasificación transaccional — E1-I03

La [issue #17](https://github.com/ngarayc/Nexo/issues/17) conecta el consumidor de la cola con la clasificación de cada posición. El contrato y los oráculos suministrados siguen siendo la autoridad. El consumidor no depende de que el productor siga conectado y la espera HTTP no controla su avance. El [dashboard](dashboard.md) consume estos datos y [tiempo real](realtime.md) describe el despacho SSE; [recuperación](recovery.md) documenta el tratamiento de fallos de E1-I04.

## Fronteras y validación

[event.ts](../apps/api/src/modules/telemetry/domain/event.ts) valida el evento y compara su contenido; reexporta orden, estado y exceso de velocidad desde `@nexo/contracts`. La implementación de `isOverspeed` está en [event-fields.ts](../packages/contracts/src/event-fields.ts) y evalúa `speedKph > 80`. Estas reglas puras no dependen de Nest, PostgreSQL, pg-boss o HTTP. [ClassifyTelemetry](../apps/api/src/modules/telemetry/application/classify.ts) coordina puertos ligados a una misma transacción; [TelemetryTransaction](../apps/api/src/modules/telemetry/adapters/postgres/telemetry-transaction.ts) implementa sus escrituras SQL parametrizadas.

Cada posición debe ser un objeto. El motivo principal respeta este orden: eventId, vehicleId, observedAt, latitude, longitude, speedKph e ignitionOn. IDs exactos y no vacíos; calendario/zona válidos, números finitos con sus rangos y booleano real. No se convierten strings numéricos ni se repara el registro. Una posición inválida se clasifica como rechazada y permite continuar con la siguiente. La identidad, precisión temporal y JSON original reutilizan [la representación existente](persistence.md).

Se intenta insertar el evento usando la exclusión por igualdad completa y `ON CONFLICT ON CONSTRAINT ... DO NOTHING RETURNING`. Cuando no devuelve fila, una sentencia posterior lee el evento existente. Payload equivalente significa duplicado; contenido diferente, EVENT_ID_CONFLICT sin sobrescritura. La igualdad compara los siete campos, el instante exacto y los extras estructurales, incluidos números grandes. Un error técnico o una relectura imposible se propaga como fallo técnico.

PostgreSQL documenta la visibilidad por sentencia en [READ COMMITTED](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-READ-COMMITTED) y la alternativa [ON CONFLICT](https://www.postgresql.org/docs/18/sql-insert.html#SQL-ON-CONFLICT). Nexo las adapta mediante inserción, espera de unicidad y relectura separada; una lectura anterior no decide el conflicto. Las pruebas usan conexiones concurrentes y el rol runtime real.

## Proyección, alertas y mensajes

Para un vehículo nuevo se intenta insertar su proyección. Si ya existe, se bloquea la fila y después se vuelve a leer su evento vigente, en otra sentencia. Solo un mayor par `(instante exacto, eventId por puntos de código)` cambia latest. La clave interna bigint no decide orden temporal o de commit. El evento tardío permanece en el historial.

Un evento nuevo con speedKph >80 crea OVERSPEED aunque llegue tarde o tenga ignitionOn falso. Exactamente 80 no alerta. Cada evento puede producir telemetry.accepted, vehicle.updated si cambió latest y alert.created si creó una alerta. Duplicados, inválidos y conflictos no generan estos efectos.

[change-message.ts](../apps/api/src/modules/telemetry/application/change-message.ts) construye datos explícitos e inmutables del cambio: los siete campos del evento y el metadato observedAtOriginal cuando está disponible; estado adicional para vehicle.updated; tipo OVERSPEED adicional para alert.created. La envoltura contiene type, eventId, vehicleId, observedAt, messageId UUID v4 y schemaVersion 1. observedAt se representa en UTC conservando fracción exacta; el original se conserva en persistencia. No se copian extras arbitrarios.

Cada outbox guarda la envoltura y el tamaño UTF-8 de su trama SSE versión 1. La serialización comprueba UUID, tipo y versión; las identidades del productor solo aparecen dentro del JSON escapado. Los saltos de línea de un eventId no pueden convertirse en campos SSE. La unicidad por evento/tipo protege las identidades de los efectos. Crear una fila outbox todavía no acredita entrega al navegador; [tiempo real](realtime.md) explica el dispatcher E2 y los límites de la distribución local.

## Consumidor y continuación

[IngestionWorker](../apps/api/src/modules/ingestion/adapters/queue/ingestion-worker.ts) se registra después de iniciar la cola y antes de escuchar HTTP: batchSize 1, concurrencia local 4, polling base 0,5 s y respaldo de NOTIFY de 2 s. La política y cada publicación conservan retryLimit 0. La API [workers de pg-boss 12.38.0](https://pgboss.io/api/workers) describe la confirmación al resolver el handler. Nexo usa su propia transacción Drizzle y publica la continuación mediante fromDrizzle; mantiene el ACK posterior y los presupuestos separados de conexiones.

[ProcessItem](../apps/api/src/modules/ingestion/adapters/postgres/process-item.ts) ejecuta lo siguiente en una transacción acotada a 10 segundos:

1. Bloquea lote y después posición. Verifica lote activo, cursor, estado scheduled, generación, jobId y notBefore contra el reloj de PostgreSQL. Trabajo obsoleto no toca dominio o presupuesto.
2. Clasifica y confirma conjuntamente evento, latest, alerta, outbox y resultado de la posición.
3. Finaliza la posición actual antes de habilitar la siguiente. Reserva generación/oportunidad 1 y jobId nuevo para esa siguiente posición; su job pertenece al mismo commit.
4. Avanza cursor/revisión y completa el lote al terminar. Solo después del COMMIT confirmado retorna el handler para ACK.

Repetir el handler después de un commit encuentra cursor/estado actualizado y no reproduce efectos o continuación. Una excepción después de publicar el siguiente job revierte también ese job y todas las escrituras de la posición. Un ACK fallido no deshace un resultado ya confirmado. El error que recibe pg-boss es un código técnico fijo, sin SQL/payload; el recibo nunca convierte ese fallo en rechazo de dominio.

E1-I04 incorpora la [recuperación](recovery.md) de jobs fallidos/ausentes, incertidumbre de COMMIT, oportunidades 2/3, backoff y agotamiento. El handler y reconciliador releen la verdad durable antes de sustituir trabajo; una generación obsoleta no repite efectos. La garantía sigue sin ser entrega exactamente una vez.

## Verificación y costes

Las suites [classification](../tests/integration/classification.test.mjs), [processing](../tests/integration/processing.test.mjs) e [ingestion HTTP](../tests/integration/ingestion-http.test.mjs) distinguen dominio SQL, coordinación de una posición y consumidor/HTTP reales. Los casos manuales de reclamación usan un proceso de herramienta con el servidor detenido para que otro consumidor no reclame su fixture. Los oráculos también se ejecutan por HTTP con el servidor activo, en orden original y sin reset entre pasadas.

Los mensajes esperados son 43: 20 telemetry.accepted, 19 vehicle.updated y 4 alert.created. La segunda pasada no agrega efectos de dominio. Se comprueban también identidades de latest/alertas, estados, 80/81, tardíos, Unicode, IDs largos, colisiones de hash reales, extras grandes, carreras y rollback. [Verificación](verification.md) registra resultados y límites observados.

El coste es más sentencias y bloqueo breve por vehículo/lote. La serialización dentro de cada lote conserva su orden de llegada; lotes distintos pueden avanzar concurrentemente. No hay bloqueo global de clasificación ni conexión SQL retenida por la espera HTTP. Esto no es una medición de capacidad productiva para una flota real.
