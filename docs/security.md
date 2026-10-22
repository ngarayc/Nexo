# Seguridad

## Controles de esta base

Solo web publica loopback mediante Compose. Acceso verifica Argon2id contra PostgreSQL, sesiones absolutas, origen/CSRF, capacidad, cuotas y políticas explícitas de rutas; su contrato y límites están en [acceso](access.md). La ingesta comprueba API key antes del parser; [SSE](realtime.md) requiere sesión, origen válido si existe, cuota, cupos y reautorización por envío, con cierre por revocación/vencimiento. No hay telemetría ficticia para simular esas capacidades.

Las credenciales de GitHub se utilizan mediante las herramientas de autenticación y no forman parte del repositorio, del frontend o de las imágenes. `.gitignore` excluye entornos reales, dependencias, builds y reportes. Los artefactos publicables se seleccionarán explícitamente; trazas, HAR, cookies y logs crudos no se suben por defecto.

## Dependencias

La primera resolución con Vite 8.3.0 produjo un hallazgo alto [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) y avisos relacionados de `launch-editor`. Se fijó **Vite 8.3.4**; el override raíz `vite: $vite` hace que el builder Angular y Vitest usen ese mismo parche, porque el builder declara 8.3.0 exacto.

La resolución corregida pasó `npm audit`, compilación de ambas aplicaciones y pruebas de API/Angular. No se desactivó la auditoría ni se añadió una excepción al hallazgo. El override debe revisarse al actualizar Angular y retirarse cuando su dependencia permita resolver un parche seguro sin él.

Para las pruebas de Nest se utiliza directamente `@swc/core`, con metadatos de decoradores y una prueba HTTP de inyección. Se retiró el adaptador multibundler cuyos tipos requerían herramientas opcionales ajenas al proyecto. Ese problema del bootstrap se resolvió retirando una dependencia innecesaria.

Drizzle 0.45.4 introduce otro problema de declaraciones: la comprobación completa produjo 73 diagnósticos en dependencias, incluidos tipos de otros dialectos. La API utiliza explícitamente `skipLibCheck: true`, conservando `strict` y los demás controles del código propio. Angular conserva `skipLibCheck: false`. La opción omite la revisión interna de declaraciones dentro del proyecto API; no se limita a Drizzle ni repara sus tipos. El uso de las declaraciones desde nuestro código continúa comprobándose. Las pruebas SQL, integración, compilación y auditoría siguen siendo obligatorias. Revisar esta excepción al actualizar Drizzle. [Reporte upstream](https://github.com/drizzle-team/drizzle-orm/issues/5187), [semántica de TypeScript](https://www.typescriptlang.org/tsconfig/skipLibCheck.html).

Drizzle Kit incorpora un adaptador legado con esbuild 0.18.20, afectado por [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99). El override acotado a `@esbuild-kit/core-utils` fija esbuild 0.25.12. La resolución corregida se instaló mediante `npm ci`, generó la migración y pasó auditoría sin hallazgos. No se aplica un downgrade forzado de Drizzle Kit ni una excepción al escáner.

La ausencia de hallazgos es evidencia del árbol y la base de avisos consultados, no seguridad total. Un hallazgo alto/crítico bloquea por defecto; las excepciones requieren evaluación expresa, componente exacto, motivo y vencimiento. Un escaneo inconcluso no equivale a aprobación.

## Verificación pendiente

El primer CI remoto pasó y la base se promovió a test por PR. Las [demostraciones negativas y recuperación](control-demonstrations.md) comprobaron bloqueo mediante reglas equivalentes. Cada candidato nuevo mantiene CI, escaneos y revisión humana propia hacia main; las comprobaciones de ingesta/SSE se registran en sus incrementos y no se deducen del primer CI. Cada imagen nueva repite el escaneo: resultados anteriores no acreditan una revisión posterior.

## Escaneo previo a la publicación inicial

Gitleaks 8.30.1 escaneó la selección de archivos del primer commit sin hallazgos. En una copia temporal, un token sintético produjo código de salida 1; al retirarlo, el escaneo volvió a 0. Esto comprueba detección y recuperación locales del escáner, no el bloqueo remoto de una PR. El marcador nunca se incorporó al repositorio.

## Imágenes: bloqueo y corrección comprobados

Trivy 0.76.0 detectó hallazgos altos/críticos en las bases Debian iniciales: 68 coincidencias en API, 64 en web y 99 en PostgreSQL. Son coincidencias de paquete/aviso, no CVE únicas. Esos resultados bloquearon el candidato; la auditoría npm sin hallazgos no cubre los paquetes del sistema.

Las imágenes finales usan bases oficiales Alpine fijadas por digest y conservan Node 24.22.0, NGINX 1.30.6 y PostgreSQL 18.6. La API elimina npm/yarn del runtime, donde solo necesita Node y dependencias de aplicación. La web instala los parches fijados libexpat 2.9.0-r0 y libx11 1.8.14-r0. PostgreSQL comienza directamente como su usuario, con el directorio de datos preparado en la imagen; se retira el helper Go antiguo que ya no necesita para abandonar root. No se modifica el entrypoint oficial.

Las tres imágenes construidas pasaron Trivy sin hallazgos altos/críticos y las 12 pruebas de integración volvieron a pasar sobre estas variantes, incluido el módulo nativo Argon2 y persistencia tras recreación. No se habilitó `ignore-unfixed`, se redujo la severidad requerida ni se agregaron exclusiones. El resultado pertenece a esas imágenes y la base de avisos consultada; se repite al construir el candidato de CI.
