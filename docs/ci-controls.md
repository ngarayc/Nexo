# Controles de integración

## Estado

Los workflows de Actions y los módulos de `scripts/ci/` implementan el protocolo de E0-I04. Calidad, validadores y los tres recorridos Chromium pasaron localmente. La primera ejecución remota y las demostraciones de bloqueo siguen pendientes; esta configuración todavía no acredita que GitHub haya bloqueado una integración.

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

Las pruebas de los controles incluyen omisiones, reportes antiguos, discrepancias de conteo, ramas incorrectas, referencias a PR, metadatos ausentes y recuperación con un conjunto válido. Acreditan el comportamiento local de los validadores. El CI, los escaneos remotos y la demostración de protección de main permanecen pendientes en [E0-I04](https://github.com/ngarayc/Nexo/issues/4).

## Workflows y revisión del candidato

[CI](../.github/workflows/ci.yml) se ejecuta en pushes de las tres ramas permanentes y PR hacia test/main. Quality precede a los otros cuatro controles. `ci-required` se ejecuta con `always()` y verifica sus resultados y cinco reportes del mismo SHA, ejecución e intento. Los uploads nombran únicamente cada JSON saneado, exigen su existencia y conservan siete días. No hay despliegue automático.

[La revisión de main](../.github/workflows/main-review.yml) solo se ejecuta para PR con destino main y espera el entorno `main-review`, cuyo revisor requerido es el autor y cuyo bypass administrativo está deshabilitado. Después de su intervención valida la promoción y checkout exactos. `main` requiere ambos contextos, `ci-required` y `main-review`; `test` requiere `ci-required`. Se conserva PR, base actualizada y protección contra force push/borrado. La configuración está consultada; su primer recorrido real sigue pendiente.

El contexto de revisión no se genera como job omitido de un push a test: GitHub acepta estados skipped/neutral para algunos checks requeridos y puede usar checks de head cuando no hay resultados del merge de prueba. Un workflow exclusivo de PR hacia main evita reutilizar ese contexto desde pushes ordinarios. Un nuevo commit candidato reinicia el recorrido y cancela la ejecución anterior. [Estados requeridos en GitHub](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks), [revisores de entornos](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

El entorno registra una aprobación del candidato; no publica un servicio. El agente conserva acceso a la sesión autorizada, mientras los tokens del CI tienen lectura y no contienen las llaves personales. La revisión técnica del agente y las pruebas no sustituyen la intervención humana.

`check-workflows.mjs` comprueba los YAML reales: controles y dependencias obligatorios, agregado incondicional, permisos de lectura, actions externas por SHA, revisión en workflow separado y uploads por lista explícita. Sus pruebas alteran esas propiedades para comprobar el rechazo. Cambios al propio verificador también requieren revisión del diff.

La política Compose se comprueba sobre el JSON realmente expandido por el CLI con secretos sintéticos, analizado en memoria: tres servicios, puertos solo en web/loopback, red de base interna y ausencia de montajes de host/secretos en web. No se conserva ni publica ese JSON.
