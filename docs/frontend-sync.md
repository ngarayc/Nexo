# Sincronización de Angular

La [issue #28](https://github.com/ngarayc/Nexo/issues/28) conecta Angular al [snapshot](queries.md) y al [stream SSE](realtime.md) protegidos. La pantalla muestra conexión, última base confirmada y totales de vehículos/alertas. [Flota, historial y alertas](dashboard.md) presentan las colecciones mantenidas por esa coordinación. El reproductor E3 y el filtro CR-01 conservan sus incrementos.

## Responsabilidades y reglas compartidas

`features/live-monitoring/LiveMonitor` coordina una conexión por aplicación autenticada. `platform/telemetry` contiene adaptadores HTTP/EventSource, validación de respuestas, presupuesto de capturas y caché de mensajes. FleetFacade posee los vehículos; AlertsFacade posee las alertas; VehicleDetailFacade posee únicamente el historial seleccionado. Los componentes presentan señales y envían intenciones, sin llamadas HTTP o reglas de ingesta.

El workspace `packages/contracts`, @nexo/contracts, comparte DTO públicos y funciones puras de identidad, validación, instante exacto, orden, estado y umbral. API y navegador importan el mismo núcleo sin importar implementaciones entre aplicaciones. No depende de Nest, Angular o Node; el chequeo de fronteras recorre también este paquete. Temporal conserva su versión previamente fijada. Compilar una aplicación o sus pruebas compila antes el núcleo; ambas imágenes lo incluyen y el runtime API conserva el módulo y su manifiesto.

La flota se reemplaza con cada base coherente y después conserva el máximo por instante exacto/eventId. La comparación no usa Date, milisegundos, llegada o localeCompare. Alertas usan eventId y nunca se fabrican en la UI a partir de velocidades. Totales/resumen se derivan de colecciones únicas. La búsqueda literal local no sustituye la colección completa. Las fechas visuales se presentan en español, Bogotá y hora 00–23; esa etiqueta no participa del orden.

Los codecs validan JSON, versión, forma, campos, estado, identidades, totales y coincidencia de sobre/datos antes de admitir una respuesta o trama. Las vistas validadas son inmutables. Una respuesta incompatible es un error de sincronización; un cuerpo ilegible o un fallo de red no se transforma en colección vacía confirmada.

## Base y cambios sin huecos

1. Con sesión vigente, abrir EventSource del mismo origen y esperar stream.ready.
2. Registrar captura antes de suscribir HTTP de snapshot y acumular cambios mientras responde.
3. Comprobar instancia, versión, generación local, acceso vigente y conexión abierta. Instalar flota/alertas y drenar la captura en el mismo turno JavaScript.
4. Aplicar cambios posteriores directamente. Repeticiones no incrementan colecciones; tardíos pueden añadir historial/alerta sin hacer retroceder latest.

Invalidar una generación cancela solicitudes y capturas. Aunque una respuesta cancelada llegue tarde, su generación impide instalarla. Una base recuperada reemplaza entidades antiguas, también si ahora está vacía. Los tres mensajes de una transacción pueden llegar por separado: se garantiza convergencia, no un fotograma atómico del grupo.

La caché LRU conserva los últimos 5.000 messageId y se limpia al invalidar. Es una optimización: identidad y orden exacto conservan la corrección después de expulsar un UUID. UUID no constituye un cursor ordenado o ACK del navegador.

## Presupuesto e historial

CaptureBudget permite hasta 1.000 mensajes y 2 MiB de tramas UTF-8 completas retenidas por aplicación. Las capturas comparten referencias; una trama necesaria para ambas se cuenta una vez. Cancelar libera su participación; un exceso invalida todas las capturas y fuerza recuperación, sin truncar o aplicar silenciosamente un buffer parcial.

El detalle tiene una selección activa. Captura telemetry.accepted del vehículo antes de HTTP, combina por eventId y orden ascendente exacto, e inserta tardíos en su lugar. Cambiar/cerrar selección aborta HTTP y descarta respuestas antiguas. Un corte conserva datos anteriores pendientes y recarga historial después de la nueva base global. Revocar sesión limpia también la selección.

El adaptador usa GET codificado si la ruta no supera 4.096 caracteres ASCII y el ID no contiene NUL, cuyo escape %00 rechaza NGINX. Un ID largo, con NUL, una unidad sustituta aislada o que cambie al interpretarse como URL (por ejemplo `.` o `..`) usa el POST JSON complementario, con el interceptor CSRF del mismo origen. Ambas variantes comparten captura/cancelación y comprueban el vehículo exacto. Un fallo de detalle no borra flota ni abre otro stream.

## Recuperación y sesión

Ready tiene plazo de diez segundos; cuarenta y cinco segundos sin mensajes válidos invalidan la conexión. Al regresar por online, pageshow o visibilitychange se comprueban acceso, transporte y silencio; el reloj de pared permite detectar suspensión del equipo. Un heartbeat mantiene actividad, pero no cambia la fecha de la última base confirmada.

Antes de delegar un fallo, el adaptador cierra EventSource y retira listeners: la reconexión nativa no compite con el coordinador. Hay cinco reintentos con bases 2/4/8/16/30 segundos, jitter hasta 25 % y máximo de treinta segundos por espera propia. Treinta segundos saludables o Reconectar reinician el presupuesto. Retry-After confirmado por HTTP impone una espera mínima, incluso superior a treinta segundos y al pulsar Reconectar. Un valor fuera de la capacidad segura del temporizador no inicia un ciclo inmediato.

El error de EventSource no revela el estado HTTP. Antes de reabrir se verifica sesión por HTTP; SESSION_REQUIRED confirmado o el vencimiento absoluto retiran acceso. Épocas y generaciones protegen frente a errores antiguos. Si otra pestaña regenera la cookie HttpOnly, un token CSRF sincronizado diferente identifica el nuevo ámbito y limpia datos/callbacks anteriores sin leer SID.

La UI distingue primera carga, en vivo, reconexión con datos posiblemente desactualizados y error final con Reconectar. Los totales solo aparecen al confirmar una base. Dominio y token CSRF de Angular permanecen en memoria, sin localStorage/sessionStorage. La cookie HttpOnly mantiene el acceso según [sesiones](access.md); la API key continúa únicamente en productor/servidor.

## Verificación, coste y procedencia

Las pruebas controlan mensajes durante snapshot/consulta, respuestas de otra selección/generación, tardíos/empates, cancelación, presupuesto global, cinco retries, silencio, suspensión y sesión. El recorrido de sistema alimenta HTTP desde un productor Node del runner: usa la clave dentro del contenedor API; Angular no la recibe. Solo la referencia efímera al stack sintético llega al proceso Node. [Verificación](verification.md) registra resultados efectivos y candidatos.

[Angular Signals](https://angular.dev/guide/signals) aporta señales de solo lectura y derivaciones calculadas. Nexo añade fachadas propietarias, vistas inmutables y coordinación de ciclo de vida. [HTML EventSource](https://html.spec.whatwg.org/multipage/server-sent-events.html#the-eventsource-interface) define eventos tipados, estados y close; snapshot, generaciones, presupuesto y backoff son decisiones propias de Nexo. Las funciones puras compartidas evitan divergencia de reglas entre servidor y navegador.

El coste es descargar colecciones completas al recuperar y mantener índices en memoria. computed difiere ordenaciones hasta que un consumidor las consulta tras cambios. Los límites de captura no limitan el historial durable o tamaño total del snapshot; HTTP materializa respuestas completas. No se acredita capacidad productiva para miles de vehículos.

La [issue #35](https://github.com/ngarayc/Nexo/issues/35) añade recorridos con dos contextos independientes. Observan EventSource nativo sin sustituir respuestas: comparan los 43 UUID, los resultados oficiales, las ocho proyecciones y los veinte eventos del historial. Las carreras retienen respuestas de snapshot/historial obtenidas de la API real mientras llegan commits por SSE; seleccionar B cancela la consulta anterior de A. Las pruebas unitarias complementan ese caso entregando respuestas antiguas incluso si ignoran la cancelación.

El corte individual usa un intermediario HTTP de prueba, solo en loopback y para el SSE de un cliente: conserva las tramas reales y destruye sus sockets. El otro cliente continúa directamente por NGINX. Una falla SQL de marcado de outbox degrada ambas conexiones mientras la ingesta sigue admitiendo; retirar el trigger permite recuperar la vista desde persistencia. Ninguno de estos controles se incorpora al producto. [Verificación](verification.md) distingue los resultados ejecutados y sus candidatos.
