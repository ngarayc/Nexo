# Admisión durable — base de E1-I02

La base de la [issue #14](https://github.com/ngarayc/Nexo/issues/14) prepara pg-boss y los adaptadores SQL de admisión/recibos. **Todavía no publica las rutas HTTP de ingesta ni ejecuta un consumidor.** Los casos nativos invocan estos adaptadores directamente; una recepción pendiente no se presenta como una clasificación terminada. La pantalla conserva el acceso inicial de E0.

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

Estas cantidades son elecciones de Nexo. No garantizan tiempo de finalización. Las tablas propias conservan entrada/resultados hasta reset; limpiar un job no elimina un recibo. La recuperación acotada de generaciones y tres oportunidades se completa con los consumidores y el reconciliador posteriores. No se utiliza el contador de jobs como contador de eventos.

`platform/queue/prepare.ts` usa el propietario; `policy.ts` distingue esa preparación de una instancia runtime con `migrate: false`, `createSchema: false`, pool máximo 4 y listener dedicado. Los tests ejecutan esa instancia con `nexo_app`, sin CREATE en el esquema. Puede leer/escribir/eliminar los objetos internos de la biblioteca y ejecutar sus funciones; los permisos de las tablas de dominio continúan separados. Esto no concede DDL o borrado de eventos/recibos al runtime.

Fuentes: [instalación](https://pgboss.io/install), [constructor](https://pgboss.io/api/constructor), [opciones de jobs](https://pgboss.io/api/jobs). El coste de compartir PostgreSQL es coordinar migraciones, permisos, mantenimiento y conexiones con las operaciones de dominio; no se afirma aislamiento de recursos entre ambas cargas.

## Sobre, identidad y capacidad

`modules/ingestion/domain/batch.ts` valida el sobre estricto y conserva posiciones originales mediante [OriginalJson](persistence.md). Admite hasta 1.000 posiciones y 2 MiB de cuerpo. Un JSON legible puede contener posiciones inválidas; su validación de dominio se hace después. Los límites son independientes y se comprueban en el valor exacto y con uno adicional. La clave opcional de recepción debe ser UUID v4; su representación canónica no modifica los IDs de eventos o vehículos.

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

El pool compartido de consultas/sesiones/salud tiene máximo 4 conexiones. `DatabaseSlots` limita operaciones admitidas y espera, además del tamaño del pool: una espera vencida se retira y no ejecuta luego su operación. Los adaptadores de ingesta reciben ese mismo presupuesto de lectura. Para admisión se reserva un turno de escritura, hasta 15 esperando y adquisición de dos segundos; las transacciones usan límite total PostgreSQL de 10 segundos, además de lock/sentencia de 1/5 segundos. Los pools de escritura, biblioteca, outbox y listener se compondrán con sus consumidores respetando el total previsto de 16 conexiones runtime.

## Evidencia y siguiente límite

La suite nativa comprueba esquema/política, publicación/reclamación/confirmación con permisos runtime y rollback mediante el adaptador real. Añade admisión original/recibo pendiente, carrera de la misma identidad, equivalencias decimales/conflictos, fallo después del send y competencia por la última plaza activa. Las pruebas del sobre y de los turnos SQL conservan límites exactos y vencimiento sin ejecución tardía. [Verificación](verification.md) registra conteos y candidatos; los fixtures de cuota son sintéticos y separados de la demo oficial.

Faltan la canalización API key → parser, cuotas HTTP y proxy, rutas de consulta, respuesta de espera y composición runtime de ingesta. Después se incorporan clasificación, recuperación, consultas del dominio y sus oráculos. Esta base no acredita todavía ninguno de esos criterios completos.
