# Emisor HTTP del reproductor

La [issue #42](https://github.com/ngarayc/Nexo/issues/42) incorpora componentes del emisor y del control idempotente. Este incremento todavía no registra un motor en NestJS, rutas de control ni un panel Angular. La demostración controlable sigue pendiente de esa composición; las pruebas descritas aquí acreditan cada componente y su comunicación con el receptor.

## Fronteras y garantías

`LoopbackReplayProducer` recibe una línea original y una identidad de ingesta. Hace un único POST a `127.0.0.1`, en el puerto efectivo de la API y con ruta fija `/api/events/batch`. El cuerpo permanece literal; no repara ni vuelve a serializar los registros. La API key se conserva en un campo privado del adaptador y nunca forma parte del comando o de sus resultados. No se aceptan destinos, cabeceras o rutas del cliente.

La petición prohíbe redirecciones y tiene un plazo de 65 segundos, superior al presupuesto de respuesta de 60 segundos del receptor. Su respuesta admite como máximo 16 KiB de JSON UTF-8. Para confirmar una clasificación unitaria comprueba identidad, índice, contadores, estado completo y coherencia de resultados y errores. Una clasificación de rechazo debe provenir de una respuesta final verificable del receptor. Los oráculos no determinan la clasificación del emisor.

Una respuesta pendiente, ilegible o perdida conserva incertidumbre; un fallo técnico no se suma a rechazados. El adaptador nunca reenvía ni consulta un recibo para reconstruir retrospectivamente el resultado. El receptor puede haber admitido y completado el trabajo aunque su respuesta se pierda. Los diagnósticos solo contienen códigos y campos técnicos permitidos, sin cuerpos, cabeceras, excepciones o secretos.

`ReplayEmitter` organiza un temporizador y una sola petición pendiente. Antes de enviar exige que su puerto de diario confirme un intento; después espera que confirme resultado y cursor. El intervalo para la siguiente línea comienza tras esa confirmación, sin recuperar tiempo con ráfagas. Pausar inhibe el siguiente despacho y deja resolver el ya autorizado. Un fallo del diario bloquea los envíos y no acredita rollback. El cierre permanente aborta únicamente el transporte del emisor; no cancela trabajos del receptor.

El puerto del emisor permite componer posteriormente la coordinación corta del motor con el [diario persistente](replay-journal.md). No se conserva una transacción ni un bloqueo de control durante HTTP. Las pruebas de temporización usan respuestas y confirmaciones pendientes para comprobar estas fronteras; por sí solas no acreditan el coordinador completo.

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
