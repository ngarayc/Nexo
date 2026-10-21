# Arquitectura

## Estado inicial

El borrador de E0-I01 contiene dos aplicaciones de un workspace npm: API NestJS/TypeScript ESM y frontend Angular standalone. La API compone controlador y servicio mediante inyección; Angular presenta una pantalla inicial mediante el router. La configuración local limita la escucha a loopback por defecto.

Lockfile, instalación limpia, compilación, tipos y pruebas de ambas aplicaciones se verificaron localmente. Se comprobaron por HTTP el arranque de la API compilada y el servidor de desarrollo Angular. PostgreSQL operativo, sesiones, ingesta, SSE y reproductor se incorporan después; estas comprobaciones no acreditan esas capacidades.

## Dirección aceptada

El backend será un monolito modular con Recepción, Telemetría, Consultas, Tiempo real, Acceso y Demo. Las reglas y casos de uso se separan de HTTP, persistencia y cola; los módulos y abstracciones nacen cuando incorporan comportamiento útil.

Angular agrupa páginas, fachadas y componentes por funcionalidad. Los adaptadores HTTP/SSE encapsulan transporte; las fachadas poseen el estado y los componentes presentan datos e intenciones. Se compartirá una conexión SSE y una coordinación de recuperación por sesión.

Tres contenedores permanentes: `web` sirve Angular y hace proxy bajo el mismo origen hacia `api`; `db` conserva datos en un volumen PostgreSQL. Solo `web` publica el puerto de loopback. Esta composición se implementa y comprueba en E0-I03.

La ingesta posterior utilizará cola durable en PostgreSQL, procesamiento transaccional por evento y outbox para cambios confirmados. El receptor progresa independientemente de los controles del emisor. La persistencia y el procesamiento se demostrarán con PostgreSQL real; no se deducen de esta descripción.

El coste de estas decisiones es una composición modular y controles transaccionales explícitos. Mantienen un único despliegue de API y evitan agregar un broker o servicios ajenos al alcance. No se afirma capacidad productiva para una flota real sin mediciones.
