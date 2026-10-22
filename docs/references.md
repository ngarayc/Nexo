# Procedencia de decisiones y herramientas

[Flota e historial](dashboard.md) relaciona tablas semánticas W3C WAI e interpolación Angular con los componentes, foco, representación de IDs y pruebas reales aplicadas.

La [coordinación de Angular](frontend-sync.md) relaciona las fuentes de Signals y EventSource con las fachadas, captura y recuperación propias de Nexo, sus pruebas y límites.

Los requisitos suministrados se conservan en [requirements](requirements/common-spec.md) y [el backlog](requirements/backlog.md). Se distinguen de las elecciones propias de Nexo. No se copia una plataforma de seguimiento ni se atribuye código que no se haya tomado de una fuente.

| Fuente primaria                                                                   | Aplicación y límite                                                                                                                |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [Nest: módulos](https://docs.nestjs.com/modules)                                  | Composición e inyección del bootstrap; las fronteras del monolito son decisión de Nexo                                             |
| [Angular: estilo](https://angular.dev/style-guide)                                | Organización por funcionalidades y componentes; las fachadas se incorporan al existir estado                                       |
| [Angular: pruebas](https://angular.dev/guide/testing)                             | Builder de pruebas Angular; no sustituir su compilación por un transformador TypeScript genérico                                   |
| [Node 24.22.0](https://nodejs.org/en/blog/release/v24.22.0)                       | Runtime seleccionado y verificado en instalación, builds, pruebas y arranque locales                                               |
| [npm workspaces](https://docs.npmjs.com/cli/v12/using-npm/workspaces/)            | Un repositorio, manifiestos por aplicación y lockfile raíz                                                                         |
| [Skills](https://learn.chatgpt.com/docs/build-skills)                             | Formato y descubrimiento; mantener `skills/` y enlaces relativos no demuestra por sí solo uso real                                 |
| [Seguridad de Codex](https://learn.chatgpt.com/docs/enterprise/security-cookbook) | Proteger credenciales y comprobar controles efectivos; una regla escrita o un filtro de variables no acreditan una barrera técnica |

La investigación de telemetría, colas, recuperación y cartografía se incorporará a la documentación pública junto al comportamiento realmente implementado: fuente, adaptación, motivo, coste, archivos y prueba observada. El catálogo privado de planeación no forma parte del repositorio.

## Identidad, tiempo y evidencia — E1-I01

[Persistencia](persistence.md) enlaza las fuentes PostgreSQL de exclusiones, hash, B-tree, JSON y aislamiento con su adaptación, coste y pruebas. La codificación por puntos de código y el comparador exacto son propios. [Temporal](https://github.com/js-temporal/temporal-polyfill), fijado en 0.5.1, aporta validación de calendario/zona; Nexo conserva por separado la cola decimal que excede nanosegundos. [jsonc-parser](https://github.com/microsoft/node-jsonc-parser), fijado en 3.3.1, aporta AST y offsets; Nexo exige JSON estricto y añade conservación de fragmentos e igualdad decimal sin Number. No se ha copiado código de una plataforma de seguimiento.

## Cola y admisión — base de E1-I02

[El adaptador de pg-boss](https://pgboss.io/api/adapters) permite usar la transacción Drizzle existente para publicar. Se fijó 12.38.0 y se verificó con las versiones propias y PostgreSQL real, sin forzar peers. La biblioteca administra su esquema 46; Nexo conserva recibos, presupuesto y resultados propios. [Admisión](ingestion.md) relaciona preparación, opciones documentadas, bloqueo de cuota y costes con los archivos y pruebas observadas. La clasificación y recuperación posteriores conservan criterios propios; no se atribuyen a la promesa de transacción del adaptador.

Para HTTP, [Problem Details](https://www.rfc-editor.org/rfc/rfc9457.html) aporta el formato y extensiones; Nexo añade significado de admisión, disponibilidad de resultados e índices. [NGINX request buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_request_buffering) sustenta el paso incremental del cuerpo y [error_page](https://nginx.org/en/docs/http/ngx_http_core_module.html#error_page) el 413 identificable. La clave, cuota y parser mantienen su orden dentro de la aplicación; no se atribuye autenticación al proxy ni rollback a un timeout. Los casos por ambas fronteras están en tests/integration/ingestion-http.test.mjs.

## Persistencia, arranque y CSP

[Drizzle: migraciones](https://orm.drizzle.team/docs/migrations) aporta generación SQL revisable y aplicación antes de servir; Nexo añade seed comprobado y separación de permisos. [PostgreSQL oficial en Docker](https://hub.docker.com/_/postgres) establece el montaje de datos de la versión 18. [Compose: orden de arranque](https://docs.docker.com/compose/how-tos/startup-order/) sustenta las dependencias por salud; las pruebas desconectan la base para comprobar que salud no equivale a contenedor iniciado.

[node-argon2](https://github.com/ranisalt/node-argon2) implementa hash, comprobación y revisión de parámetros. Se usa esa revisión semántica para no depender del orden serializado de los parámetros PHC. [Angular: seguridad](https://angular.dev/best-practices/security) describe el nonce CSP para estilos; [NGINX: sustitución de respuestas](https://nginx.org/en/docs/http/ngx_http_sub_module.html) permite incorporarlo al documento servido. Las adaptaciones están en `infra/`, `apps/api/src/platform/database/` y `apps/web/src/index.html`; la evidencia y sus límites están en [verificación](verification.md).

## Integración comprobada en el bootstrap

[SWC core](https://swc.rs/docs/usage/core) aporta la transformación de TypeScript con metadatos usada en las pruebas Nest. El hook de Vite es propio y pequeño; no reemplaza el typecheck. El parche [Vite 8.3.4](https://github.com/vitejs/vite/releases/tag/v8.3.4) resuelve el árbol vulnerable identificado por la auditoría; el coste y la verificación del override se describen en [seguridad](security.md).

La selección de variantes usa [las imágenes oficiales de Node](https://github.com/nodejs/docker-node) y [PostgreSQL](https://hub.docker.com/_/postgres), con revisión de las diferencias de libc y pruebas nativas. [Trivy 0.76.0](https://github.com/aquasecurity/trivy/releases/tag/v0.76.0) identificó los paquetes/binaries afectados; sus resultados motivaron la reducción de herramientas de runtime y los parches de web descritos en [seguridad](security.md). Se verifica el archivo del escáner mediante SHA-256, sin modificar la clasificación de los hallazgos.

## Acceso

[express-session](https://expressjs.com/en/resources/middleware/session/) aporta SID firmado, regeneración y cookie; [memorystore](https://github.com/roccomuso/memorystore) aporta serialización y caché acotada. Nexo añade reservas, comprobación absoluta y rechazo de escrituras revocadas porque un LRU por sí solo podría expulsar sesiones y `touch` renovar plazos. El adaptador está en `modules/access/adapters/http/session-store.ts` y sus pruebas cubren carreras, capacidad y límite exacto de vencimiento.

[csrf-sync](https://github.com/Psifi-Solutions/csrf-sync) aporta token sincronizado y validación; [express-rate-limit](https://express-rate-limit.mintlify.app/reference/configuration) aplica ventanas con contadores efímeros. Nexo fija identidades internas y límites propios, verifica origen antes del parser y deniega fallos de los controles. [Helmet](https://helmetjs.github.io/) protege las respuestas API con ajuste explícito para HTTP local. No son garantías de escala o producción.

[Interceptors de Angular](https://angular.dev/guide/http/interceptors) sustenta el interceptor funcional de CSRF; la fachada y revisión de respuestas obsoletas son decisiones de Nexo. [Autenticación en Nest](https://docs.nestjs.com/security/authentication) aporta la composición de guards; se utiliza sesión, sin introducir JWT o Passport para una sola cuenta. Los archivos y pruebas se describen en [arquitectura](architecture.md) y [verificación](verification.md).

## Clasificación y concurrencia

[READ COMMITTED de PostgreSQL 18](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-READ-COMMITTED) y [ON CONFLICT](https://www.postgresql.org/docs/18/sql-insert.html#SQL-ON-CONFLICT) sustentan la relectura posterior a la inserción que perdió unicidad. Nexo adapta esas reglas a identidades exactas y proyección bloqueada, con pruebas de dos conexiones, igualdad, conflictos y rollback. La garantía no depende de una consulta previa o de un hash como identidad.

[Workers de pg-boss 12.38.0](https://pgboss.io/api/workers) define confirmación al resolver el handler, concurrencia y polling. Nexo conserva una transacción Drizzle propia, publica la continuación mediante fromDrizzle y hace ACK después del commit; el recibo es la fuente de verdad ante repetición. [Clasificación](classification.md) relaciona archivos, mensajes versionados, costes y límites de la transacción; [recuperación](recovery.md) cubre fallos y presupuesto. Crear un outbox no equivale a haber entregado SSE.

## Recuperación y confirmación incierta

[node-postgres: transacciones](https://node-postgres.com/features/transactions) exige usar el mismo cliente durante una transacción. [Pool](https://node-postgres.com/apis/pool#releasing-clients) permite destruirlo al liberarlo y [Client](https://node-postgres.com/apis/client) documenta el límite de espera de una llamada. Nexo reserva ese cliente para Drizzle/pg-boss y lo descarta ante una respuesta incierta, sin inferir rollback ni repetir una escritura. La prueba nativa pierde la respuesta después de un COMMIT real y comprueba tanto los efectos durables como la terminación de ese backend.

[Jobs de pg-boss 12.38.0](https://pgboss.io/api/jobs) aporta consulta de estados y startAfter; se contrastó además el código instalado de esa versión para el paso de configuración al pool y la conservación de la cadena ISO. El protocolo propio conserva microsegundos, presupuesto y revisión en la misma transacción, con pruebas de igualdad exacta del instante reservado y publicado. Las pruebas de fallo SQL/crash ocurren en stacks sintéticos, sin opciones productivas que alteren el resultado. [Recuperación](recovery.md) explica costes, garantías y límites.

## Consultas coherentes

[REPEATABLE READ de PostgreSQL 18](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-REPEATABLE-READ) aporta la vista común del snapshot, comprobada intercalando una ingesta real entre sus lecturas. [Índices hash](https://www.postgresql.org/docs/18/indexes-types.html#INDEXES-TYPES-HASH) y [ORDER BY](https://www.postgresql.org/docs/18/sql-select.html#SQL-ORDERBY) distinguen igualdad de ordenación; Nexo conserva comparación por identidad completa y orden exacto separado. [Consultas](queries.md) documenta la adaptación, filtros literales, presupuesto, variante JSON de historial y coste de devolver colecciones completas, con un escenario HTTP de 10.000 eventos y revisión del plan de historial. La [entrega SSE](realtime.md) comparte generación con snapshot y conserva límites y comprobaciones propios.

## Descripción de API

[OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html) define la descripción de operaciones, seguridad y esquemas. Nexo mantiene [su contrato versionado](openapi.json) y [la guía de API](api.md), contrastados con los controladores efectivos. El esquema de lote permite posiciones inválidas para preservar clasificación individual; bytes UTF-8, precisión temporal, igualdad y recibos inciertos requieren además reglas y pruebas del servidor. No se incorpora un generador o validador de clientes como sustituto de esas garantías.

## Distribución SSE

[HTML SSE](https://html.spec.whatwg.org/multipage/server-sent-events.html) define framing y EventSource; Nexo añade esquema versionado, generación y recuperación por snapshot. [Node HTTP](https://nodejs.org/docs/latest-v24.x/api/http.html#responsewritechunk-encoding-callback) sustenta el tratamiento de write=false, drain y callbacks; la cola acotada, plazos y cierre son propios y se verifican también con TCP real. [NGINX buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering) fundamenta la ruta incremental sin caché/compresión. [Tiempo real](realtime.md) relaciona adaptación, archivos, costes y límites: distribución local no equivale a recepción del navegador.

## Sincronización comprobada en navegador

[Playwright Route](https://playwright.dev/docs/api/class-route) permite retener una respuesta real mediante fetch/fulfill o continuar una petición hacia otra URL HTTP. Las pruebas de carreras conservan el cuerpo obtenido de la API mientras provocan una ingesta real. El corte individual redirige solo el SSE de ese cliente a un intermediario de loopback que destruye sockets y transmite las tramas sin modificarlas. Esta herramienta de prueba es propia; no constituye una función del producto o una garantía de la emulación offline. [Sincronización](frontend-sync.md) y [verificación](verification.md) relacionan los casos y resultados.

## Diario del emisor

[Restricciones PostgreSQL18](https://www.postgresql.org/docs/18/ddl-constraints.html), [triggers de restricción diferidos](https://www.postgresql.org/docs/18/sql-createtrigger.html) y [bloqueos asesores transaccionales](https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS) sustentan la protección al COMMIT y las altas concurrentes del [diario](replay-journal.md). Nexo añade estados, prefijo confirmado, límite reservado y marcador de intención; las pruebas fuerzan un rollback entre respuesta/cursor y compiten desde dos coordinadores. Estas transacciones no incluyen el futuro HTTP del emisor y no reconstruyen una respuesta perdida.

## Preparación y comparación del replay

La [corrección musl #43](security.md) consulta el registro oficial [Alpine3.24](https://secdb.alpinelinux.org/v3.24/main.json) y [su paquete musl](https://pkgs.alpinelinux.org/package/v3.24/main/x86_64/musl) para fijar1.2.6-r3 cuando el feed central del scanner carece de detalles. Nexo añade el bloqueo de escaneo inconcluso incluso con salida0 y comprueba el inventario de las imágenes reales; no atribuye al proveedor la política de promoción ni inventa la severidad ausente.

[Verificador](replay-verification.md) aplica el aislamiento [REPEATABLE READ de PostgreSQL18](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-REPEATABLE-READ) y las APIs públicas de [jobs](https://pgboss.io/api/jobs) y [adaptadores pg-boss](https://pgboss.io/api/adapters). El inventario usa la misma transacción que los recibos/dominio; no depende de estadísticas en caché ni confunde queued con active. Fuentes originales, expectativas, límites de lectura y conservación histórica son decisiones de Nexo. La integración concurrente verifica visibilidad conjunta de una recepción y su job; no acredita el motor HTTP o la evidencia visual todavía pendientes.
