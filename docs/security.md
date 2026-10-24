# Seguridad

## Controles de esta base

Solo web publica loopback mediante Compose. Acceso verifica Argon2id contra PostgreSQL, sesiones absolutas, origen/CSRF, capacidad, cuotas y políticas explícitas de rutas; su contrato y límites están en [acceso](access.md). La ingesta comprueba API key antes del parser; [SSE](realtime.md) requiere sesión, origen válido si existe, cuota, cupos y reautorización por envío, con cierre por revocación/vencimiento. No hay telemetría ficticia para simular esas capacidades.

El [perfil cloud](cloud-deployment.md) agrega HTTPS y una cuenta con contraseña privada; solo publica el gateway. Aplica cinco intentos globales de login por minuto y dos verificaciones Argon2 concurrentes, sin depender de un CAPTCHA externo. El perfil local conserva su límite de diez intentos/minuto. El frontend ya no muestra credenciales de acceso. Las credenciales configuradas permanecen fuera de Git, de las imágenes y del entorno HTTP posterior al bootstrap.

Las credenciales de GitHub se utilizan mediante las herramientas de autenticación y no forman parte del repositorio, del frontend o de las imágenes. `.gitignore` excluye entornos reales, dependencias, builds y reportes. Los artefactos publicables se seleccionan y comprueban mediante una lista cerrada y un marcador sintético excluido, según [CI](ci-controls.md); trazas, HAR, cookies y logs crudos no se suben por defecto.

## Dependencias

La primera resolución con Vite 8.3.0 produjo un hallazgo alto [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) y avisos relacionados de `launch-editor`. Se fijó **Vite 8.3.4**; el override raíz `vite: $vite` hace que el builder Angular y Vitest usen ese mismo parche, porque el builder declara 8.3.0 exacto.

La resolución corregida pasó `npm audit`, compilación de ambas aplicaciones y pruebas de API/Angular. No se desactivó la auditoría ni se añadió una excepción al hallazgo. El override debe revisarse al actualizar Angular y retirarse cuando su dependencia permita resolver un parche seguro sin él.

Para las pruebas de Nest se utiliza directamente `@swc/core`, con metadatos de decoradores y una prueba HTTP de inyección. Se retiró el adaptador multibundler cuyos tipos requerían herramientas opcionales ajenas al proyecto. Ese problema del bootstrap se resolvió retirando una dependencia innecesaria.

