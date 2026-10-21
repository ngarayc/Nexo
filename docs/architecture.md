# Arquitectura

## Estado implementado

Nexo contiene dos aplicaciones de un workspace npm: API NestJS/TypeScript ESM y frontend Angular standalone. La API compone controladores, servicios y acceso PostgreSQL mediante inyección; Angular presenta acceso y pantalla inicial protegida mediante el router. Docker Compose integra web, API y PostgreSQL bajo un mismo origen.

Se verificaron instalación limpia, calidad, compilación, pruebas unitarias, migración y seed sobre PostgreSQL real, salud y conservación del usuario/hash tras recrear contenedores. Las credenciales de migración y ejecución se distinguen; la API HTTP no hereda la contraseña del propietario. Ingesta, SSE y reproductor se incorporan después.

`modules/access` separa validación pura, caso de autenticación y puertos de sus adaptadores Argon2/PostgreSQL/HTTP. Su composición conecta proveedores y guard global. `platform/http` define la política explícita y parser acotado, sin importar implementaciones de módulos. En Angular la fachada coordina el adaptador HTTP y estado efímero; guard e interceptor consumen ese estado compartido. [Acceso](access.md) describe reservas, revocación, CSRF y costes del almacenamiento en una instancia.

La primera migración crea `users`; la segunda incorpora las seis tablas de [persistencia de E1](persistence.md), restricciones, triggers y adaptadores puros de identidad, instante y JSON. Drizzle mantiene su registro técnico de migraciones en su propio esquema. La salud exige conexión, migración vigente y cuenta preparada cuando la demo está habilitada; no acredita procesamiento de telemetría antes de implementar sus casos de uso.

## Dirección aceptada

El backend será un monolito modular con Recepción, Telemetría, Consultas, Tiempo real, Acceso y Demo. Las reglas y casos de uso se separan de HTTP, persistencia y cola; los módulos y abstracciones nacen cuando incorporan comportamiento útil.

Angular agrupa páginas, fachadas y componentes por funcionalidad. Los adaptadores HTTP/SSE encapsulan transporte; las fachadas poseen el estado y los componentes presentan datos e intenciones. Se compartirá una conexión SSE y una coordinación de recuperación por sesión.

Tres contenedores permanentes: `web` sirve Angular y hace proxy bajo el mismo origen hacia `api`; `db` conserva datos en un volumen PostgreSQL. Solo `web` publica el puerto de loopback. Esta composición y el acceso por localhost desde Windows/WSL se comprobaron en E0-I03. Los tres servicios comienzan con usuarios sin root. API/web tienen filesystem de solo lectura y temporal writable; no requieren volúmenes persistentes propios. PostgreSQL escribe únicamente sus datos de servicio y el volumen.

La ingesta posterior utilizará cola durable en PostgreSQL, procesamiento transaccional por evento y outbox para cambios confirmados. El receptor progresa independientemente de los controles del emisor. La persistencia y el procesamiento se demostrarán con PostgreSQL real; no se deducen de esta descripción.

La [admisión](ingestion.md) prepara pg-boss y conecta rutas HTTP, autenticación pre-parser, cuotas y adaptadores SQL. Conserva recibos propios y publica el primer job en la misma transacción Drizzle; todavía no ejecuta el consumidor de clasificación. Las consultas/sesiones/salud comparten pool de cuatro conexiones y un presupuesto acotado de operaciones. La espera HTTP no controla el procesamiento ni interpreta un timeout como rollback.

El coste de estas decisiones es una composición modular y controles transaccionales explícitos. Mantienen un único despliegue de API y evitan agregar un broker o servicios ajenos al alcance. No se afirma capacidad productiva para una flota real sin mediciones.
