# Diario durable del reproductor

La [issue #38](https://github.com/ngarayc/Nexo/issues/38) incorpora persistencia y operaciones del diario del emisor simulado. El [verificador #40](replay-verification.md) añade su comparación con los oráculos. El [motor HTTP](replay-emitter.md), los controles y el [panel](replay-panel.md) usan ese diario; el [reset](demo-reset.md) permanece como operación local explícita. El receptor conserva su cola y procesamiento independientes.

## Datos y relaciones

| Parte                            | Fuente                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Estados, partición y diagnóstico | [Reglas puras](../apps/api/src/modules/demo/domain/replay.ts)                                                        |
| Operaciones y vistas del diario  | [Puerto de aplicación](../apps/api/src/modules/demo/application/journal.ts)                                          |
| Transacciones, cercas y lecturas | [Adaptador PostgreSQL](../apps/api/src/modules/demo/adapters/postgres/journal.ts)                                    |
| Restricciones y triggers         | [Migración 0003](../apps/api/migrations/0003_replay_journal.sql)                                                     |
| Comprobaciones reales            | [Integración](../tests/integration/replay-journal.test.mjs) y [casos SQL](../tests/support/check-replay-journal.mjs) |

La migración 0003 añade únicamente replay_runs y replay_attempts: nueve tablas propias en total. Conserva las migraciones publicadas y el esquema de pg-boss separado.

| Tabla/campo            | Responsabilidad                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| replay_runs            | UUID de ejecución, escenario/anterior, instancia de origen, hash de fixture, intervalo, estado/cursor y revisión durable                           |
| Resultado de ejecución | Verificación e informe propios; completar 24 clasificaciones no significa conformidad automática                                                   |
| Resultado de escenario | Resultado/informe/cierre guardados en la primera ejecución, separados de su informe individual; no se reescribe el primero al cerrar el par        |
| Última intención       | commandId, instancia, revisión de control esperada y documento normalizado ≤4 KiB; permite consultar el cambio durable tras una respuesta incierta |
| replay_attempts        | FK a ejecución, línea 1–24, índice de lote 0, ingestionId único, identidad original del evento y desenlace confirmado o incierto                   |

scenarioId referencia la primera ejecución y previousRunId una ejecución anterior del mismo escenario/fixture. Solo existe un recorrido activo y un segundo oficial por escenario. Declarar la segunda etapa exige una primera completada/conforme; el verificador añade la lectura real de las condiciones del receptor antes de comenzar.

ingestionId se registra **antes** de enviar HTTP y puede no tener todavía recibo. Su relación con ingestion_batches es una correlación, sin FK inmediata. Un rechazo tampoco exige telemetry_events. La identidad del evento usa la misma representación binaria exacta del núcleo; NUL/sustitutos no se reparan al leer el diario.

## Confirmación y límites

PostgresReplayJournal recibe los pools y turnos de acceso; no crea otro pool o broker. Usa transacciones breves y un bloqueo asesor propio, distinto del de admisión de ingesta. No realiza HTTP ni conserva una conexión/exclusión esperando red.

1. Crear una ejecución reserva sus 24 posiciones dentro del máximo de 1.000 ejecuciones retenidas hasta reset. No es necesario precrear intentos que aún no se realizaron.
2. beginAttempt guarda línea/ingestionId antes de delegar al emisor HTTP. Solo admite la siguiente posición de una ejecución reproduciendo y una línea en curso.
3. resolveAttempt registra el desenlace y avanza cursor/revisión en la misma transacción. Las restricciones diferidas comprueban coherencia al COMMIT, incluso si un escritor intenta separar esas sentencias.
4. El resultado se devuelve después de confirmar. Si se pierde la confirmación, el método falla y el consumidor debe releer antes de autorizar otro efecto; el fallo no demuestra rollback. La coordinación del motor y los recibos de comandos aplican esa relectura mediante los [controles HTTP](replay-emitter.md).

Cada modificación exige la revisión durable esperada; dos coordinadores con conexiones independientes no ganan sobre la misma revisión. La capacidad, único activo y unicidad de intento también tienen protección SQL. Alcanzar el cupo impide crear ejecuciones, pero conserva lecturas y cierre/recuperación de las existentes.

El progreso deriva de intentos: clasificadas —aceptadas, duplicadas y rechazadas—, en curso, inciertas, fallo técnico y sin intentar suman24. No se reconstruye una respuesta original consultando después la existencia de un evento. La línea 24 confirmada completa el recorrido aunque se estuviera resolviendo una pausa.

## Evidencia y recuperación

Los diagnósticos permiten únicamente código cerrado, estado HTTP, admisión, revisión de recibo y booleanos conocidos. Se descartan datos ajenos y se señala su reducción; no se archivan headers, mensajes arbitrarios, claves o stacks. El documento por intento no supera 4 KiB y no altera su clasificación. La intención también tiene forma y tamaño acotados.

Los intentos finalizados y sus resultados no se reescriben. Consultar después el recibo puede aportar una observación adicional al operador, sin convertir un intento incierto en clasificación original. Los informes finalizados de ejecución/escenario son inmutables. El usuario de runtime carece de DELETE y de UPDATE sobre identidades/entrada del diario.

recover conserva recorridos terminales y marca cualquier ejecución no terminada —incluida pausada— como interrumpida/inconclusa; un intento en curso queda incierto. No programa trabajos o envíos. DemoRuntime compone esta operación al arrancar, antes de admitir controles. La recuperación del diario conserva incertidumbre y requiere una nueva intención explícita para emitir; sus pruebas de adaptador y composición se distinguen en verificación.

El [emisor #42](replay-emitter.md) amplía el puerto con cierre e informe en una misma transacción y confirmación de intención tras la barrera advisory existente. Las pruebas SQL pierden la respuesta antes/después de COMMIT y comprueban la espera real del bloqueo; una ausencia anterior no se interpreta como rollback.

## Lecturas y coste

Detalle y progreso usan REPEATABLE READ READ ONLY. El historial ordena por creación/UUID descendentes y pagina por clave: 20 por defecto, máximo 100. El cursor opaco está acotado/validado; conserva los seis decimales técnicos de PostgreSQL en lugar de redondearlos a milisegundos. Consultar una ejecución histórica no la reactiva.

El cupo conserva como máximo 24.000 intentos de diario, distinto de la retención de entradas del receptor. Comprobar capacidad recorre como máximo 1.000 ejecuciones bajo exclusión breve; el índice de historial resuelve su navegación y cada detalle contiene hasta 24 intentos. Es un límite de demo, sin promesa de capacidad productiva.

## Comprobaciones y procedencia

Las pruebas puras cubren partición/prefijo/intervalo y diagnóstico. PostgreSQL real comprueba FK/identidad/permisos, intención durable, respuesta+cursor indivisibles, rollback inducido, dos coordinadores, recuperación, historial con microsegundos y el límite exacto 1.000. El upgrade desde el esquema publicado 0002 conserva cuenta/hash/telemetría/proyección/alerta comparados en memoria y admite repetir preparación sin cambios. Los fixtures oficiales permanecen intactos.

Los estados/resultados de estos casos SQL son **sintéticos**: asignar clasificaciones o un informe controlado prueba el diario, sin acreditar 24 peticiones HTTP, conformidad oficial o una reproducción real. [Verificación](verification.md) identifica resultados ejecutados; motor, preparación/verificador y recorrido integral mantienen sus incrementos propios.

[PostgreSQL 18: restricciones](https://www.postgresql.org/docs/18/ddl-constraints.html) aporta PK/FK/CHECK/índices; [CREATE TRIGGER](https://www.postgresql.org/docs/18/sql-createtrigger.html) permite comprobar el conjunto al final de la transacción; [bloqueos asesores](https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS) coordina las operaciones breves. Nexo añade su máquina de estados, prefijo, marcador, cuotas y separación de verificación. No se atribuye atomicidad entre el diario y el futuro HTTP a esas herramientas.
