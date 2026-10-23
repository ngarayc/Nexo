# Controles de integración

## Fronteras sobre fuentes

`npm run boundaries` comienza en los tres directorios de fuentes `apps/api/src`, `apps/web/src` y `packages/contracts/src`, con las mismas cinco reglas de ciclos y dependencias prohibidas. [#65](https://github.com/ngarayc/Nexo/issues/65) corrige el falso positivo del cierre E4: un build previo dejaba bundles cíclicos entre las entradas del inventario. Las importaciones encontradas desde fuentes siguen analizándose, incluso si apuntan a una salida generada. No se eliminan builds para obtener verde ni se excluyen carpetas homónimas dentro de `src`.

Siete controles ejecutan el comando y configuración reales sobre fixtures temporales: mantienen fuentes no vacías, dejan fuera salidas ajenas al grafo de fuentes y rechazan ciclos de fuentes, web→servidor, servidor→web, contratos→aplicaciones y contratos→Node. El caso adicional rechaza también web→servidor compilado: detectó que una exclusión global de `dist` ocultaba esa dependencia y motivó reemplazarla por entradas explícitas de fuentes antes de publicar. Revisan las violaciones estructuradas del reporte JSON; la ejecución ordinaria sigue usando la salida de errores y su código de fallo.

## Preparación verificable de Chromium

La [issue #48](https://github.com/ngarayc/Nexo/issues/48) separa la descarga del navegador fijado de la instalación de dependencias del sistema. Se descarga el headless shell que ya utiliza la configuración Chromium sin channel; después un proceso acotado debe abrir ese navegador, navegar y comprobar contenido real del DOM. Una validación nativa deshabilitada bloquea el probe.

Si Chromium funciona, continúan todos los recorridos de sistema y persistencia. Solo un diagnóstico nativo reconocido de dependencias faltantes permite ejecutar install-deps chromium y exige otra comprobación real posterior. Salida inválida, señal, timeout o un fallo de lanzamiento genérico detienen el job. No hay bucle de reintento de pruebas o instalación. Descarga e instalación tienen cinco minutos cada una; cada probe dispone de treinta segundos. Los límites de las pruebas y del job permanecen.

Los pasos y fallos usan códigos cerrados. Sus salidas completas se conservan únicamente en reports/raw, separadas por paso e intento, fuera de los cinco artefactos publicables. Que la preparación termine no acredita las pruebas: browser y persistence solo se marcan aprobados después de ejecutar sus inventarios completos. Los seis controles nuevos prueban disponibilidad, dependencias faltantes y rechazos ante fallo o evidencia inválida.

[Playwright: navegadores y dependencias](https://playwright.dev/docs/browsers#install-system-dependencies) documenta ambos comandos y only-shell. Nexo añade el probe de navegador/DOM, fallback condicionado y diagnóstico cerrado para evitar que una descarga apt innecesaria impida comprobar una instalación ya funcional.

## Estado

Los workflows de Actions y los módulos de `scripts/ci/` implementan el protocolo de E0-I04. [La primera ejecución remota](https://github.com/ngarayc/Nexo/actions/runs/39552267643) pasó quality, unit, integration, security-source, system y ci-required para el origen `7d65bd2518e2501687123b3c702b142ed8a98e02`; sus cinco artefactos saneados se descargaron y revalidaron contra el candidato de integración `9d373779aa138bbb27152ee34e89dfe2b03415f4`. La [PR #7](https://github.com/ngarayc/Nexo/pull/7) se integró en test tras revisión técnica. Las [demostraciones negativas y recuperación](control-demonstrations.md) también se ejecutaron en un recurso descartable con reglas equivalentes: rechazo de push directo, bloqueo por prueba omitida/fallida y recuperación por PR.

```sh
node scripts/ci/run-node-tests.mjs ci-controls
```

El comando ejecuta el inventario de archivos `.test.mjs`, exige pruebas ejecutadas en cada archivo y genera únicamente métricas en `reports/ci-controls-summary.json`. Fallos, cancelación, skip, todo o inventario vacío impiden emitir un resumen aprobatorio. `reports/` queda fuera de Git.

## Trazabilidad

`scripts/ci/traceability.mjs` usa los metadatos del evento, el historial Git y la API de GitHub mediante su cliente autenticado. Comprueba el checkout real, las ramas permanentes y las promociones development → test → main. Rechaza forks y eventos de CI no contemplados.

Los commits propios deben incluir un trailer `Refs #<issue>`; pueden declarar varias referencias separadas por coma. Se admite un único punto final opcional después de la lista completa; para nuevos commits se recomienda omitirlo. No se admiten decimales, puntos intermedios, doble punto, texto adicional o números no seguros. Cada número se comprueba como una issue del repositorio, abierta o cerrada. Un número de PR no sirve como issue. Esto comprueba la existencia de la referencia; no demuestra por sí solo que la issue precedió a cada edición o que todos sus criterios estén resueltos.

Los merges sin trailer solo se admiten si la API acredita una PR integrada por el flujo permitido y el SHA exacto de merge. Un push a test/main también necesita esa procedencia. Un fallo de autenticación o consulta impide verificar la trazabilidad.

La prueba local contra la API real validó el commit de plantillas y su issue #2. Su contexto de push fue construido localmente; no se presenta como una ejecución de Actions.

## Resultados y artefactos

La [investigación #44](https://github.com/ngarayc/Nexo/issues/44) conserva una etapa cerrada cuando falla el caso de presión SSE. El runner reconoce la causa de aserción de Node y permite solo connections, ingest-N, fast-N o released-capacity, conNperteneciente a los16lotes previstos. No imprime message, stack, payload o actual arbitrario; las pruebas incluyen marcadores sensibles sintéticos y causas cíclicas. El fallo continúa bloqueando y no se añaden reintentos o campos a los reportes publicables.

La [corrección #43](https://github.com/ngarayc/Nexo/issues/43) exige que el escaneo de imágenes termine correctamente, identifique el digest y aporte inventario Alpine —y Node en API—. Un aviso de detalles de vulnerabilidad ausentes bloquea aunque el proceso devuelva0; un hallazgo de severidad desconocida tampoco acredita aprobación. Se conserva el log del scanner únicamente en reports/raw, fuera de la lista de artefactos publicables. El aviso general de selección de severidad entre proveedores no se confunde con falta de metadatos. Los controles incluyen salida0 con detalles ausentes, inventario incompleto y severidad desconocida/alta.

`scripts/ci/results.mjs` exige los cinco controles: quality, unit, integration, security-source y system. Su evaluación rechaza fallo, ausencia, cancelación, skip, reportes de otra revisión/ejecución/intento y comprobaciones obligatorias incompletas. La revisión hacia main utiliza un contexto separado y obligatorio, descrito a continuación.

Los reportes publicables solo contienen versión de formato, job, SHA, ejecución, intento, nombres de controles, resultado y métricas de pruebas. Campos adicionales se rechazan. No se publican respuestas de aplicación, logs crudos, cookies, hashes, entornos o trazas.

El runner de navegador crea un stack sintético nuevo por cada archivo de su inventario. Así, el fixture oficial parte de una base vacía sin borrar los datos de otro escenario o de la aplicación habitual. Conserva el mismo job system y los cinco artefactos permitidos. Valida cada reporte contra su archivo y suma únicamente casos aprobados; un fallo de prueba, reporte o limpieza impide emitir el resumen satisfactorio.

Los diagnósticos de cada invocación permanecen en `reports/raw/system/<identificador>/`; `latest.json` indica los archivos y estados de la última invocación. Repetir no elimina los diagnósticos anteriores. Esa carpeta sigue excluida de Git y de los uploads: el reporte publicable de system contiene solo los metadatos y métricas permitidos.

El adaptador de reportes Vitest contrasta cada archivo del inventario con el resultado real, exige casos ejecutados y totales consistentes. Una suite vacía, un archivo omitido o casos pendientes/todo/fallidos bloquean. El inventario debe derivarse de los archivos que corresponden al runner; borrar pruebas requiere revisión del diff y no queda justificado por una ejecución verde.

## Evidencia y límites

### Consulta de promociones — #56

Los intentos39809550498/39809540823 fallaron al consultar metadata de promoción; sus logs no conservan el status HTTP original. Una reproducción posterior contra la asociación commit/PR de1cb4027 devolvió HTTP500 y cuerpo vacío. La consulta directa de PR53 sí confirmó ese merge. Se mantienen ambos hechos diferenciados.

Para el formato estándar de merge de GitHub, el verificador usa la primera línea y sus dos padres solo para localizar un número candidato y consulta [la PR por REST](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request). Ese texto no autoriza la promoción: sigue exigiendo metadata remota, número solicitado, merged_at, SHA exacto, repositorio y ramas development→test→main. Otros formatos mantienen la [consulta de PR asociadas](https://docs.github.com/en/rest/commits/commits#list-pull-requests-associated-with-a-commit). API fallida o contenido no comprobable bloquean; no se amplían permisos ni se sustituye revisión humana.

Cuatro pruebas focalizadas comprueban la localización y los rechazos ante texto falso, otra PR/SHA, fork, flujo incorrecto, no integrada o metadata ausente. La lectura real de PR53 confirma la promoción afectada sin depender del endpoint que devolvió500. Estos resultados no convierten los intentos históricos fallidos en aprobados; cada candidato remoto conserva su CI completo.

[CI39813798583](https://github.com/ngarayc/Nexo/actions/runs/39813798583), intento1 sobre c43f1ca7e8a1cc16c5ad55dc1cea45a904d37753, completó los seis jobs. Sus cinco artefactos se descargaron/revalidaron:458API,90Angular,123integración y14Chromium, sin omisiones. Incluye la comprobación real de la promoción de PR54 dentro del rango publicado. Es evidencia de esta corrección; el recorrido ampliado de aceptación #55 conserva su candidato propio.

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

## Compatibilidad de puntuación de Refs — #62

La [issue #62](https://github.com/ngarayc/Nexo/issues/62) corrige la compatibilidad del trailer publicado en db75242: `Refs #57, #59.`. [CI propio de PR61,39828497893](https://github.com/ngarayc/Nexo/actions/runs/39828497893) rechazó ese punto final conforme a la gramática anterior, después de pasar calidad de fuentes; los jobs funcionales dependientes no se ejecutaron. La corrección admite solo ese signo opcional final y mantiene extracción de números, identidad real de cada issue, rechazo de PR/repositorio ajeno y reglas de contexto/promoción. No hay excepción por commit, exclusión de historia, cambio de workflows o reducción de controles. El historial y el intento fallido se conservan; el candidato nuevo requiere CI propio completo.

## Recorrido ampliado de cierre — #77

El [workflow ampliado](../.github/workflows/expanded.yml) es manual y recibe SHA y etapa explícitos. Conserva permisos de lectura, actions fijadas, validación del SHA antes del checkout y un único upload por lista cerrada. El runner vuelve a comprobar checkout/ejecución y el main vigente para cierre final. [El procedimiento](expanded-validation.md) detalla exportación limpia, imágenes escaneadas/probadas, carga100.000, Firefox/WebKit y manifiesto saneado. El CI ordinario conserva sus seis jobs y cinco artefactos; este workflow no omite sus controles ni concede revisión humana.

Las negativas de workflow rechazan referencia móvil, guardia ausente, pasos omitidos, escritura y upload amplio. Las del manifiesto rechazan otro candidato/intento/fixture/imagen, contenido crudo en niveles anidados, ensayo local presentado como final, carga menor, exceso de conexiones, reset pendiente o resultados de navegador incompletos. El cierre real requiere los resultados del SHA final y no la existencia de estos archivos.

## Cortes SSE bajo el mismo origen

La [corrección #83](https://github.com/ngarayc/Nexo/issues/83) conserva el origen canónico al probar fallos de conexión. Los tres archivos con cortes usan un perfil compartido por los runners ordinario y ampliado: NGINX publica un puerto efímero de loopback propio, manteniendo el origen de aplicación8081. El intermediario del caso sirve ese mismo origen y transporta HTTP/SSE al NGINX real; un identificador de prueba selecciona las conexiones TCP que se destruyen. La otra sesión y las consultas siguen pasando. El destino solo admite el puerto propio de loopback; la limpieza cierra también las conexiones restantes.

La versión anterior reescribía el SSE a otro origen. En WebKit, CSP bloqueaba antes de que el intermediario recibiera una petición; el SSE directo funcionaba. No se relajaron cabeceras, simularon mensajes o eliminaron casos. Las pruebas de transporte comprueban cuerpo, sesión, origen y CSP conservados; los recorridos integrados usan la aplicación, PostgreSQL y SSE reales. [Verificación](verification.md) identifica los resultados y el alcance de esa corrección.
