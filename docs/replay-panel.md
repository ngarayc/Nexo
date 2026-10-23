# Panel compartido de la demo

El panel flotante de la [issue #49](https://github.com/ngarayc/Nexo/issues/49) está disponible en Flota y Alertas. Minimizarlo o cambiar de página conserva el motor de la API. Recargar recupera su estado; cerrar sesión cierra el acceso de ese navegador. Para detener nuevos envíos se utiliza Pausar o Finalizar verificación; después del cierre conservado, la misma acción se presenta como Detener reproducción. La acción independiente «Limpiar demostración» permite vaciar los datos sintéticos con confirmación; no ofrece edición o reenvío de registros.

## Recorrido

1. Iniciar sesión como demo y abrir el botón Reproductor. Recuperar control si no hay una lectura vigente.
2. Elegir un intervalo entero de 100 a 5.000 ms (750 por defecto). Iniciar comprueba que la base esté preparada y comunica los motivos si falla. La primera ejecución oficial requiere una base sintética limpia; el [comando de reset seguro](demo-reset.md) prepara ese destino local explícitamente.
3. Control muestra estado operativo y resultados confirmados de las 24 líneas. Aceptados, duplicados, rechazados, en curso, inciertos, fallos técnicos y sin intentar permanecen separados. Un despacho no incrementa resultados confirmados.
4. Pausar espera el envío previo; Reanudar continúa desde la línea siguiente. Reiniciar conserva la base y crea otro recorrido; solo el servidor puede identificarlo como segunda ejecución oficial.
5. Envíos muestra línea original, evento, resultado y motivo. La correlación conserva índice de lote 0, ingestionId y fechas Bogotá en 24 horas. Seleccionar una ejecución histórica no la reactiva.
6. Informe explica si el resultado coincide, qué se esperaba y cuál es el siguiente paso. Muestra los puntos que requieren atención y diferencia la falta de información de un fallo de datos. La primera espera 20 nuevos/2 duplicados/2 rechazados y la segunda 0/22/2; explica por qué esos duplicados y rechazos son esperados. Los valores exactos, fuentes y estados de auditoría siguen disponibles en «Detalles técnicos», cerrado al abrir. Preparación, pasada y resultado del par permanecen separados; terminar envíos no equivale a resultado correcto.

## Repetir después de finalizar

Finalizar guarda el resultado del escenario. Reiniciar reproducción permanece disponible y crea un recorrido exploratorio desde la primera línea, conservando la base, los informes anteriores y el cierre. Durante ese recorrido se puede pausar, reanudar, reiniciar o detener. No reabre ni vuelve a calificar el par oficial; se muestra explícitamente como exploratorio. Si el fixture ya está completo, la repetición clasifica 0 nuevos, 22 duplicados y 2 rechazados, sin nuevos efectos de dominio. Una nueva primera oficial requiere limpiar expresamente el destino, desde la interfaz o con el reset local.

## Estado y recuperación

`ReplayFacade` es el Presentation Model del panel; el componente presenta señales y transmite acciones. `ReplayApi` usa el HttpClient, interceptor de sesión/CSRF y presupuesto de respuesta existentes. Los DTO puros se comparten entre API y Angular en contracts. Los validadores del adaptador comprueban revisiones, identificadores, respuestas correlacionadas y la partición de 24 posiciones; no deciden aceptación de telemetría.

El EventSource existente incorpora demo.replay.updated. `LiveMonitor` conserva una generación y una sola recuperación de conexión; valida la época SSE sin confundirla con la instancia del motor. La fachada registra el manejador antes del GET y reemplaza vistas completas. Descarta respuestas de otra generación, revisiones anteriores y lecturas anteriores de la misma revisión. Nunca suma contadores al recibir un mensaje repetido.

Diez segundos sin un resumen verificado marcan desactualización y bloquean nuevas órdenes. Un heartbeat no renueva ese plazo. Recuperar control consulta el estado o utiliza la reconexión común; no agrega otro bucle de stream. Un cambio de instancia API descarta la navegación histórica anterior y conserva una explicación sobre la orden no repetida.

Cada intención explícita obtiene un commandId nuevo. Tras 202 se consulta su resolución; perder la respuesta conserva el ID y únicamente consulta su recibo, sin reenviar POST. Las consultas automáticas iniciales son acotadas y luego pueden continuar por actualizaciones SSE o acción explícita. Un recibo 404 no se interpreta como rechazo; las cuotas y Retry-After siguen el presupuesto común, incluido un plazo no finito. Cancelar la espera del navegador no cancela una operación admitida por la API.

## Accesibilidad y evidencia

Las acciones usan iconos locales con nombre accesible y tooltip al enfocar o pasar el puntero. Escape cierra la ayuda sin cambiar el foco. La barra de controles permanece al pie del panel aunque se desplace su contenido. Las pestañas usan flechas, Home/End y foco controlado. El panel se minimiza, limita su altura y permite desplazamiento en pantallas estrechas. Etiquetas, estados y resultados tienen texto; los datos se interpolan y los valores exactos se muestran como texto, sin innerHTML. La API key y el destino del productor permanecen exclusivamente en el servidor.

Las pruebas focalizadas cubren validación, transporte, generaciones, desactualización, incertidumbre de órdenes y presentación. [El recorrido de navegador](../tests/system/replay-panel.spec.mjs) usa el motor HTTP real y dos sesiones: pausa/reanudación compartidas, minimización/navegación, 20/2/2 y 0/22/2 sin reset intermedio, identidades de último estado y alertas, 43 mensajes de dominio, inspector, informes, historial, recarga, logout independiente y ancho de 360 px. No utiliza el productor directo de los tests para simular el motor.

[Motor y contratos](replay-emitter.md) detalla persistencia y errores; [verificación](verification.md) identifica las ejecuciones y sus límites. Reset seguro y demostración final E3 conservan sus incrementos propios.

## Limpiar demostración

La [issue #96](https://github.com/ngarayc/Nexo/issues/96) incorpora un icono de papelera separado de Reiniciar. Detener o completar la reproducción, esperar las ingestas y pulsar «Limpiar demostración». El diálogo explica el borrado irreversible de eventos, últimas posiciones, alertas, recibos y diario/informes. Cancelar conserva todo. Confirmar no genera respaldos; conserva la cuenta, contraseña, migraciones, fixtures y configuración.

`POST /api/demo/replay/reset` solo existe en modo demo y exige sesión, origen, CSRF, cuota, confirmación `CLEAR_DEMO`, instancia y versión de control actuales. No se permite durante una reproducción activa o una admisión pendiente. Se serializa con las escrituras durables, vacía las ocho tablas y los trabajos de `telemetry.ingest` en una sola transacción y renueva las generaciones del reproductor y SSE. Todos los navegadores abiertos recuperan snapshots; no se reutilizan mensajes de dominio anteriores. Una respuesta perdida se comprueba recuperando estado, nunca reenviando automáticamente el borrado.

La capacidad SQL se instala al preparar el modo demo: función fija `SECURITY DEFINER`, `search_path` limitado y permiso de ejecución solo para el usuario interno. El proceso HTTP sigue sin la credencial del propietario ni permisos generales de TRUNCATE/DDL. La operación admite una API por despliegue; una futura réplica exige coordinar también las barreras de admisión y publicación entre procesos.

Después de limpiar: cero vehículos y alertas, historial vacío y acción Iniciar. La primera completa debe clasificar 20/2/2; Reiniciar sin limpiar debe clasificar 0/22/2. No limpiar entre las dos pasadas del par oficial. No se cambia el orden ni el contenido de los fixtures.

La simplificación del informe se sigue en la [issue #97](https://github.com/ngarayc/Nexo/issues/97). La presentación conserva el resultado original del servidor y no recalifica datos ni oculta diferencias. Los mensajes distinguen informe histórico, comparación actual no disponible y comprobación todavía pendiente.
