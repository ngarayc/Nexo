# Panel compartido de la demo

El panel flotante de la [issue #49](https://github.com/ngarayc/Nexo/issues/49) está disponible en Flota y Alertas. Minimizarlo o cambiar de página conserva el motor de la API. Recargar recupera su estado; cerrar sesión cierra el acceso de ese navegador. Para detener nuevos envíos se utiliza Pausar o Finalizar verificación. El panel no borra datos ni ofrece edición o reenvío de registros.

## Recorrido

1. Iniciar sesión como demo y abrir el botón Reproductor. Recuperar control si no hay una lectura vigente.
2. Elegir un intervalo entero de 100 a 5.000 ms (750 por defecto). Iniciar comprueba que la base esté preparada y comunica los motivos si falla. La primera ejecución oficial requiere una base sintética limpia; el [comando de reset seguro](demo-reset.md) prepara ese destino local explícitamente.
3. Control muestra estado operativo y resultados confirmados de las 24 líneas. Aceptados, duplicados, rechazados, en curso, inciertos, fallos técnicos y sin intentar permanecen separados. Un despacho no incrementa resultados confirmados.
4. Pausar espera el envío previo; Reanudar continúa desde la línea siguiente. Reiniciar conserva la base y crea otro recorrido; solo el servidor puede identificarlo como segunda ejecución oficial.
5. Envíos muestra línea original, evento, resultado y motivo. La correlación conserva índice de lote 0, ingestionId y fechas Bogotá en 24 horas. Seleccionar una ejecución histórica no la reactiva.
6. Verificación separa preparación, informe individual conservado y cierre del escenario. Cada comprobación tiene esperado, observado, fuente y Coincide/Difiere/Pendiente/No se pudo comprobar. Los valores complejos se resumen y ofrecen detalle textual; el recorte de pantalla se indica explícitamente. Recorrido completado no equivale a conforme.

## Estado y recuperación

`ReplayFacade` es el Presentation Model del panel; el componente presenta señales y transmite acciones. `ReplayApi` usa el HttpClient, interceptor de sesión/CSRF y presupuesto de respuesta existentes. Los DTO puros se comparten entre API y Angular en contracts. Los validadores del adaptador comprueban revisiones, identificadores, respuestas correlacionadas y la partición de 24 posiciones; no deciden aceptación de telemetría.

El EventSource existente incorpora demo.replay.updated. `LiveMonitor` conserva una generación y una sola recuperación de conexión; valida la época SSE sin confundirla con la instancia del motor. La fachada registra el manejador antes del GET y reemplaza vistas completas. Descarta respuestas de otra generación, revisiones anteriores y lecturas anteriores de la misma revisión. Nunca suma contadores al recibir un mensaje repetido.

Diez segundos sin un resumen verificado marcan desactualización y bloquean nuevas órdenes. Un heartbeat no renueva ese plazo. Recuperar control consulta el estado o utiliza la reconexión común; no agrega otro bucle de stream. Un cambio de instancia API descarta la navegación histórica anterior y conserva una explicación sobre la orden no repetida.

Cada intención explícita obtiene un commandId nuevo. Tras 202 se consulta su resolución; perder la respuesta conserva el ID y únicamente consulta su recibo, sin reenviar POST. Las consultas automáticas iniciales son acotadas y luego pueden continuar por actualizaciones SSE o acción explícita. Un recibo 404 no se interpreta como rechazo; las cuotas y Retry-After siguen el presupuesto común, incluido un plazo no finito. Cancelar la espera del navegador no cancela una operación admitida por la API.

## Accesibilidad y evidencia

Las pestañas usan flechas, Home/End y foco controlado. El panel se minimiza, limita su altura y permite desplazamiento en pantallas estrechas. Etiquetas, estados y resultados tienen texto; los datos se interpolan y los valores exactos se muestran como texto, sin innerHTML. La API key y el destino del productor permanecen exclusivamente en el servidor.

Las pruebas focalizadas cubren validación, transporte, generaciones, desactualización, incertidumbre de órdenes y presentación. [El recorrido de navegador](../tests/system/replay-panel.spec.mjs) usa el motor HTTP real y dos sesiones: pausa/reanudación compartidas, minimización/navegación, 20/2/2 y 0/22/2 sin reset intermedio, identidades de último estado y alertas, 43 mensajes de dominio, inspector, informes, historial, recarga, logout independiente y ancho de 360 px. No utiliza el productor directo de los tests para simular el motor.

[Motor y contratos](replay-emitter.md) detalla persistencia y errores; [verificación](verification.md) identifica las ejecuciones y sus límites. Reset seguro y demostración final E3 conservan sus incrementos propios.
