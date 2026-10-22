# Controles de integración

## Estado

Los workflows de Actions y los módulos de `scripts/ci/` implementan el protocolo de E0-I04. [La primera ejecución remota](https://github.com/ngarayc/Nexo/actions/runs/39552267643) pasó quality, unit, integration, security-source, system y ci-required para el origen `7d65bd2518e2501687123b3c702b142ed8a98e02`; sus cinco artefactos saneados se descargaron y revalidaron contra el candidato de integración `9d373779aa138bbb27152ee34e89dfe2b03415f4`. La [PR #7](https://github.com/ngarayc/Nexo/pull/7) se integró en test tras revisión técnica. Las [demostraciones negativas y recuperación](control-demonstrations.md) también se ejecutaron en un recurso descartable con reglas equivalentes: rechazo de push directo, bloqueo por prueba omitida/fallida y recuperación por PR.

```sh
node scripts/ci/run-node-tests.mjs ci-controls
```

El comando ejecuta el inventario de archivos `.test.mjs`, exige pruebas ejecutadas en cada archivo y genera únicamente métricas en `reports/ci-controls-summary.json`. Fallos, cancelación, skip, todo o inventario vacío impiden emitir un resumen aprobatorio. `reports/` queda fuera de Git.

## Trazabilidad

`scripts/ci/traceability.mjs` usa los metadatos del evento, el historial Git y la API de GitHub mediante su cliente autenticado. Comprueba el checkout real, las ramas permanentes y las promociones development → test → main. Rechaza forks y eventos de CI no contemplados.

Los commits propios deben incluir un trailer `Refs #<issue>`; pueden declarar varias referencias separadas por coma. Cada número se comprueba como una issue del repositorio, abierta o cerrada. Un número de PR no sirve como issue. Esto comprueba la existencia de la referencia; no demuestra por sí solo que la issue precedió a cada edición o que todos sus criterios estén resueltos.

Los merges sin trailer solo se admiten si la API acredita una PR integrada por el flujo permitido y el SHA exacto de merge. Un push a test/main también necesita esa procedencia. Un fallo de autenticación o consulta impide verificar la trazabilidad.

La prueba local contra la API real validó el commit de plantillas y su issue #2. Su contexto de push fue construido localmente; no se presenta como una ejecución de Actions.

## Resultados y artefactos

`scripts/ci/results.mjs` exige los cinco controles: quality, unit, integration, security-source y system. Su evaluación rechaza fallo, ausencia, cancelación, skip, reportes de otra revisión/ejecución/intento y comprobaciones obligatorias incompletas. La revisión hacia main utiliza un contexto separado y obligatorio, descrito a continuación.

Los reportes publicables solo contienen versión de formato, job, SHA, ejecución, intento, nombres de controles, resultado y métricas de pruebas. Campos adicionales se rechazan. No se publican respuestas de aplicación, logs crudos, cookies, hashes, entornos o trazas.

El adaptador de reportes Vitest contrasta cada archivo del inventario con el resultado real, exige casos ejecutados y totales consistentes. Una suite vacía, un archivo omitido o casos pendientes/todo/fallidos bloquean. El inventario debe derivarse de los archivos que corresponden al runner; borrar pruebas requiere revisión del diff y no queda justificado por una ejecución verde.

## Evidencia y límites

Las 31 pruebas de los controles incluyen omisiones, reportes antiguos, discrepancias de conteo, ramas incorrectas, referencias a PR, metadatos ausentes y recuperación con un conjunto válido. Acreditan el comportamiento local de los validadores. CI y escaneos pasaron remotamente; [E0-I04](https://github.com/ngarayc/Nexo/issues/4) registra además los rechazos y recuperación remotos, con [metadatos y reportes saneados](evidence/control-proofs.json). La revisión humana de main conserva su criterio propio.

## Workflows y revisión del candidato

[CI](../.github/workflows/ci.yml) se ejecuta en pushes de las tres ramas permanentes y PR hacia test/main. Quality precede a los otros cuatro controles. `ci-required` se ejecuta con `always()` y verifica sus resultados y cinco reportes del mismo SHA, ejecución e intento. Los uploads nombran únicamente cada JSON saneado, exigen su existencia y conservan siete días. No hay despliegue automático.

[La revisión de main](../.github/workflows/main-review.yml) solo se ejecuta para PR con destino main y espera el entorno `main-review`, cuyo revisor requerido es el autor y cuyo bypass administrativo está deshabilitado. Después de su intervención valida la promoción y checkout exactos. `main` requiere ambos contextos, `ci-required` y `main-review`; `test` requiere `ci-required`, vinculados a la aplicación GitHub Actions observada. Se conserva PR, base actualizada y protección contra force push/borrado. Las PR [#8](https://github.com/ngarayc/Nexo/pull/8) y [#22](https://github.com/ngarayc/Nexo/pull/22) ya tienen aprobación real del autor e integración comprobada; [verificación](verification.md) identifica sus candidatos y ejecuciones. Esas aprobaciones no cubren cambios posteriores.

El contexto de revisión no se genera como job omitido de un push a test: GitHub acepta estados skipped/neutral para algunos checks requeridos y puede usar checks de head cuando no hay resultados del merge de prueba. Un workflow exclusivo de PR hacia main evita reutilizar ese contexto desde pushes ordinarios. Un nuevo commit candidato reinicia el recorrido y cancela la ejecución anterior. [Estados requeridos en GitHub](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks), [revisores de entornos](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

El entorno registra una aprobación del candidato; no publica un servicio. El agente conserva acceso a la sesión autorizada, mientras los tokens del CI tienen lectura y no contienen las llaves personales. La revisión técnica del agente y las pruebas no sustituyen la intervención humana.

`check-workflows.mjs` comprueba los YAML reales: controles y dependencias obligatorios, agregado incondicional, permisos de lectura, actions externas por SHA, revisión en workflow separado y uploads por lista explícita. Sus pruebas alteran esas propiedades para comprobar el rechazo. Cambios al propio verificador también requieren revisión del diff.

La política Compose se comprueba sobre el JSON realmente expandido por el CLI con secretos sintéticos, analizado en memoria: tres servicios, puertos solo en web/loopback, red de base interna y ausencia de montajes de host/secretos en web. No se conserva ni publica ese JSON.

El escenario HTTP de 10.000 eventos y su repetición forman parte del inventario de integración. El comando de integración dispone de 1.200 segundos en su orquestador; el runner admite hasta 360 por archivo, y el escenario de volumen hasta 330. Los jobs tienen límites de 25 minutos para integration y 35 para system, incluyendo preparación, construcción y verificaciones. Se ampliaron después de que el intento 2 de [CI 39711647349](https://github.com/ngarayc/Nexo/actions/runs/39711647349) agotara los límites anteriores de 15/20 minutos: la preparación consumió unos cinco minutos y dejó un margen insuficiente para el inventario completo. Los plazos HTTP/SQL de la aplicación y todos los casos obligatorios se conservan.

La preparación instala npm y el lockfile con `--no-audit` para concentrar la consulta de vulnerabilidades en el `npm audit --audit-level=high` obligatorio de security-source. No se duplica esa consulta en cada instalación. Los dos primeros intentos de esa ejecución fallaron al consultar el endpoint de avisos de npm; una auditoría inconclusa sigue bloqueando el reporte y la promoción. Una nueva ejecución conserva las comprobaciones completas y exige cinco artefactos del mismo intento.
