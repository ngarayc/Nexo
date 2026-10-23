# Verificador de datos del reproductor

La [issue #40](https://github.com/ngarayc/Nexo/issues/40) incorpora carga de fuentes, preparación y comparación del par oficial. Consume el [diario #38](replay-journal.md) y hechos del receptor; no emite, modifica, borra o repara telemetría. El [motor HTTP](replay-emitter.md) y el [panel Angular](replay-panel.md) componen esa verificación. Las pruebas del comparador, los controles y el recorrido visual conservan evidencias separadas en [verificación](verification.md).

## Fronteras

| Parte       | Código y función                                                                                                                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fuentes     | [LoadOfficialFixture](../apps/api/src/modules/demo/application/official-fixture.ts) verifica tres SHA-256 originales y deriva expectativas de los oráculos suministrados                                                   |
| Archivos    | [FileOfficialSources](../apps/api/src/modules/demo/adapters/files/official-sources.ts) admite exclusivamente tres nombres fijos; la imagen API los incluye sin configuración privada                                       |
| Hechos      | [PostgresReplayEvidence](../apps/api/src/modules/demo/adapters/postgres/replay-evidence.ts) obtiene datos, recibos, diario y trabajos de ingesta en una lectura coherente                                                  |
| Comparación | [VerifyOfficialReplay](../apps/api/src/modules/demo/application/verify-official.ts) produce preparación, informe e inspección actual; no escribe el informe                                                                |
| Contrato    | [Tipos de evidencia](../apps/api/src/modules/demo/application/verification.ts) separan hechos, comprobaciones y alcance externo                                                                                            |
| Contexto    | [Huella de código](../apps/api/src/modules/demo/adapters/files/replay-software.ts) y [perfil permitido](../apps/api/src/modules/demo/application/replay-material.ts) identifican material y configuración sin credenciales |

El cuerpo de cada envío futuro conserva literalmente la línea original dentro de un lote unitario. Los tipos/valores inválidos permanecen intactos. La línea del archivo es1–24; el índice dentro de cada petición es0. Una fuente ausente o alterada falla como indisponible; no se transforma en una lista vacía. El clasificador de la aplicación no se utiliza como oráculo de expectativas.

## Preparación y snapshot

La preparación exige servicios disponibles, hash de migración vigente, cuenta local compatible, dominio/recibos/intentos vacíos y ausencia de trabajo de ingesta pendiente o activo. Admite únicamente la propia ejecución en preparación sin envíos. La disponibilidad incluye una señal del coordinador; su composición en el motor se incorpora después.

El lector comparte el pool/turnos de lectura existentes y abre REPEATABLE READ READ ONLY con presupuesto de10segundos. Cuenta conjuntos completos y toma muestras acotadas del dominio, en lugar de descargar todo el historial retenido. No inspecciona el SQL interno del broker: usa findJobs de pg-boss con el adaptador Drizzle ligado al mismo cliente/transacción. Cuenta created/retry y active por separado; queued:true excluiría los activos y las estadísticas periódicas no constituyen una lectura fresca.

El inventario de trabajos lee hasta1.001: más de 1.000 se declara incompleto. El par contiene como máximo48recibos; se obtiene hasta49identidades para detectar una recepción adicional. Las muestras de dominio permiten20 eventos/8 vehículos/4 alertas/43mensajes más un testigo. Una muestra insuficiente queda no comprobable; no se interpreta como conjunto completo ni limita los GET de negocio. Los recibos propios comparan el cuerpo y fragmento JSON por igualdad SQL, sin transportar de nuevo payloads de hasta2MiB al comparador.

Una admisión concurrente puede confirmar durante la lectura: queda fuera del snapshot actual y aparece en el siguiente. No se congela la ingesta ni se cancela trabajo del receptor. Se verifica un entorno local controlado en un corte; no se prueba ausencia eterna de nuevas peticiones o autoría criptográfica de un ingestionId.

## Qué compara

| Comprobación                      | Primera                                | Segunda sin reset                           |
| --------------------------------- | -------------------------------------- | ------------------------------------------- |
| Resultados originales confirmados | 24:20aceptados/2duplicados/2rechazados | Otros24:0aceptados/22duplicados/2rechazados |
| Recepciones completas propias     | 24                                     | 48acumuladas                                |
| Dominio                           | 20 eventos/8 vehículos/4 alertas       | Los mismos datos                            |
| Mensajes lógicos                  | 43:20historial/19vehículo/4alerta      | Los mismos43; ninguno añadido               |

También compara cada línea/resultado/motivo con su recibo, la identidad del intento y el evento resuelto por la FK del recibo, contenido de todos los eventos, IDs aceptados, últimos eventos y estados, historial ascendente completo y las cuatro identidades de alerta. Así distingue el tardío E-001-00 del último E-001-02, y80sin alerta de81con alerta. Los recibos ajenos implican interferencia aunque solo dupliquen o rechacen y no cambien los conteos de dominio.

La segunda oficial requiere primera completa/conforme y vuelve a comprobar datos y contexto antes de comenzar. Su vínculo, escenario, fixture y conteos deben coincidir. Una ejecución parcial, exploratoria o tercera no recibe conformidad por reproducir tres números.

Las huellas de software incluyen los bytes/rutas del backend y contratos compilados, migraciones, lockfile y versión Node realmente presentes. El perfil de configuración enumera únicamente destino de base, origen público, modo demo, escucha y límites efectivos de ingesta. No serializa process.env ni incorpora claves, contraseñas o hashes de credenciales. La instancia estable del coordinador del motor y el informe previo permiten comprobar el contexto; una ejecución sin informe cuyo origen no pueda recuperarse queda no comprobable.

## Resultado e historia

Cada comprobación contiene clave, etiqueta, fuente, esperado, observado y estado: pending, matches, differs o unavailable. El informe conserva instante del snapshot, instante del intento, escenario/ejecución/revisión, hashes y contexto. Una diferencia comprobada produce non_conformant; sin diferencias, la evidencia pendiente o inaccesible produce inconclusive. Solo todas las comprobaciones coincidentes permiten conformant. Un fallo de lectura no inventa ceros ni expone su mensaje técnico.

El llamador conserva el informe mediante la operación cercada verify del diario; la comparación no hace una escritura implícita. Una vez cerrado se devuelve el documento original. Un informe ilegible o incompleto no se reconstruye como éxito. La inspección compara una huella de los hechos actuales y señala same, changed o unavailable por separado, sin reescribir el resultado histórico. Se excluye la mera revisión del diario de esa huella: guardar el informe no fabrica un cambio del receptor.

Un envío incierto no se suma como rechazado o aceptado. Resolver un recibo después no convierte retrospectivamente un recorrido inconcluso en un replay conforme. Trabajos pendientes, outbox sin drenar, origen desconocido o inventario incompleto impiden declarar conformidad.

El alcance es **datos y respuestas del par**. Dos clientes renderizados, pausa/reanudación y CI figuran not_assessed en este informe y requieren evidencia propia; no aparece una declaración de aprobación de toda la prueba técnica.

## Comprobación y procedencia

[Pruebas puras](../apps/api/src/modules/demo/application/verify-official.spec.ts) incluyen conteos con identidades/contenido incorrectos, incertidumbre, contexto alterado, muestras incompletas e historia inmutable. La [integración real](../tests/integration/replay-verification.test.mjs) ejecuta recepción/clasificación y diario contra PostgreSQL/pg-boss, contrasta los dos conjuntos controlados y provoca interferencia/carreras/inventario incompleto. Su [preparación](../tests/support/check-replay-verification.mjs) marca explícitamente la publicación sintética para el comparador: no afirma HTTP del motor, SSE emitido o dos navegadores renderizando. El recorrido integral de E3 conserva su comprobación propia.

[PostgreSQL18: REPEATABLE READ](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-REPEATABLE-READ) aporta el snapshot estable entre sentencias sin prohibir escrituras. [pg-boss: jobs](https://pgboss.io/api/jobs) y [adaptadores](https://pgboss.io/api/adapters) aportan inventario público y conexión transaccional. Nexo añade expectativas del fixture, límites explícitos, detección de recibos ajenos y separación entre informe histórico y estado actual. La prueba de concurrencia verifica que una nueva recepción y su job son invisibles juntos durante el primer corte y visibles juntos en el siguiente.
