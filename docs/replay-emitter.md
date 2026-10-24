# Emisor HTTP del reproductor

La [issue #42](https://github.com/ngarayc/Nexo/issues/42) compone un único motor compartido en NestJS, controles HTTP protegidos, diario y verificador del par oficial. Angular transmite intenciones y observa el estado; la API conserva fixture, destino y clave. El [panel](replay-panel.md), la limpieza confirmada y la [demostración integral](demo-guide.md) en dos navegadores completan este motor.

## Fronteras y garantías

`LoopbackReplayProducer` recibe una línea original y una identidad de ingesta. Hace un único POST a `127.0.0.1`, en el puerto efectivo de la API y con ruta fija `/api/events/batch`. El cuerpo permanece literal; no repara ni vuelve a serializar los registros. La API key se conserva en un campo privado del adaptador y nunca forma parte del comando o de sus resultados. No se aceptan destinos, cabeceras o rutas del cliente.

La petición prohíbe redirecciones y tiene un plazo de 65 segundos, superior al presupuesto de respuesta de 60 segundos del receptor. Su respuesta admite como máximo 16 KiB de JSON UTF-8. Para confirmar una clasificación unitaria comprueba identidad, índice, contadores, estado completo y coherencia de resultados y errores. Una clasificación de rechazo debe provenir de una respuesta final verificable del receptor. Los oráculos no determinan la clasificación del emisor.

Una respuesta pendiente, ilegible o perdida conserva incertidumbre; un fallo técnico no se suma a rechazados. El adaptador nunca reenvía ni consulta un recibo para reconstruir retrospectivamente el resultado. El receptor puede haber admitido y completado el trabajo aunque su respuesta se pierda. Los diagnósticos solo contienen códigos y campos técnicos permitidos, sin cuerpos, cabeceras, excepciones o secretos.

`ReplayEmitter` organiza un temporizador y una sola petición pendiente. Antes de enviar exige que su puerto de diario confirme un intento; después espera que confirme resultado y cursor. El intervalo para la siguiente línea comienza tras esa confirmación, sin recuperar tiempo con ráfagas. Pausar inhibe el siguiente despacho y deja resolver el ya autorizado. Un fallo del diario bloquea los envíos y no acredita rollback. El cierre permanente aborta únicamente el transporte del emisor; no cancela trabajos del receptor.

El coordinador integra el puerto del emisor con el [diario persistente](replay-journal.md). No se conserva una transacción ni un bloqueo de control durante HTTP. Las pruebas de temporización usan respuestas y confirmaciones pendientes para comprobar estas fronteras; por sí solas no acreditan el coordinador completo.

## Intenciones y persistencia

El parser de comandos admite únicamente la forma y acciones previstas, UUID v4, revisiones enteras seguras e intervalos enteros entre 100 y 5.000 ms. No convierte cadenas a números. La caché conserva hasta 1.024 admisiones durante 10 minutos desde su admisión y fija las pendientes hasta resolverlas. Una repetición de la misma intención devuelve su admisión; reutilizar su ID con otro contenido produce conflicto. El resultado posterior no modifica la admisión original.

El diario incorpora dos operaciones necesarias para la composición:

- Un cierre detenido, interrumpido o con error puede guardar su informe inconcluso o no conforme en la misma transacción que el estado y el intento. Un informe cerrado permanece inmutable.
- La confirmación de una intención adquiere el mismo advisory lock del escritor antes de leer su marcador, bajo READ COMMITTED. Así espera el commit o rollback anterior. Una lectura previa sin fila no demuestra que una creación concurrente haya fallado. Si no puede determinarse el resultado, devuelve desconocido o falla; no autoriza otro envío.

Se conserva la migración publicada y sus restricciones. No se introduce una tabla adicional ni se debilita la coherencia entre intentos y cursor.

## Verificación y límites

Las pruebas unitarias cubren entradas, admisiones, respuestas, temporización, pausa, transporte y bloqueo ante fallos del diario. La integración del diario pierde deliberadamente la respuesta antes y después de COMMIT, comprueba la espera real sobre un bloqueo SQL y verifica el cierre atómico e inmutable.

La [integración del adaptador](../tests/integration/replay-producer.test.mjs) envía las 24 líneas dos veces a la API real, conservando también duplicados e inválidos. Comprueba 20/2/2 y 0/22/2, los 48 documentos originales en sus recibos y dominio 20 eventos / 8 vehículos / 4 alertas / 43 mensajes. Otro caso pierde una respuesta después del procesamiento real y comprueba un solo envío, efecto persistido e incertidumbre; también verifica que una clave incorrecta no admita trabajo.

Este recorrido del adaptador no aplica el intervalo visual ni usa controles de navegador. La verificación integral del motor y de los dos clientes renderizados se registra cuando esos componentes estén incorporados.

La separación entre aceptación y finalización sigue [RFC 9110, 202 Accepted](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.3). La barrera de confirmación utiliza [los bloqueos advisory transaccionales de PostgreSQL](https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS) y una lectura posterior en [READ COMMITTED](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-READ-COMMITTED). Nexo añade el marcador concreto, el límite de retención y la política de detenerse sin repetir envíos ante incertidumbre.

## Composición y controles

`DemoRuntime` carga las fuentes y calcula las huellas del material ejecutable y la configuración efectiva permitida. El perfil no contiene secretos. `PostgresReplayEvidence` contrasta además migración, cuenta y estado de la cola mediante SQL/API pública. Modo demo deshabilitado devuelve 404 y no carga fixture/huellas ni construye el motor. Habilitado, recupera el diario antes de escuchar HTTP; nunca reanuda envíos al arrancar. La identidad del control se conserva durante la operación ordinaria y es distinta de la época SSE. La limpieza confirmada renueva ambas e invalida intenciones anteriores.

Recepción y Demo importan `ProcessingModule`: comparten un `WriteDatabase` de seis conexiones y la misma `QueueConnection`. Un turno de escritura limitado se comparte entre diario y recuperación; el actor tiene otra exclusión corta en memoria y no adquiere dos veces el mismo turno. No se agrega pool o broker de producto. HTTP del emisor y las esperas entre líneas quedan fuera de esas secciones.

`POST /api/demo/replay/commands` exige modo demo, sesión, Origin, CSRF y cuota compartida de 60/min antes de leer JSON UTF-8 de hasta 4 KiB. Solo acepta commandId, instanceId, expectedControlVersion, runId, action e intervalo cuando corresponde. La clave de ingesta no sustituye la sesión. Un 202 confirma intención durable; el recibo distingue resolución pendiente, completada y fallida. Una confirmación incierta devuelve503 y bloquea nuevas mutaciones/despachos hasta resolver el marcador con la barrera SQL; no se repite la mutación para averiguar su resultado.

| Acción             | Resultado                                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| start              | Comprueba preparación, crea primera ejecución y vuelve a comprobar antes de emitir                                                                                    |
| pause              | Inhibe siguiente línea, espera HTTP previo y confirma paused; última línea clasificada conserva completed                                                             |
| resume             | Solo pausa normal de la instancia actual; espera intervalo y continúa sin repetir                                                                                     |
| restart            | Conserva parcial anterior detenido/inconcluso; otro UUID desde línea 1. Segunda oficial solo tras primero completo/conforme y nueva preparación; tercero exploratorio |
| finishVerification | Espera envío previo, conserva informe individual y cierra el escenario en su raíz sin borrar datos o cancelar receptor                                                |

`controlVersion` avanza por admisiones/estados/acciones; `viewRevision` también por progreso durable. Una línea ordinaria no invalida los botones de otro cliente. Repetir el mismo comando conservado no repite efectos; cambiar su cuerpo produce 409. La caché limita1.024 recibos / 10 min desde admisión y conserva los pendientes fijados. Recibo ausente no demuestra que la intención no se admitiera; una revisión antigua tampoco habilita otra ejecución tras expirar.

El cierre del escenario mantiene su informe separado de los individuales. Si su COMMIT pierde respuesta, se conserva el documento objetivo y se confirma tras la barrera: coincidencia exacta resuelve el cierre, raíz todavía pendiente acredita no aplicación y otro resultado permanece desconocido. No se sobrescribe un informe para hacer coincidir contadores. Un fallo del diario detiene; si se confirma que una clasificación sí quedó durable, la conserva, pero no continúa automáticamente. Un intento sin resultado confirmado queda incierto aunque el receptor haya terminado.

## Consultas y progreso compartido

`GET /api/demo/replay` requiere sesión, cuota de lectura y no-store. Los selectores son excluyentes; mezclas, parámetros repetidos, tipos o claves no admitidas devuelven 400.

| Consulta                        | Respuesta                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Sin parámetros                  | Control actual: instancia/revisiones, acciones, pendingAction, bloqueo, escenario y progreso          |
| ?runId=UUID                     | Resumen, hasta 24intentos, informe individual/inspección e informe separado de escenario              |
| ?view=history&limit=20&cursor=… | Página descendente por creación/UUID;20 por defecto, máximo 100, cursor opaco acotado a 512caracteres |
| ?commandId=UUID&instanceId=UUID | Admisión y resolución;404 si no se conserva y409 si la instancia difiere                              |

El historial no reactiva ejecuciones. El detalle omite intención, documentos HTTP originales, cabeceras y credenciales; muestra correlación ingestionId, línea 1–24 e índice de lote0. Los diagnósticos contienen solo campos permitidos y no reclasifican resultados originales. El informe guardado conserva su snapshot; la inspección distingue estado actual igual, cambiado o no disponible.

`demo.replay.updated` usa la conexión SSE existente y sus mismos límites de sesiones, mensajes y bytes. Publica una representación completa tras cambios durables y cada 2 s con suscriptores, mediante una lectura compartida y fresca. No crea mensajes de dominio/outbox ni un stream por componente. Lectura fallida no publica una copia antigua con fecha nueva. `streamInstanceId` pertenece a la época SSE; el instanceId del control identifica al coordinador activo y también se renueva después de limpiar la demo. Recargar, cerrar sesión o desconectar un navegador no cancela una reproducción admitida.

## Evidencia de integración del motor

[Control real](../tests/integration/replay-control.test.mjs) prueba dos recorridos con HTTP/cola/PostgreSQL, pausa/reanudación, dos órdenes concurrentes, informes individuales conservados, cierre de escenario, historial y dos streamsHTTP Node. Verifica20/2/2→0/22/2,20eventos/8vehículos/4alertas/43mensajes/48recibos. También comprueba reinicio parcial exploratorio y reinicio de API con pausa interrumpida, sin reanudación automática. Los streams Node no acreditan renderizado Angular.

[Fallos del actor](../tests/integration/replay-control-faults.test.mjs) intercepta exclusivamente el cliente de prueba de PostgreSQL antes/después deCOMMIT real, incluyendo confirmación de barrera perdida. Comprueba ausencia deHTTP antes de admisión conocida, rollback sin recibo falso, clasificación durable conservada, intento incierto sin reconstrucción desde el receptor y cierre sin reescribir informe. La respuestaHTTP perdida después del procesamiento real detiene sin reenvío. El producto no expone rutas/hooks de fallo. Las pruebas HTTP unitarias conservan sesión, CSRF, cuotas y parser reales; sus dobles del motor no se presentan como evidencia SQL.