Drizzle 0.45.4 introduce otro problema de declaraciones: la comprobación completa produjo 73 diagnósticos en dependencias, incluidos tipos de otros dialectos. La API utiliza explícitamente `skipLibCheck: true`, conservando `strict` y los demás controles del código propio. Angular conserva `skipLibCheck: false`. La opción omite la revisión interna de declaraciones dentro del proyecto API; no se limita a Drizzle ni repara sus tipos. El uso de las declaraciones desde nuestro código continúa comprobándose. Las pruebas SQL, integración, compilación y auditoría siguen siendo obligatorias. Revisar esta excepción al actualizar Drizzle. [Reporte upstream](https://github.com/drizzle-team/drizzle-orm/issues/5187), [semántica de TypeScript](https://www.typescriptlang.org/tsconfig/skipLibCheck.html).

Drizzle Kit incorpora un adaptador legado con esbuild 0.18.20, afectado por [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99). El override acotado a `@esbuild-kit/core-utils` fija esbuild 0.25.12. La resolución corregida se instaló mediante `npm ci`, generó la migración y pasó auditoría sin hallazgos. No se aplica un downgrade forzado de Drizzle Kit ni una excepción al escáner.

La ausencia de hallazgos es evidencia del árbol y la base de avisos consultados, no seguridad total. Un hallazgo alto/crítico bloquea por defecto; las excepciones requieren evaluación expresa, componente exacto, motivo y vencimiento. Un escaneo inconcluso no equivale a aprobación.

## Verificación de componentes y escaneos

La [issue #43](https://github.com/ngarayc/Nexo/issues/43) surgió al investigar detalles ausentes en Trivy para CVE-2026-107891. El [registro de Alpine3.24](https://secdb.alpinelinux.org/v3.24/main.json) relaciona musl con una corrección1.2.6-r3, disponible como [paquete oficial](https://pkgs.alpinelinux.org/package/v3.24/main/x86_64/musl). Las tres imágenes contenían1.2.6-r2; API/web/DB y sus etapas de construcción pertinentes ahora instalan musl y musl-utils1.2.6-r3 fijados, manteniendo los digests base y usuarios. No se infiere una severidad ni un rechazo del CVE a partir de metadatos ausentes.

El nuevo control de [escaneos](ci-controls.md) rechaza ese resultado como inconcluso aunque su salida sea0. Las imágenes parcheadas completaron escaneos nuevos con inventario/digest comprobados, sin el aviso de detalles ausentes y sin HIGH/CRITICAL reportados. No se añadió excepción. [Verificación](verification.md) distingue la comprobación del paquete/escáner de su regresión funcional y CI posteriores; los verdes anteriores no acreditan esta corrección.

El primer CI remoto pasó y la base se promovió a test por PR. Las [demostraciones negativas y recuperación](control-demonstrations.md) comprobaron bloqueo mediante reglas equivalentes. Cada candidato nuevo mantiene CI, escaneos y revisión humana propia hacia main; las comprobaciones de ingesta/SSE se registran en sus incrementos y no se deducen del primer CI. Cada imagen nueva repite el escaneo: resultados anteriores no acreditan una revisión posterior.

## Escaneo previo a la publicación inicial

Gitleaks 8.30.1 escaneó la selección de archivos del primer commit sin hallazgos. En una copia temporal, un token sintético produjo código de salida 1; al retirarlo, el escaneo volvió a 0. Esto comprueba detección y recuperación locales del escáner, no el bloqueo remoto de una PR. El marcador nunca se incorporó al repositorio.

## Imágenes: bloqueo y corrección comprobados

Trivy 0.76.0 detectó hallazgos altos/críticos en las bases Debian iniciales: 68 coincidencias en API, 64 en web y 99 en PostgreSQL. Son coincidencias de paquete/aviso, no CVE únicas. Esos resultados bloquearon el candidato; la auditoría npm sin hallazgos no cubre los paquetes del sistema.

El perfil vigente usa bases oficiales Alpine fijadas por digest: Node 24.22.1, NGINX 1.30.6, PostgreSQL 18.6 y Caddy 2.11.7 en Azure. La API elimina npm/yarn del runtime, donde solo necesita Node y dependencias de aplicación. La web instala los parches fijados libexpat 2.9.0-r0 y libx11 1.8.14-r0. PostgreSQL comienza directamente como su usuario, con el directorio de datos preparado en la imagen; se retira el helper Go antiguo que ya no necesita para abandonar root. No se modifica el entrypoint oficial.

En la corrección inicial de las bases, las tres imágenes de entonces pasaron Trivy sin hallazgos altos/críticos y las 12 pruebas de integración de esa etapa volvieron a pasar, incluido el módulo nativo Argon2 y persistencia tras recreación. No se habilitó `ignore-unfixed`, se redujo la severidad requerida ni se agregaron exclusiones. El resultado pertenece a esas imágenes y la base de avisos consultada; se repite al construir el candidato de CI.

## Limpieza explícita en modo demo

La [limpieza del panel](replay-panel.md#limpiar-demostración) comparte sesión, origen, CSRF y cuota con el control del reproductor. La confirmación indica que borra datos e informes sin respaldo. El bootstrap habilita una función SQL de alcance fijo solamente con DEMO_ENABLED=true, revoca PUBLIC y concede EXECUTE a nexo_app en la misma transacción. Al deshabilitar el modo demo se retira la función. No permite elegir tablas, introducir SQL ni modificar la cuenta o migraciones; la API no hereda credenciales administrativas.

La función usa un search_path seguro y nombres cualificados, conforme a [las precauciones de PostgreSQL para SECURITY DEFINER](https://www.postgresql.org/docs/18/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY). Un [bloqueo asesor transaccional](https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS) exclusivo serializa el borrado con las escrituras compartidas. El usuario SQL de la aplicación sigue siendo una frontera técnica privada, no una identidad humana; en este perfil todos los clientes autenticados usan la única cuenta de demostración y pueden confirmar la limpieza.

## Actualización de Brotli y Node

La [issue #100](https://github.com/ngarayc/Nexo/issues/100) resuelve el bloqueo del escaneo de la imagen web por CVE-2026-111497, HIGH, en brotli-libs 1.2.0-r1. Una base Trivy recién descargada reprodujo el hallazgo que no mostraba la caché local anterior. Se fija brotli-libs 1.2.1-r0 en web, PostgreSQL y gateway, que incluyen la biblioteca, sin excepciones ni reducción de severidad. [Alpine registra esa versión como corrección](https://secdb.alpinelinux.org/v3.24/main.json); [Brotli publicó la actualización](https://github.com/google/brotli/releases/tag/v1.2.1).

Node incorpora su propia copia de Brotli: actualizar el APK no corrige ese binario. API y etapas de build pasan también a Node 24.22.1, publicación de seguridad que corrige ese CVE y otros avisos altos de DNS/TLS. Se actualizan .nvmrc, engines, lockfile, política de evidencia ampliada y los tres FROM por digest; npm continúa en 12.2.0. CI construye y escanea también el gateway, con inventarios de Alpine y Go, dentro del artefacto system existente. [Aviso y correcciones oficiales de Node 24.22.1](https://nodejs.org/en/blog/release/v24.22.1). Las verificaciones y escaneos nuevos pertenecen al candidato corregido; los resultados anteriores no lo acreditan.

## Corrección de body-parser — #103

El audit remoto detectó HIGH en body-parser 2.3.0 por [GHSA-27r3-jxmh-p828](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828), publicado en la base de avisos durante la preparación de esta entrega. Se resolvió a 2.4.0 en el lockfile, versión corregida por el [mantenedor](https://github.com/expressjs/body-parser/releases/tag/v2.4.0) y compatible con el rango de Express. Solo cambió ese paquete instalado; no se añadieron overrides, excepciones o cambios de framework.

Nexo ya inicia Nest con bodyParser deshabilitado y su lectura JSON acotada rechaza compresión. Eso limita la exposición de la ruta descrita por el aviso, pero no sustituye actualizar la dependencia ni permite omitir el gate. La corrección mantiene validación, límites, origen/CSRF y autenticación; [#103](https://github.com/ngarayc/Nexo/issues/103) identifica el cambio y [verificación](verification.md) registra los controles focalizados.
