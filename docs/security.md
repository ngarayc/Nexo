# Seguridad

## Controles de esta base

La API y el servidor de desarrollo escuchan en loopback por defecto. Se rechaza configuración de puerto/host inválida. El bootstrap no recibe credenciales de aplicación ni datos de telemetría; login, API key, CSRF, cuotas y controles SSE se incorporan con sus capacidades y pruebas.

Las credenciales de GitHub se utilizan mediante las herramientas de autenticación y no forman parte del repositorio, del frontend o de las imágenes. `.gitignore` excluye entornos reales, dependencias, builds y reportes. Los artefactos publicables se seleccionarán explícitamente; trazas, HAR, cookies y logs crudos no se suben por defecto.

## Dependencias

La primera resolución con Vite 8.3.0 produjo un hallazgo alto [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) y avisos relacionados de `launch-editor`. Se fijó **Vite 8.3.4**; el override raíz `vite: $vite` hace que el builder Angular y Vitest usen ese mismo parche, porque el builder declara 8.3.0 exacto.

La resolución corregida pasó `npm audit`, compilación de ambas aplicaciones y pruebas de API/Angular. No se desactivó la auditoría ni se añadió una excepción al hallazgo. El override debe revisarse al actualizar Angular y retirarse cuando su dependencia permita resolver un parche seguro sin él.

Para las pruebas de Nest se utiliza directamente `@swc/core`, con metadatos de decoradores y una prueba HTTP de inyección. Se retiró el adaptador multibundler cuyos tipos requerían herramientas opcionales ajenas al proyecto. Se conserva comprobación de tipos, incluidos los tipos de bibliotecas; no se ocultó el fallo mediante `skipLibCheck`.

La ausencia de hallazgos es evidencia del árbol y la base de avisos consultados, no seguridad total. Un hallazgo alto/crítico bloquea por defecto; las excepciones requieren evaluación expresa, componente exacto, motivo y vencimiento. Un escaneo inconcluso no equivale a aprobación.

## Verificación pendiente

Los controles remotos de PR/CI, las demostraciones de bloqueo/recuperación, imágenes, acceso demo y seguridad de la ingesta se verificarán en sus issues. Esta página se actualiza con el comportamiento observado y no presenta políticas pendientes como controles activos.

## Escaneo previo a la publicación inicial

Gitleaks 8.30.1 escaneó la selección de archivos del primer commit sin hallazgos. En una copia temporal, un token sintético produjo código de salida 1; al retirarlo, el escaneo volvió a 0. Esto comprueba detección y recuperación locales del escáner, no el bloqueo remoto de una PR. El marcador nunca se incorporó al repositorio.
