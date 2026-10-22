# Verificación de Nexo

## Mapa de últimas posiciones — E5-I02 / #67

Pasaron seis pruebas de configuración/generador y doce pruebas Angular focalizadas en tres archivos (proveedor, mapa y página), además de tipos, lint afectado y fronteras de273 módulos/1002 dependencias. El primer intento Angular no inició casos porque el asset estaba fuera del workspace; se corrigió generándolo en el directorio público del proyecto desde la misma fuente revisada. No se omitieron pruebas ni se duplicó una configuración manual.

El primer intento de construcción Docker no comenzó porque el servicio estaba detenido. Tras iniciarlo el autor, la construcción web terminó. Los dos primeros recorridos Chromium llegaron hasta la selección por teclado y fallaron porque Enter no abría el detalle del marcador; el adaptador incorpora activación explícita por Enter/espacio. La repetición del caso oficial pasó con dos clientes, ejes/hemisferio correctos, filtros compartidos, foco y ambos replays20/2/2 y0/22/2:20 eventos/8 vehículos/4 alertas/43 mensajes, sin pendientes. El caso adversarial posterior tuvo una expectativa incorrecta de ID completo en un tooltip resumido; se corrigió usando una identidad HTML compacta, conservando la comprobación íntegra e inerte del payload.

El recorrido adversarial corregido pasó: mismo elemento de marcador y foco ante SSE, encuadre estable, tardío sin desplazar latest, Enter/espacio, fallo de tiles con historial y actualizaciones disponibles, reintento manual, CSP que bloquea otro origen, texto HTML inerte, ancho360px, latitud90 sin modificación y destrucción al cerrar sesión. Los tiles usaron referente de origen, sin cookie de Nexo, clave de ingesta o CSRF. Los escenarios usaron tanto la página estándar como contextos explícitos del fixture de red controlada, sin solicitudes al proveedor público. La revisión del paquete incorporó los avisos de licencias generados por Angular; el caso oficial se repitió con ese nuevo control y pasó.

La auditoría de dependencias informó cero vulnerabilidades al fijar Leaflet y sus tipos. La imagen web final `sha256:207da4310f7dc1149a83dc4dbab7d6367c368d457663db6bbe02d01a40b8b083` y su Dockerfile completaron inventario y escaneo sin HIGH/CRITICAL ni detalles inconclusos. Formato/lint afectados y348 enlaces internos pasaron. No se reconstruyeron o escanearon otra vez las imágenes API/DB durante este incremento de UI.

Los recorridos generales locales se reservan al cierre E5. Estos resultados no acreditan todavía trayectoria, gráfico, proveedor real o entrega final. [Cartografía](cartography.md) explica configuración, procedencia y límites.

## Resumen interactivo — E5-I01 / #66

Pasaron tipos web y15 pruebas focalizadas de fachada/página en dos archivos. Verifican filtros AND, independencia por cliente, resumen global, transición de último estado, tardío que no lo revierte, snapshot con filtros conservados, limpieza de sesión y detalle oculto sin perder selección. El foco permanece en el botón de estado ante una actualización y vuelve a búsqueda al limpiar los filtros del detalle.

La revisión de primera carga añadió una comprobación de que los botones deshabilitados todavía no muestran ceros antes de confirmar la base. Sus cinco pruebas de página se repitieron y pasaron después del ajuste. Los recorridos integrados de las visualizaciones se incorporan durante E5; no se atribuyen al incremento pruebas de navegador posteriores al nuevo filtro ni otra ejecución local general.

## Aceptación local integral E4 — #64

La base funcional `f1f9331508a6a613e9c09abe42e463312bdbcdc8` completó el cierre local de CR-01: compilación,463 pruebas API,95 Angular,127 integraciones PostgreSQL/HTTP y16 Chromium, sin fallos u omisiones en sus resultados finales. Los casos oficiales conservan20/2/2 y0/22/2,20 eventos/8 vehículos/4 alertas e identidades originales; los adversariales usaron datos propios.

Se ejecutaron formato, lint, tipos, enlaces, fixtures y coherencia del esquema. El primer quality se detuvo en fronteras, como se documenta en #65; la corrección final pasó sobre263 módulos/962 dependencias. La ejecución general de controles CI pasó54 casos; después del ajuste final de fronteras se repitieron únicamente sus siete casos afectados, incluido uno nuevo. El inventario remoto actualizado será55, sin atribuir ese número a la ejecución local anterior. Workflows y Compose también pasaron.

La auditoría de dependencias informó0 vulnerabilidades. El historial disponible y los cuatro commits incrementales posteriores pasaron el escaneo de secretos; los cambios documentales finales se revisaron por separado. Las tres imágenes y tres Dockerfiles completaron sus inventarios y escaneos sin HIGH/CRITICAL. Se conservaron las mismas imágenes durante las pruebas: API `sha256:cd341b122f28c4f1ce7841f16bd8a137a169319cfab2c82976de8e95445e0126`, web `sha256:085b9c80a33c3553288e1cf0a5dd4886988ffac7b8489075cfa65eaf5321c28d` y PostgreSQL `sha256:63bdd19b7e400b9f71e2c9d91219cbdf33d8787e3faaf0d87ca15337e3f8bcfc`. Los resultados no acreditan capacidad de producción ni reemplazan los escaneos del candidato remoto.

La batería local completa se ejecutó al cierre de la épica; las correcciones posteriores repitieron solo las comprobaciones afectadas. [PR61](https://github.com/ngarayc/Nexo/pull/61) conserva QA, CI propio y promoción del nuevo origen. El CI de c97890e pasó antes463API/90Angular/125PostgreSQL/14Chromium con cinco artefactos revalidados; ese candidato anterior no acredita la interfaz ni las correcciones siguientes. La revisión humana y promoción de E4 a main siguen pendientes y no se reutiliza la aprobación de E3.

## Control de fronteras después de construir — #65

El primer cierre local E4 pasó formato, lint y tipos, pero se detuvo en fronteras por10 ciclos entre bundles generados de un build anterior. Se conservó el fallo. La primera corrección excluía salidas conocidas y pasó seis regresiones, pero otra negativa demostró que ocultaba una importación desde fuente web a servidor compilado. Antes de publicar se sustituyó por entradas explícitas de los tres directorios de fuentes, manteniendo las cinco reglas e inspección de sus dependencias. Los siete casos del analizador real comprueban ambas garantías.

Los primeros cinco casos negativos del comprobador propio suponían que la salida JSON retornaba un código distinto de cero; se corrigieron para comprobar sus violaciones estructuradas. Los fallos se conservaron y ninguna regla se modificó para aprobarlos. Los controles locales restantes del cierre continúan sin repetir las suites ya aprobadas.

## Interfaz de CR-01 — E4-I03 / #60

Pasaron tipos web y25 pruebas focalizadas en tres archivos: modelo de filtro, página y monitor. Una corrección de fixture dio un eventId distinto a la entidad de reemplazo; sus cuatro pruebas de página se repitieron y pasaron, sin alterar código de aplicación u oráculos.

El recorrido Chromium oficial pasó: dos clientes, selector de flota independiente de búsqueda, teclado, foco,2/4 y0/4, equivalencia GET/POST, enlace al evento y ambos replays20/2/2 y0/22/2 con20 eventos/8 vehículos/4 alertas. Un segundo recorrido adversarial pasó tras corregir #63: texto literal, ID extenso/NUL/sustituto, ancho360px, SSE coincidente/no coincidente, duplicado, reconexión con filtro conservado y limpieza al volver a ingresar en la misma aplicación. Se mantuvo un único stream por cliente y ninguna consulta de alertas por selección. Las pruebas unitarias cubren además selección ausente y sustitución de snapshot.

La aceptación integral local de cierre #64 y los controles remotos del candidato actualizado se registran por separado. Las aprobaciones de EP-03/E3 no aprueban este cambio.

## Identidades comprimidas — #63

El recorrido adversarial de interfaz CR-01 detectó un timeout al enviar un segundo evento del mismo vehículo con ID de más de70 000 caracteres, NUL y un sustituto aislado. PostgreSQL estaba ejecutando `UPDATE vehicle_latest`; no había terminado de clasificar ese lote. El fallo se conservó y no se trató como rechazo de dominio ni ausencia de efectos.

La reproducción SQL confirmó compresión real y `57014` con un plazo de1500ms al validar el dato almacenado mediante la función anterior. La migración0004 materializa una copia antes del recorrido, conservando las reglas. Pasó una prueba de migración/repetición que mantiene OID, propiedades, datos y CHECK; pasaron dos casos focalizados de canonicalidad y actualización persistente. La repetición del navegador pasó sin reducir el ID ni ampliar timeouts: dos clientes, alertas coincidentes/no coincidentes, duplicado, desconexión/snapshot, selección conservada y limpieza al cerrar sesión. [Persistencia](persistence.md) explica la causa y fuentes.

Es un defecto anterior al filtro, descubierto por la aceptación visual posterior. No cambia parches originales ni sus resultados comparativos. La imagen corregida y el candidato publicado requieren sus controles propios antes de promover.

## API de CR-01 y comparación — E4-I01/I02

[#57](https://github.com/ngarayc/Nexo/issues/57) fijó base y condiciones; [#59](https://github.com/ngarayc/Nexo/issues/59) incorpora GET filtrado y POST JSON. [El ciclo](agent-cycles/CR-01.md) y [la comparación](../AGENT-EFFICIENCY.md) conservan parches e integridad, criterios y límites. Las dos propuestas se aplicaron/verificaron secuencialmente sobre el mismo árbol: ambas pasaron tipos, sus dos casos PostgreSQL/API/proxy y los cinco recorridos comunes. La general pasó16 pruebas de aplicación/HTTP y la focalizada19; esos inventarios diferentes no son una métrica de superioridad. Ninguna propuesta necesitó correcciones de código o pruebas. El primer recorrido adversarial focalizado terminó en EPIPE y la repetición puntual pasó; su causa quedó indeterminada y se conserva el fallo.

La consolidación usa la consulta general de una sentencia y el lector JSON compartido focalizado. Pasaron tipos y16 pruebas de los dos archivos afectados. La imagen API `sha256:7ac8eb60f564b224ba11eaa31e70c78dcaf7dfddf722807f3b9cf234856da067` se construyó para ese refinamiento. El primer caso de integración terminó con error del ejecutor interno sin detalle capturado; una repetición con diagnóstico pasó sin cambiar aplicación. Un ensayo acotado de80 rechazos de cuerpos2MiB+1, por API/proxy en historial y alertas, obtuvo413 en todos sin reproducir el fallo. No se atribuye causa al intento original ni se lo presenta como aprobado. Formato posterior es mecánico; el CI propio construye y comprueba el candidato publicado completo.

Lint de archivos afectados, enlaces y validación estructural OpenAPI oficial pasaron; el inventario AST coincide con las17 operaciones y33 esquemas descritos. No cambian fixtures, esquema, dependencias, Angular, SSE o políticas de acceso. El verificador de enlaces incluye ahora el nuevo informe raíz. Las pruebas locales fueron focalizadas; la batería local completa se reserva al cierre E4. En ese incremento de API aún quedaban pendientes UI #60, aceptación integral y revisión humana; ninguna aprobación anterior los acredita.

La primera publicación db75242 de esta API tuvo [CI propio39828497893](https://github.com/ngarayc/Nexo/actions/runs/39828497893) fallido: el trailer Refs terminaba en punto y el parser vigente lo rechazó correctamente. Calidad de fuentes pasó antes de esa comprobación; unidad/integración/sistema no se ejecutaron y no se acreditan cinco artefactos. [#62](https://github.com/ngarayc/Nexo/issues/62) admite un punto final opcional conservando números y comprobación de issues reales, con pruebas de formatos válidos/adversariales. El candidato corregido conserva sus checks propios; no se presenta el intento anterior como aprobado.

## Promoción integral de E3 a main

[PR58](https://github.com/ngarayc/Nexo/pull/58#issuecomment-6346716237) promovió la fuente `de7fdb03b398ca5c35ae14bc5378b85a2c430ff8` a test `99912bf0ab4520767edb3150bbdb3ea0cf2bddbe`, árbol `5d86c1abdabd4d0e76d3432c509050662b6da9b4`, tras [CI propio39817992331](https://github.com/ngarayc/Nexo/actions/runs/39817992331), intento1, y cinco artefactos descargados/revalidados para checkout `bbb186657614f5d5ee1717977ad2a5fe524d84aa`:458API/90Angular/123PostgreSQL/14Chromium.

[PR51](https://github.com/ngarayc/Nexo/pull/51#issuecomment-6347135921) integró ese árbol en main `e0f298f8960f8f8baf35dd783ac227f882d32c85`, después de aprobación efectiva de ngarayc en [main-review39820865479](https://github.com/ngarayc/Nexo/actions/runs/39820865479). [CI propio39820865413](https://github.com/ngarayc/Nexo/actions/runs/39820865413), intento1, pasó con cinco artefactos revalidados para checkout `9839e93507c67140b921135bb3432049e74cef06`, fuente99912bf y los mismos inventarios.

[Post-main39823965751](https://github.com/ngarayc/Nexo/actions/runs/39823965751), intento1, también pasó sobre el merge e0f298f; sus cinco artefactos se descargaron/revalidaron con458API/90Angular/123PostgreSQL/14Chromium, sin fallos u omisiones y con los seis jobs aprobados. Acredita motor, panel, reset, aceptación integral y corrección de metadatos de #56. Se cerraron #42/#49/#52/#55/#56 y el milestone E3, con sus nueve issues completadas. E4/E5/E6 conservan trabajo propio; no existe todavía video final ni tag entrega-final.

## Aceptación integral del núcleo — E3-I06 / #55

La [guía reproducible](demo-guide.md) conecta el comando de reset, controles del motor, dos clientes Angular e informes. La validación local completa de cierre E3 pasó una vez: calidad, compilación, **458 API, 90 Angular, 123 integraciones, 47 controles de CI y 14 Chromium**, sin omisiones. Auditoría de dependencias: 0 vulnerabilidades; escaneo del historial: 0 secretos. Los cambios documentales posteriores a esos comandos se comprobaron con formato/enlaces afectados, sin repetir las suites generales.

Se usaron las tres imágenes reconstruidas: API `sha256:b42f8e5ef64cc86dcef36978140389c4c9bc0a6b6ff7b121ccad21a4875e6400`, web `sha256:c669959753b4152cc4ff84cc0b4d1a361e65f9589a363e0ad1a737bd2dfa7993` y PostgreSQL `sha256:63bdd19b7e400b9f71e2c9d91219cbdf33d8787e3faaf0d87ca15337e3f8bcfc`. Los tres escaneos y tres Dockerfiles completaron el inventario estricto sin HIGH/CRITICAL o detalles ausentes y con identidad contrastada. Esta web incluye la protección de respuesta POST tardía.

El [recorrido ampliado](../tests/system/replay-panel.spec.mjs) crea una observación previa por HTTP, ejecuta el mismo reset local documentado y comprueba vacío antes de abrir dos sesiones distintas. El par lo envía el motor desde controles Angular: pausa conserva recibos/intentos sin nuevos envíos y ambos dashboards siguen En vivo; reanudación termina 20/2/2 y reinicio sin reset 0/22/2. Contrasta ambos oráculos,20 eventos/8 vehículos/4 alertas, historial y estados de los ocho, identidades de aceptados/alertas,48 recibos completos correlacionados y43 UUID iguales en ambos clientes con 20 telemetry.accepted/19 vehicle.updated/4 alert.created. El segundo conserva la huella de las cuatro tablas de dominio/outbox y el primer informe; el cierre de escenario se muestra separado. El caso anterior de panel se amplió, sin duplicar otra reproducción de sistema.

| Garantía separada del par             | Evidencia existente incluida en el inventario                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reinicio parcial y API interrumpida   | [Control HTTP](../tests/integration/replay-control.test.mjs): conserva resultados, marca inconcluso y no reanuda solo                                                           |
| Respuesta HTTP/COMMIT perdidos        | [Fallos del actor](../tests/integration/replay-control-faults.test.mjs) y [diario](../tests/integration/replay-journal.test.mjs): barrera real, resultado incierto sin reenvío  |
| Interferencia y lectura no disponible | [Verificador](../tests/integration/replay-verification.test.mjs): estados SQL controlados, recibo ajeno incluso sin cambios de dominio; no se presenta como otro renderizado    |
| Historial/capacidad y retención       | [Diario](../tests/integration/replay-journal.test.mjs): paginación exacta y límite 1000 con 24 posiciones reservadas                                                            |
| Reset/archivo/reanudación             | [Ensayo Docker](../tests/integration/reset-local.test.mjs), [política](../tests/integration/reset-policy.test.mjs) e [integridad](../tests/integration/reset-evidence.test.mjs) |

La revisión agregó una protección de configuración: el manifiesto vincula también el Compose expandido, por lo que cambiar WEB_PORT heredado del proceso impide reanudar antes de tocar el destino. La integración completa probó ese rechazo y la posterior recuperación con la configuración original. Los servicios habituales permanecieron intactos; los ensayos usaron y limpiaron exclusivamente recursos sintéticos propios.

La promoción y revisión humana de este cierre E3 están acreditadas arriba. Cada candidato posterior conserva sus propios checks y revisión. E4 mantiene selección visual/aceptación/revisión del filtro, E5 visualizaciones y E6 video/copia limpia/tag y el total estimado del autor pendientes. No existe todavía el video accesible ni tag entrega-final.

## Panel compartido — E3-I04 / #49

El [panel](replay-panel.md) tiene contrato compartido, adaptador, fachada y presentación sobre el EventSource existente. Pasaron las verificaciones locales focalizadas por cambio: validación/transporte/sincronización, nueve casos de fachada, tres de presentación y el caso afectado del shell. No se ejecutó toda la suite local de Angular por este incremento. Tipos compartidos/API/Angular y lint de los archivos afectados se contrastaron separadamente.

La imagen web `sha256:a5faba10b88c8a6d34b8833964056b857e0a4c672b094ea3ab8a872470a34528` y API `sha256:a797c07fd9ba4bc5a31cdf5fab8d16b08f0d5fbadd743cb822cf40a257f7996b` pasaron [un recorrido focalizado Chromium](../tests/system/replay-panel.spec.mjs) con dos aplicaciones renderizadas. Comprobó control real, pausa sin nuevas ingestas, reanudación, navegación/minimización, ambos oráculos, identidades y 43 mensajes de dominio, teclado/inspector, informes separados, selección histórica con 20/2/2 conservado, recarga recuperando 0/22/2, logout independiente y 360 px. El reporte se validó contra el archivo/caso real, sin retries u omisiones. No equivale a ejecutar todos los recorridos Chromium ni a cerrar reset/entrega final.

La primera compilación de la fachada detectó un opcional con undefined explícito; se estrechó el tipo sin relajar exactOptionalPropertyTypes. Lint detectó el manejador de teclado en un contenedor sin foco: se trasladó a los botones de las pestañas, conservando flechas/Home/End y repitiendo únicamente los casos afectados. La presentación mantiene Pendiente mientras no exista informe individual conservado.

## Reset local — E3-I05 / #52

El [comando local](demo-reset.md) añade identidad de proyecto/volumen, etiqueta sintética, captura fuera de Docker, comprobación SHA-256, detención ordenada y reanudación por manifiesto. Pasaron seis comprobaciones focalizadas de argumentos, destino, consumidores e integridad de archivos y un ensayo real Docker de reset. No se ejecutó la regresión local completa por esta issue.

El ensayo creó su propio proyecto y datos mediante el motor HTTP real, conservó un informe conforme y probó consumidor ajeno, fallo de escritura del destino de evidencia, fallo después de cerrar la aplicación y respuesta perdida tras retirar el volumen. La reanudación recreó una base vacía con migraciones/cuenta/salud, instancia API nueva y sesión anterior inválida. Reanudar otra vez no borró datos nuevos; el volumen ajeno y los informes anteriores quedaron intactos durante el procedimiento. El cleanup final retiró únicamente recursos sintéticos creados por la prueba.

Los primeros intentos detectaron una referencia de archivo equivocada, una espera del fixture que confundía finalización con informe listo y una expectativa401 que debía ser403 según el contrato de acceso existente. Se corrigieron y repitió solo el caso afectado; el último aprobó sin omisiones. Las imágenes locales ya construidas sirvieron para este procedimiento host/Compose: no se reconstruyeron API/Angular porque no cambió su código. CI de promoción conserva su ejecución propia y el cierre integral E3 sigue pendiente.

## Cierre comprobado de E2

[PR45](https://github.com/ngarayc/Nexo/pull/45#issuecomment-6343260777) se integró en main5bb7612e778e3b41b258e77b1cd9615e8d449417 tras aprobación real de ngarayc en main-review39791521046 y CI propio39791521071 intento2, mismo checkout1a576c865cc80851224f64c11e91f5570d374bf6. Cinco artefactos propios descargados/revalidados:397API/70Angular/107SQL/13Chromium. El intento1 fallido al consultar metadatos se conserva; su causa HTTP exacta no quedó demostrada. La repetición completa mantuvo fuente y controles.

[Post-main39796147682](https://github.com/ngarayc/Nexo/actions/runs/39796147682), intento1, también pasó con cinco artefactos revalidados para ese merge, los mismos inventarios y árbol idéntico al candidato. Se cerraron las seis issues y milestone E2; la base EP-03 cuenta con revisión humana real. #38/#40 y las correcciones #43/#46/#48 también alcanzaron main. #44 cerró la investigación y observabilidad con causa histórica indeterminada; no se presenta como un fallo de transporte reparado.

[PR50](https://github.com/ngarayc/Nexo/pull/50#issuecomment-6344180050) promovió el motor posterior09f6747 a test a9e87ff5abe3b901c428d0a80e39a673ef2fa83f después de CI propio39798378152 intento1 y cinco artefactos revalidados:458API/70Angular/116SQL/13Chromium. Es un candidato distinto de E2/main5bb; el panel de #49 conserva su verificación y promoción propias.

## Motor compartido y control HTTP — E3-I03 / #42

El incremento compone NestJS, acceso, recursos compartidos, diario, verificador y SSE. Pasaron las 454 pruebas API existentes al completar esa composición. Después se añadieron y ejecutaron por separado cuatro pruebas focalizadas de publicación: modo deshabilitado sin carga de material, lectura compartida con suscriptores, fallo sin publicar caché antigua y época SSE independiente de instancia API. No se repitió toda la suite por ese añadido. Tipos de API y lint de los archivos afectados pasaron.

La imagen `sha256:a797c07fd9ba4bc5a31cdf5fab8d16b08f0d5fbadd743cb822cf40a257f7996b` pasó los tres casos de [control real](../tests/integration/replay-control.test.mjs) y los seis de [fallos del actor](../tests/integration/replay-control-faults.test.mjs). Comprueban par oficial HTTP 20/2/2 → 0/22/2, pausa/reanudación, simultaneidad, informes e historial, reinicio parcial y de API, COMMIT antes/después de confirmación, barrera desconocida, respuesta perdida y ausencia de reenvíos. Los dos streams Node son evidencia de transporte compartido, no de renderizado Angular.

También pasaron los cinco casos focalizados de [recuperación HTTP](../tests/integration/recovery-http.test.mjs), necesarios por el turno de escritura compartido entre diario y recuperación: fallo transitorio, agotamiento concurrente, caída antes del commit, SIGTERM con trabajo activo y cuotas independientes de lectura/ingesta. La imagen completó el escaneo estricto Alpine/Node sin HIGH/CRITICAL o detalles ausentes; su ID fue contrastado con el reporte. Las migraciones y fixtures permanecen intactos. OpenAPI pasó validación estructural oficial con 33 esquemas y el inventario AST coincide con las 16 operaciones implementadas.

La primera ejecución unitaria de la composición encontró dobles antiguos de bootstrap/sesión que no incluían DemoModule y un Buffer que Superagent serializaba como JSON. Se conservaron los fallos, se aisló el módulo ajeno al alcance de esas suites y se envió UTF-8 inválido como bytes reales. Los controles efectivos de sesión, origen, CSRF, cuota y parser permanecieron; las suites corregidas pasaron.

La regresión local general iniciada después se interrumpió antes de terminar, sin resumen aprobatorio. A partir de este incremento, el desarrollo local ejecuta verificaciones focalizadas según el cambio y reserva la validación completa para cerrar una épica. Los workflows y controles de GitHub conservan sus ejecuciones completas; los resultados remotos de cada promoción se comprueban por separado. El panel, reset seguro, dos clientes renderizados y cierre E3 siguen pendientes.

## Aprovisionamiento de Chromium — #48

El [CI propio de PR47, 39784174425](https://github.com/ngarayc/Nexo/actions/runs/39784174425), origen b641ee9, pasó calidad, unidades, seguridad e integración 107/107, pero agotó 600 segundos durante descargas apt de fuentes/libglib en install --with-deps, antes de ejecutar navegador. El push 39784168398 del mismo código pasó. Ambos resultados permanecen diferenciados; el push aprobado no reemplaza la PR fallida. Los fallos de aprovisionamiento anteriores también se conservan.

La preparación nueva descarga el shell fijado y comprueba el navegador real antes de instalar dependencias del sistema. Pasaron los 43 controles de CI, incluidos seis nuevos; el probe local abrió Chromium y comprobó DOM. Una comprobación negativa rechazó explícitamente deshabilitar la validación nativa. No se instalaron paquetes del Ubuntu local para estas verificaciones. El CI del candidato corregido debe repetir el inventario completo y producir sus cinco reportes antes de promover.

## Componentes del emisor — avance parcial E3-I03 / #42

Pasaron 397 pruebas unitarias de API, sin omisiones: las 340 anteriores más 27 de comandos/recibos, 22 del adaptador y 8 de temporización. Los 13 casos SQL del diario pasaron con la API `sha256:e6462a70922abf9a4cde14f2a22160817123c74cfab8e86684739cc7cd958030`. El nuevo cierre terminal falló inicialmente porque el caso omitía closeCode obligatorio; se completó el caso sin alterar la restricción SQL. Pérdidas de respuesta antes/después de COMMIT y espera real de la barrera quedaron comprobadas.

Los dos casos del adaptador HTTP real pasaron sobre esa misma imagen: 48 líneas originales, resultados 20/2/2 y 0/22/2, recibos exactos y dominio 20/8/4 con 43 mensajes; respuesta perdida después del procesamiento sin otro envío y clave inválida sin admisión. La primera comparación SQL del nuevo caso usaba igualdad sobre json, operador inexistente; se corrigió a comparar su representación textual exacta, manteniendo los documentos originales. Los estados de diario y el adaptador se verifican separadamente: este recorrido no demuestra todavía ritmo visual, comandos compartidos o panel.

La imagen posterior `sha256:6c1c876eff10ada0967a8eac357fc3bf6e3750bbc2a6af35ccb7a896bf4b3d33` incorpora también ReplayEmitter y pasó los 107 casos de integración, incluidos 10.000 eventos HTTP y su repetición, y los 13 recorridos Chromium. Su escaneo Alpine/Node completó el inventario sin HIGH/CRITICAL o detalles ausentes; la barrera estricta comprobó el reporte y su identidad. API/web/DB conservaron los mismos digests entre escaneo y pruebas. Pasaron calidad completa, cuatro fixtures, coherencia del esquema y 37 controles de CI. Estos resultados corresponden a la base del emisor, sin el borrador posterior del coordinador; el CI de promoción conserva su ejecución propia. [Emisor](replay-emitter.md) describe el alcance y pendientes.

El [CI propio de PR #41, 39775782259](https://github.com/ngarayc/Nexo/actions/runs/39775782259), intento 1, pasó para origen4230ff6856aa32e926aaca18f56f1371dc756b14 y checkoutcaeeb2a4c0dd0982e5786cf42c3a6dc54fd48561: cinco reportes descargados/revalidados, 340 API / 70 Angular / 102 integración / 13 Chromium. El push39775772883 agotó600s instalando dependencias de Chromium antes de ejecutar navegador, con integración102/102 aprobada. Su primer intento permanece fallido. El intento 2 completo pasó y sus cinco artefactos también se descargaron/revalidaron para el mismo origen, con 340 API / 70 Angular / 102 integración / 13 Chromium. PR41 se integró en test como3f4c8c7d56baa5fb845fabfd627af105c3ccffaa, con árbol idéntico al candidato4230ff6. El diagnóstico de presión #44 no cambia este fallo de aprovisionamiento ni afirma resuelta su causa histórica.

## Diagnóstico de presión SSE — #44

El [push39770957324](https://github.com/ngarayc/Nexo/actions/runs/39770957324) falló en realtime-pressure.test.mjs sobre05e12c8, mientras la [PR39770961770](https://github.com/ngarayc/Nexo/actions/runs/39770961770) del mismo código terminó satisfactoriamente. El runner anterior no conservó la etapa del fallo. Ese resultado fallido permanece visible; el verde paralelo no demuestra su resolución.

La investigación repitió el caso tres veces en stacks nuevos con las imágenes parcheadas de #43:3/3pasaron, además de la regresión completa102/13ya descrita. No se reprodujo la causa original y no se atribuye su ausencia al parche de libc. La investigación/observabilidad de #44 se cerró con esa limitación según sus criterios condicionales: el código4230ff6 y sus tres negativas ya están promovidos a main5bb bajo la revisión y CI de PR45. No se declara resuelto un defecto de transporte de causa desconocida; un nuevo fallo conservará ahora su etapa para investigarlo. Se añadió diagnóstico seguro de etapas, comprobado con la causa real de una aserción de Node y pruebas de rechazo de textos no permitidos. Los controles del CI pasan de34a37. No cambia la carga de128eventos/384mensajes, presupuestos del servidor, tiempos o aserciones, ni se introducen reintentos automáticos.

La causa del fallo original sigue sin determinarse. Una nueva ejecución que falle conservará la etapa admitida cuando esté disponible y seguirá bloqueando la promoción; un candidato debe pasar su propio inventario y cinco reportes, sin sustituirlo por otra ejecución verde. [CI](ci-controls.md) describe el límite del diagnóstico y la publicación.

## Corrección del feed incompleto y musl — #43

El aviso registrado durante #40 se investigó en las fuentes del proveedor: musl/musl-utils1.2.6-r2 estaban presentes en API/web/DB y Alpine3.24 publicaba1.2.6-r3 como corrección. Se actualizaron paquetes fijados sin cambiar versiones/digests base o controles de ejecución. La nueva barrera de CI rechazó el reporte real anterior, que devolvía0 pero carecía de detalles de vulnerabilidad. Los34controles del pipeline pasaron, sin omisiones.

Las imágenes reconstruidas y escaneadas completaron inventario y no reportaron HIGH/CRITICAL ni detalles ausentes: API `sha256:b6612fb7f2562163db3e4e776354b22fbd2d108f2ef603813cfe0a6821fabe9b`, web `sha256:8484a7f0c25cfbb30eb680224a4c37493871e7a9441c0d2ffccec84c025013a5` y DB `sha256:a703efe740a6bc34fe154b9b008431a57ce3bb6392879ebad0053bd80240519c`. Se comprobaron ambos paquetes1.2.6-r3 y la correspondencia con los digests de Docker. La regresión y el CI de este candidato se verifican por separado; las pruebas anteriores de #40 no se atribuyen a estas imágenes.

Esta comprobación corrige una carencia de la evidencia del escáner, sin afirmar una severidad o rechazo del CVE que el feed no aportó. [Seguridad](security.md) enlaza las fuentes primarias. Los logs/JSON crudos permanecen fuera de Git y de los artefactos publicables.

La regresión de esas mismas tres imágenes pasó102casos de integración y13Chromium, sin omisiones; sus digests permanecieron idénticos a los escaneados. Incluye inicialización/Argon2, preservación/upgrade, recepción/cola, recuperación, consultas/SSE, diario/verificador y10.000eventos más repetición. Los tres Dockerfiles pasaron20controles de configuración cada uno, con0fallos. La promoción conserva QA y CI propios del nuevo candidato; un verde de05e12c8 no sustituye esas comprobaciones.

## Preparación y comparación del replay — E3-I02

La [issue #40](https://github.com/ngarayc/Nexo/issues/40) incorpora el [verificador](replay-verification.md) sobre el diario #38. La calidad completa pasó con340pruebasAPI y70Angular; los31controles del pipeline permanecen aprobados. Fuentes originales y esquema/snapshots se conservaron, sin omisiones o exclusiones nuevas.

La regresión inicial pasó102casos de integración y13Chromium. La revisión añadió después el cotejo de la identidad del intento y del evento referenciado por cada recibo. La imagen API final `sha256:b51dcff7583547a6000f6bfa05fc723b04c040df64dcc7ab247a532ae33a5205`, reconstruida con ese ajuste, volvió a pasar los9casos PostgreSQL del verificador y los13recorridos Chromium. No se atribuye la ejecución anterior de102casos a esa imagen posterior: el CI del candidato reconstruye el inventario completo desde su checkout e identifica sus propios resultados/imágenes.

Los casos nuevos comprueban fuentes empaquetadas, código identificado, preparación con jobs preparados/activos, dos conjuntos controlados20/2/2→0/22/2, contenido/identidades, historial, estados, alertas,43mensajes, recibos ajenos, lectura concurrente, inventario incompleto e indisponibilidad. El escenario de identidad errónea ingresa el dato incorrecto desde el principio; no desactiva la inmutabilidad SQL. La carrera confirma un recibo/job durante la lectura: ambos quedan fuera del primer snapshot y aparecen en el siguiente.

Estos estados controlados usan recepción/clasificación y diario reales, pero no el futuro emisor HTTP. La publicación se marca sintéticamente para comparar datos: no acredita SSE emitido, pausa/reanudación o dos clientes renderizados por el motor. Informe y comparación conservan ese alcance. Los recorridos de navegador existentes conservan su propia evidencia E2.

La imagen terminó su escaneo Alpine/Node sin hallazgos HIGH/CRITICAL reportados y npm audit informó0vulnerabilidades. El feed de Trivy emitió un aviso de detalles ausentes para CVE-2026-107891, también al consultar su repositorio primario; se conserva esta limitación sin afirmar un estado o severidad para ese identificador y sin añadir exclusiones. Los checks/artefactos del candidato mantienen su validación independiente y los límites de la [política de CI](ci-controls.md).

La [PR #41](https://github.com/ngarayc/Nexo/pull/41) reúne diario y verificador. Sus checks y evidencia remota deben atribuirse a cada SHA efectivo; aprobación del plan, pruebas locales y QA del agente no sustituyen revisión humana de main. Motor, contratos públicos de control, panel, reset e integración final continúan pendientes E3.

## Diario del reproductor — E3-I01

La [issue #38](https://github.com/ngarayc/Nexo/issues/38) pasó calidad, **290 pruebas API, 70 Angular, 93 de integración y 13 Chromium**, sin omisiones. La imagen API reconstruida y utilizada por esos recorridos pasó Trivy sin altos/críticos; web conserva su código/imagen revisados. Las cuatro fuentes mantienen sus hashes. Este incremento incorpora el diario; no acredita todavía motor, controles HTTP, verificador oficial, panel o reset.

Diez casos nuevos usan PostgreSQL real: relaciones/permisos/identidad, intención durable, respuestas/cursor en el mismo commit, pausa en la última línea, dos coordinadores con conexiones independientes, rollback inducido entre escrituras, recuperación de pausadas/en curso, diagnóstico permitido, historial con microsegundos y capacidad exacta de 1.000 ejecuciones. La migración desde el esquema publicado 0002 conserva cuenta/hash/telemetría/proyección/alerta comparados en memoria; repetir preparación tampoco los cambia. Los informes individuales y del escenario permanecen separados. Sus clasificaciones e informes controlados prueban políticas SQL, sin presentarlos como 24 envíos HTTP o conformidad oficial.

La primera integración completa falló en dos casos antiguos de recuperación. Su fixture construía el esquema E1 con dos migraciones y llamaba al preparador actual, que ahora exige las tablas nuevas: se observó SQLSTATE42P01, ausencia de replay_runs y solo dos migraciones aplicadas. Ese fallo dejaba el caso siguiente sobre el esquema anterior. La preparación histórica se realiza ahora explícitamente con su seed/permisos originales y se usa el preparador actual al verificar el upgrade. Los nueve casos de recuperación corregidos pasaron; después pasó la integración completa de 93 y el recorrido Chromium. No se condicionaron los grants del producto a que existieran tablas, ni se cambiaron oráculos o cuotas para aprobar.

[Diario durable](replay-journal.md) relaciona código, transacciones, recuperación, costes y fuentes. El CI de su promoción verifica el candidato limpio; una revisión técnica o prueba del diario no completa el reproductor obligatorio. La revisión humana de la base E2/EP-03 conserva su PR/candidato propios.

## Consolidación documental del dashboard — E2-I06

La [issue #36](https://github.com/ngarayc/Nexo/issues/36) actualiza README, arquitectura, operación, reproducibilidad y API para describir flota/historial/alertas ya disponibles. [Trazabilidad](traceability.md) relaciona obligaciones, implementación, pruebas y pendientes; mantiene reproductor, CR-01, complementos y cierre final separados. La revisión del AST de controladores contrastó las catorce operaciones reales con OpenAPI, incluyendo su prefijo de servidor; no hubo diferencias ni cambios de endpoints.

Pasaron calidad completa, enlaces y hashes de fixtures. Este incremento modifica documentación; los resultados funcionales siguientes conservan sus fuentes y candidatos propios. El CI de su promoción ejecuta las regresiones del nuevo candidato y la PR registra sus cinco artefactos exactos. EP-03 conserva base identificable sin filtro y revisión humana pendiente hasta la intervención efectiva sobre la PR a main. No se declara E2 cerrado antes de comprobar esa promoción ni se atribuye la comparación CR-01 a este trabajo.

## Dos clientes, carreras y recuperación — E2-I05

La [issue #35](https://github.com/ngarayc/Nexo/issues/35) pasó calidad y **13 pruebas Chromium**, ninguna omitida, junto con los 31 controles de CI. API/web productivos, dependencias y esquema conservan el incremento anterior; CI del nuevo candidato reconstruye y comprueba también sus regresiones. Los cuatro fixtures conservan sus hashes.

Dos contextos con SIDs independientes reciben exactamente los mismos 43 UUID de dominio. El fixture se envía en su orden original: 20/2/2 y después 0/22/2 sin reset entre pasadas. Ambas vistas conservan ocho vehículos, cuatro alertas, siete MOVING y uno STOPPED. Se comparan las ocho proyecciones, los historiales de los veinte eventos y las identidades de alertas; SQL confirma 20/8/4 y 43 mensajes publicados. Cada aplicación mantiene una conexión y su búsqueda propia; navegar no abre otra.

Las carreras conservan respuestas obtenidas de HTTP real: un commit posterior al snapshot retenido llega por SSE antes de instalarlo y permanece en la vista; lo mismo ocurre con un tardío durante historial. Cambiar de A a B aborta la solicitud anterior y no cruza su contenido. Las pruebas unitarias anteriores verifican además que una respuesta que ignore abort tampoco supere la generación de selección.

Un intermediario de prueba corta sockets del SSE de A, conserva sus datos marcados como desactualizados y permite que B siga progresando. Restablecerlo recupera el evento perdido con una sola conexión activa. Un trigger propio impide marcar la outbox: salud pasa a503 y ambas aplicaciones retiran En vivo, pero se admite otra ingesta. Retirar el fallo recupera salud, cuatro vehículos y tres alertas. Logout limpia A y revoca su SID; B conserva acceso y recibe el quinto evento. Volver a ingresar A recupera la base sin conexiones antiguas activas.

Se conservaron fallos reales del desarrollo de las pruebas: esperar solo la cantidad de filas podía observar todavía el historial anterior de igual tamaño; se espera ahora su contenido exacto. Activar offline no cortó un SSE existente dentro de cinco segundos, por lo que el escenario usa un corte explícito y observable de sockets. La primera variante del intermediario cambiaba el host y recibió403; conservar localhost permitió mantener el acceso sin modificar políticas productivas. Los recorridos corregidos pasaron; no se alteraron oráculos ni cuotas.

Cada archivo parte de recursos sintéticos nuevos y limpia solo su stack. Los diagnósticos crudos se conservan localmente por invocación y no se publican. Reproductor controlable, CR-01 y entrega ampliada permanecen pendientes; estas pruebas no los acreditan.

## Promoción de alertas base a test

La [PR #34](https://github.com/ngarayc/Nexo/pull/34) se integró en `499f2604b136a4fb44927e9d9117ee85d2b29162` tras [CI propio 39741133553](https://github.com/ngarayc/Nexo/actions/runs/39741133553), intento1, y [QA](https://github.com/ngarayc/Nexo/pull/34#issuecomment-6335780884). Sus cinco artefactos descargados/revalidados pertenecen al checkout `465212b82b67613cda584ad7d3942d63d3df8b44` y origen `0f780a576530896b35a7142052cec4bfb3da660d`: 265 API, 70 Angular, 83 integración y 10 Chromium, con escaneos y ci-required aprobados. La revisión humana de EP-03 permanece pendiente de la promoción a main del candidato concreto.

## Alertas base — E2-I04 / EP-03

La [issue #33](https://github.com/ngarayc/Nexo/issues/33) pasó calidad, **70 pruebas Angular y 10 Chromium**, sin omisiones. La imagen web del incremento se reconstruyó y pasó Trivy sin altos/críticos. API, núcleo, esquema y dependencias conservan la base verificada; CI del candidato ejecuta sus regresiones completas. Los cuatro fixtures mantienen sus hashes.

La prueba real de alertas crea 80, 81, tardío95 y 81 apagado: aparecen tres alertas en orden descendente y latest conserva el81 más reciente. Repetir los cuatro produce cuatro duplicados; conflicto e inválido producen dos rechazos y no añaden alertas. El contador y lista permanecen globales aunque flota tenga una búsqueda activa. Ver evento destaca y enfoca el tardío original y luego el evento apagado de otro vehículo; la navegación conserva una sola apertura SSE y un snapshot. Una nueva observación por SSE inserta historial sin robar el foco de búsqueda.

Las pruebas de presentación distinguen carga/error de vacío y datos desactualizados. La selección de otro evento del mismo vehículo no repite HTTP; logout/revocación limpia el foco conservado. El chequeo estricto inicial detectó una referencia privada de efecto sin uso y se corrigió registrando el efecto DOM en el constructor, sin relajar tipos. [EP-03](agent-cycles/EP-03.md) conserva propuesta, workflows, cambios y evidencia; revisión humana y comparación de CR-01 mantienen su estado propio.

## Promoción de flota/historial a test

La [PR #32](https://github.com/ngarayc/Nexo/pull/32) se integró en `53e05a56cf53c9a85e2df489376793304877ac28` tras [CI propio 39736244549](https://github.com/ngarayc/Nexo/actions/runs/39736244549), intento 1, y [revisión técnica](https://github.com/ngarayc/Nexo/pull/32#issuecomment-6334948551). Los cinco artefactos descargados/revalidados pertenecen al checkout `442f8ac159f5f7db6041a610ac902b9115424f11` y origen `b2de2b66d3f8dd8cdbcb92e724f7d2a0a6ca6ed4`: 265 API, 66 Angular, 83 integración y 9 Chromium; jobs, ci-required y escaneos aprobados. Esta promoción a test no acredita una revisión humana nueva de main.

## Flota e historial visibles — E2-I03

La [issue #30](https://github.com/ngarayc/Nexo/issues/30) pasó calidad y **66 pruebas Angular y 9 Chromium**, sin omisiones, con la imagen web revisada reconstruida y sin vulnerabilidades altas/críticas en Trivy. El incremento cambia presentación/routing y pruebas de frontend; API, núcleo compartido, esquema y dependencias conservan el código verificado de E2-I02. El CI propio del nuevo candidato vuelve a ejecutar también sus regresiones.

Las pruebas comprueban contenido de tabla, estado, encendido, identidad original al seleccionar, Unicode/HTML como texto, distinción entre carga/error/vacío/desconocido y foco al cerrar una fila ya oculta por la búsqueda. Chromium verifica mayúsculas, `%` y `_` literales por identidades exactas, totales globales independientes, historial ascendente, tardío por SSE que no cambia latest, fecha/hora 24h de Bogotá, pantalla de 360 px y navegación por teclado. Otro recorrido usa IDs de 70.000 caracteres, un sustituto aislado, NUL y `.`/`..` mediante POST JSON real, con CSRF y sin API key; consulta la identidad exacta y desplaza su representación completa por teclado.

Se conservaron dos fallos de pruebas y sus correcciones. El primer supuesto de búsqueda por `_` omitía que el ID sintético de HTML también lo contenía; se contrasta ahora el conjunto exacto derivado de esos datos, manteniendo intactos los fixtures/oráculos oficiales. Un selector parcial de la fila B coincidía además con prefijos UUID aleatorios: se sustituyó por su encabezado de fila e identidad exacta. Las comprobaciones posteriores pasaron sin modificar el algoritmo de búsqueda.

La revisión detectó además un defecto real del adaptador: intentaba GET con NUL, que NGINX rechazó con 400. Se conservó la prueba roja que observaba ese GET y se cambió a JSON, conservando el valor. La comprobación del parser URL evita también que `.`/`..` cambien la ruta. Las pruebas posteriores pasan por el proxy y verifican historial/identidad; no se relaja NGINX ni la validación de dominio.

[Dashboard](dashboard.md) relaciona recorrido, código, fuentes y límites. Estos resultados no acreditan todavía lista de alertas base, dos vistas completas bajo fallos, reproductor o CR-01. La promoción mantiene checks/artefactos del SHA exacto y revisión humana propia de main.

## Promoción de la coordinación a test

La [PR #31](https://github.com/ngarayc/Nexo/pull/31) promovió `d44f429df8cb90fe31b403f18753340aa305f2d1` tras revisión técnica y [CI propio 39731905638](https://github.com/ngarayc/Nexo/actions/runs/39731905638), intento 1. Cinco artefactos descargados/revalidados del checkout `e60f6f0bfb9ba433f84350fa8c8c04a8d1e5d964`: 265 API, 59 Angular, 83 integración y 7 Chromium; cinco jobs, ci-required y escaneos aprobados. El merge en test es `932f8ed6ef03c6c963aff9b651d937ca751cc9d6`. La integración no sustituye la revisión humana de una futura promoción a main.

## Coordinación Angular — E2-I02

La [issue #28](https://github.com/ngarayc/Nexo/issues/28) pasó localmente calidad, **265 pruebas API, 59 Angular, 83 de integración y 7 Chromium**, sin omisiones. Se conservan los 31 controles de CI y los hashes de los cuatro fixtures. Auditoría de dependencias sin vulnerabilidades, historial/índice sin secretos y Trivy de las tres imágenes y tres Dockerfiles sin hallazgos altos/críticos. API/web revisadas se reconstruyeron y escanearon antes del último recorrido de navegador; CI reconstruye las imágenes propias del candidato publicado.

Las pruebas Angular controlan buffer antes de snapshot/historial, respuesta tardía de otra generación/selección, cancelación GET/POST JSON, repetición, instante subnanosegundo, empate Unicode, cinco reintentos, 30 segundos sanos, Retry-After, suspensión incluso antes de ready y revocación/cambio de sesión. La UI distingue carga/error inicial de totales confirmados; los datos previos se señalan como posiblemente desactualizados durante recuperación. El núcleo de identidad e instante se extrajo íntegro y conserva la regresión API.

Chromium accede a servicios reales: confirma la base, recibe por SSE un evento enviado por HTTP a través de NGINX y observa ambos contadores sin recarga. Logout y nuevo login recuperan la base con una apertura de stream por sesión; no se usa almacenamiento local/de sesión. El primer intento falló en el productor auxiliar: fetch no conservó el Host solicitado y el proxy respondió 421. La comparación con HTTP nativo produjo el 400 esperado para el mismo cuerpo inválido. Se cambió el cliente del test, manteniendo la validación de Host; el recorrido posterior pasó.

La nueva prueba de presión usa cuatro lectores pausados detrás de NGINX y otro lector activo. Este recibe 384 identidades de 128 eventos, mientras ingesta/salud progresan. Abrir cuatro reemplazos de la misma sesión demuestra que el servidor liberó los cupos lentos aun cuando esos lectores no hayan consumido EOF; PostgreSQL conserva los 128 eventos y 384 mensajes publicados. Este caso amplía la evidencia de [#26](https://github.com/ngarayc/Nexo/issues/26) sin atribuirlo al CI anterior de main.

[Sincronización](frontend-sync.md) describe código, fuentes, coste y límites. El recorrido verifica conexión y totales; tabla/historial visibles, lista de alertas y recuperación integral en dos navegadores mantienen sus incrementos propios. No acredita reproductor, CR-01, mapas o entrega final. La promoción requiere los checks y cinco artefactos del candidato exacto; la revisión técnica del agente no sustituye revisión humana de main.

## Promoción revisada de E1 y transporte SSE

La [PR #29](https://github.com/ngarayc/Nexo/pull/29) se integró después de la aprobación humana de main-review y [CI propio 39722541233](https://github.com/ngarayc/Nexo/actions/runs/39722541233), ambos sobre `0e24fb8288aa609a52e52452b00e026df30b073c`. Sus cinco artefactos se descargaron y revalidaron: 265 pruebas API, 4 Angular, 82 integración y 6 Chromium. El merge `79f5a8936731aa9da51ffd0aed31edc18d449a08` conserva el mismo árbol de Git que ese candidato.

[CI posterior 39724725974](https://github.com/ngarayc/Nexo/actions/runs/39724725974) pasó sobre ese merge y sus cinco artefactos se descargaron/revalidaron con los mismos conteos y escaneos aprobados. E1 cerró sus criterios e issues; esta evidencia acredita el backend SSE y las consultas. La prueba de presión por NGINX y la coordinación Angular incorporadas después requieren su propia evidencia.

## Bootstrap — E0-I01

Los resultados siguientes corresponden a la base inicial y no acreditan todavía la aceptación funcional completa de Nexo.

| Comprobación                  | Resultado local                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| Instalación mediante `npm ci` | Árbol instalado desde el lockfile, sin vulnerabilidades reportadas                          |
| `npm run quality`             | Formato, lint, tipos, fronteras, enlaces internos y hashes de los cuatro fixtures correctos |
| `npm run build`               | API NestJS y Angular compilados                                                             |
| `npm run test:unit`           | 12 casos de backend y 1 de Angular aprobados; ninguna suite vacía                           |
| Arranque API compilada        | HTTP 200 de `/api`, servicio inyectado y contenido esperado                                 |
| Arranque servidor Angular     | HTTP 200 y documento de la aplicación servido en loopback                                   |

La prueba de configuración cubre valores inválidos y límites de escucha; la de HTTP verifica inyección real de Nest. El frontend se comprueba mediante su builder y TestBed/router. El HTTP del servidor Angular no se presenta como prueba de un navegador completo.

## Condiciones que se incorporan después

CI remoto y acceso se documentan abajo; validación desde copia limpia pertenece a E0-I06. Ingesta, igualdad, concurrencia y consultas se incorporan en E1; navegador/SSE del dashboard en E2 y el reproductor oficial en E3. Cada capacidad conserva sus pruebas a partir de su incorporación.

La aceptación final mantiene el fixture original: primera pasada 20/2/2 y segunda sin reset 0/22/2, 20 eventos, 8 vehículos y 4 alertas, con sus identidades y orden. Estos resultados no se deducen del bootstrap ni se rellenan desde el oráculo. Los adversariales y la carga usan datos separados.

Las evidencias de CI y entrega identificarán el SHA comprobado, sus resultados y limitaciones. Un resultado de un commit anterior no se atribuye a un candidato nuevo.

## Persistencia y contenedores — E0-I03

Calidad y build de ambas aplicaciones aprobados; 21 pruebas unitarias de API y una de Angular. Las 12 pruebas de integración ejecutan PostgreSQL 18.6 y la API construida desde fuentes: migración desde vacío, cuenta única, seed repetido, restricciones SQL, permisos de runtime, entorno del proceso HTTP, desconexión/recuperación, tabla ausente, hash incompatible, recreación con persistencia, usuario eliminado y configuración inválida. Ninguna prueba omitida.

La primera ejecución detectó un montaje tmpfs interpretado como dos entradas; se corrigió su representación YAML. La siguiente identificó una validación frágil del orden de parámetros del hash Argon2; se sustituyó por `needsRehash` y verificación de contraseña de la biblioteca. Las comprobaciones posteriores pasaron sin modificar los valores exigidos para memoria, iteraciones o paralelismo.

El stack completo devuelve HTTP 200 de `/api`, `/api/health` y el documento Angular. Solo web publica `127.0.0.1:8080`; API/PostgreSQL permanecen en redes Docker. La consulta de salud desde Windows por `localhost:8080` también pasó. El documento recibe un nonce CSP coherente con su cabecera, sin `unsafe-inline`. Esto comprueba HTTP y configuración; el renderizado y seguridad de navegador se verificarán con el recorrido de sistema de E0-I04/I05.

La comprobación inicial de declaraciones de Drizzle falló con 73 diagnósticos de dependencias. La excepción explícita y su límite están documentados en [seguridad](security.md); no se presenta como reparación upstream. El árbol corregido pasó auditoría sin vulnerabilidades reportadas.

## CI remoto — E0-I04

[La ejecución 39552267643](https://github.com/ngarayc/Nexo/actions/runs/39552267643) aprobó los cinco controles y ci-required para el origen `7d65bd2518e2501687123b3c702b142ed8a98e02`. Los cinco artefactos descargados corresponden al candidato de integración `9d373779aa138bbb27152ee34e89dfe2b03415f4` y se validaron de nuevo: 21 pruebas API, una Angular, 12 PostgreSQL y tres Chromium; imágenes y auditorías aprobadas. La [revisión técnica de PR #7](https://github.com/ngarayc/Nexo/pull/7#issuecomment-6309263608) precedió a su integración en test. Los [controles](ci-controls.md) distinguen ese recorrido de las demostraciones negativas y revisión humana pendientes.

## Acceso — E0-I05

Sobre el incremento de acceso pasaron localmente **41 pruebas API, 4 Angular, 16 de integración y 6 Chromium**, sin omisiones. Los 31 controles de CI siguen aprobados. El build compila API/Angular; las imágenes API/web/db del incremento pasaron Trivy sin altos/críticos. La auditoría de dependencias no reportó vulnerabilidades. [CI remoto 39557905564](https://github.com/ngarayc/Nexo/actions/runs/39557905564) repitió y aprobó los cinco controles para el origen `34d950cd14df44023f8eb80f05a34e6d9a6ff183` y candidato de integración `cd8a46e21615c65a19a73d7b301b2db8b2b344d8`. Sus cinco artefactos se descargaron y revalidaron. La [PR #9](https://github.com/ngarayc/Nexo/pull/9) se integró en test tras revisión técnica; main conserva revisión del autor pendiente.

Las pruebas HTTP de API usan bibliotecas de sesión/CSRF/cuotas reales y sustituyen explícitamente el caso de credenciales; comprueban precedencia de origen y parser, cookies, regeneración, cuatro horas con reloj controlado, cuotas, capacidad y fallos de almacén/limitador. Pruebas del almacén verifican que escrituras y lecturas pendientes tras logout no revivan el SID. Esto no acredita por sí solo la verificación de contraseña persistida.

La integración adicional usa PostgreSQL y la imagen API reales: credenciales contra Argon2id, respuesta genérica de usuario desconocido/clave incorrecta, dos sesiones, CSRF, revocación independiente, cuatro horas absolutas con consultas previas y reloj controlado; caída SQL con 503 sin cookie; reinicio API con sesiones invalidadas y mismo registro/hash; demo deshabilitada sin borrar cuenta. Los doce casos anteriores permanecen y vuelven a ejecutarse.

Chromium pasa por NGINX y Angular compilado. Comprueba dos contextos con SIDs diferentes, cookie inaccesible a JavaScript, logout sin revocar al otro cliente, restauración por recarga sin cambio de SID, error de contraseña y limpieza del formulario, almacenamiento web vacío, host ajeno y origen falsificado rechazados, además de CSP/nonce y salud. No guarda cookies, cuerpos de sesión o trazas como evidencia publicable.

Una prueba de capacidad detectó que `regenerate` podía causar una cookie al fallar la admisión. Se destruye ahora el estado de esa solicitud antes de responder 503 y se verifica ausencia de cookie, preservación de sesiones existentes y recuperación al liberar cupo. Otro caso simula fallo de guardado y comprueba que no queda reserva ni se reintenta persistir al finalizar la respuesta.

## Copia limpia — E0-I06

Se clonó de nuevo `577ecc7ece06829c84f17be8dbe455b85ad0d936` y se siguió el [procedimiento público](reproducibility.md) con configuración generada y proyecto/volumen propios. `npm ci`, calidad, build, 41 pruebas API, 4 Angular, 16 PostgreSQL, 6 Chromium y 31 controles pasaron; el checkout permaneció limpio y en ese SHA.

El recorrido manual automatizado comprobó salud, formulario y hash real, dos sesiones distintas, logout independiente, restauración por recarga, revocación al reiniciar API y conservación exacta de registro/hash tras reinicio y recreación de contenedores. Los valores sensibles se compararon en memoria y no se guardaron en artefactos. Después se eliminaron exclusivamente los recursos del proyecto sintético creado para esa comprobación; la instalación habitual permaneció disponible.

La reproducibilidad técnica no cierra por sí sola E0: las demostraciones de controles, CI del candidato actual y revisión del autor en main mantienen criterios propios. Horas finales y entregables completos se acreditan al cierre con información confirmada.

## Rechazos y recuperación — E0-I04

[La demostración](control-demonstrations.md) usa una copia de `577ecc7ece06829c84f17be8dbe455b85ad0d936` con protecciones equivalentes. GitHub rechazó push directo a main con GH006; omisión y fallo real produjeron unit/ci-required fallidos y dos rechazos HTTP 405 de integración, conservando test. El marcador sintético fue detectado localmente y retirado antes de commit/publicación.

Restaurar el árbol original permitió CI, cinco artefactos revalidados y promoción por PR hacia test. El CI del merge también pasó; main no cambió y el recurso quedó archivado. [El registro saneado](evidence/control-proofs.json) conserva SHAs, resultados y métricas. No acredita revisión humana o integración en main de Nexo; estas conservan su comprobación propia.

## Esquema e identidad exacta — E1-I01

El incremento de la [issue #11](https://github.com/ngarayc/Nexo/issues/11) pasó localmente calidad, build, **102 pruebas API, 4 Angular, 33 de integración y 6 Chromium**, sin omisiones. `schema:check` forma parte de calidad: comprueba la generación en copia temporal y la conservación de las migraciones. Una comprobación negativa con un default bigint no serializable fue rechazada pese al código cero del CLI; restaurar la fuente exacta recuperó el control. Los cuatro fixtures suministrados permanecen intactos.

Los 17 casos adicionales de integración usan PostgreSQL real y el código compilado. Comprueban siete tablas propias, exclusiones hash no diferibles y cinco triggers; roundtrip de Unicode/nulo/sustitutos aislados; codificación canónica; IDs largos; dos IDs distintos con colisión real del índice; competencia entre dos conexiones y relectura del ganador; FK/inmutabilidad; orden temporal exacto y desempate; finitud/rangos; JSON original y fallo de lectura implícita; presupuesto/evidencia de recibos; estados y outcome nulo; fallo técnico separado de rechazo; outbox y privilegios. El upgrade aplica primero la migración publicada de E0, después la nueva y repite preparación conservando cuenta/hash exactos. La recreación de API/PostgreSQL conserva las seis tablas nuevas mediante su volumen.

Las pruebas detectaron que SELECT FOR KEY SHARE en el trigger de proyección exigía UPDATE sobre eventos. Se corrigió usando SELECT y el control de ausencia; la FK protege la referencia y los eventos permanecen inmutables, sin conceder ese permiso adicional. El recorrido completo posterior pasó. Las tres imágenes del incremento pasaron Trivy sin vulnerabilidades altas/críticas.

[Persistencia](persistence.md) explica fuentes, archivos, costes y límites. La suite nativa inserta datos mediante los adaptadores/SQL: no acredita todavía recepción HTTP, ejecución de jobs, atomicidad de clasificación ni los oráculos 20/2/2 y 0/22/2. El CI remoto y la revisión se registran en la PR del candidato publicado; la revisión del autor para main mantiene su estado propio.

## Base de cola y admisión — parte de E1-I02

La base de [#14](https://github.com/ngarayc/Nexo/issues/14) pasó calidad, build, **122 pruebas API, 4 Angular, 41 de integración y 6 Chromium**, sin omisiones. Las 8 integraciones adicionales verifican pg-boss 12.38.0/esquema 46, su política, operación sin DDL, commit/rollback de fromDrizzle, admisión y recibo originales, idempotencia concurrente y conflicto estructural, fallo después de publicar, preparación repetida/incompatible y carrera por la última plaza activa. Los 33 casos anteriores vuelven a pasar, incluido upgrade desde E0 y persistencia de las seis tablas.

Se corrigieron dos incompatibilidades durante la comprobación: updateQueue rechaza campos inmutables aun con igual valor; solo recibe ahora ajustes mutables y la preparación valida los otros. La consulta SQL de fecha del test devolvía texto mediante Drizzle; se usa el tiempo de PostgreSQL directamente al insertar el marcador técnico. La preparación incompatible falla sin reemplazar la cola o purgar sus trabajos. Las 20 pruebas unitarias nuevas cubren sobre/UUID y turnos SQL, incluidos límites exactos y espera vencida sin ejecución posterior.

[Admisión](ingestion.md) identifica los archivos, fuentes y límites actuales. Esta es una parte de la issue: no acredita las rutas HTTP, autenticación pre-parser, límites del proxy, respuesta final, clasificación o recuperación completa. Esos criterios permanecen abiertos; el CI y la revisión de la promoción registran su SHA exacto.

## HTTP y recibos durables — continuación de E1-I02

Sobre la capa HTTP pasaron calidad/build, **177 pruebas API, 4 Angular, 44 de integración y 6 Chromium**, sin omisiones. Las 55 unitarias adicionales cubren autenticación literal y marca interna, UTF-8/lectura fragmentada/límites, configuración compatible, semántica de espera e incertidumbre y transporte Nest con sesión/cuotas reales. Las suites de bootstrap/acceso sustituyen explícitamente la ingesta ajena a su alcance; una suite propia prueba sus controladores y middleware reales con puertos de persistencia/clasificación sustituidos.

Las tres integraciones nuevas usan imágenes finales, PostgreSQL y NGINX reales, sin publicar puertos del stack de comprobación. Verifican clave antes de JSON, formato y +1, flujo fragmentado, exactamente 1.000 posiciones y 2 MiB, reutilización/conflicto, recibos coherentes por API key y sesión, bytes lógicos/originales, respuesta pendiente dentro del plazo y conservación exacta de recibos/posiciones y dos jobs tras reiniciar API. Los 41 casos anteriores vuelven a pasar.

Las dos primeras comprobaciones nativas pasaron desde el primer recorrido. La comparación de un snapshot de más de 2 MiB detectó el buffer de captura SQL de 1 MiB: se reprodujo ENOBUFS y se acotó a 8 MiB. Después se corrigió el helper de readiness para tolerar el intervalo sin escucha al reiniciar, con plazo de 30 segundos y fallo si no recupera salud. El recorrido completo posterior pasó. No cambiaron límites de aplicación, oráculos ni pruebas exigidas. La prueba de 16 solicitudes usa un listener previo en loopback para evitar listeners redundantes del arranque concurrente de Supertest, sin silenciar advertencias.

El recorrido PostgreSQL aún no tiene consumidor: sus POST conservan pendientes reales y responden 503; el 200 final y las variantes de error del transporte se comprueban con puertos sustituidos. La ejecución completa de clasificación, recuperación bajo fallos y oráculos sigue en E1-I03/I04/I06. [El contrato implementado](ingestion.md) mantiene esa distinción; CI/QA de su publicación identifica el candidato exacto.

El primer CI de esta continuación detectó una preparación incompleta del job integration: construía API/db, mientras la nueva suite de frontera necesitaba también web. System, que construía las tres imágenes, pasó el mismo recorrido. Se añade web a la construcción de integración; no se elimina la prueba ni se reutiliza el éxito de otro job para integrar el candidato fallido. La PR conserva el fallo y su corrección comprobable.

## Clasificación y continuación — E1-I03

La implementación de [#17](https://github.com/ngarayc/Nexo/issues/17) pasó calidad, build de API, **216 pruebas API, 4 Angular, 52 de integración y 6 Chromium**, sin omisiones. La imagen API reconstruida pasó Trivy HIGH/CRITICAL; web/db conservan las imágenes verificadas del incremento anterior. No se añadieron dependencias, migraciones o excepciones. Los cuatro fixtures conservan sus hashes. CI reconstruye/verifica todas las imágenes del candidato publicado.

La suite SQL comprueba ambas pasadas en orden original: 20/2/2 y 0/22/2, 20 eventos, 8 vehículos, 4 alertas, identidades y estados esperados. Verifica 43 mensajes lógicos —20 telemetry.accepted, 19 vehicle.updated y 4 alert.created— sin efectos adicionales en la repetición. Casos separados cubren 80/81, OFF con exceso, instante subnanosegundo, offsets equivalentes, extras grandes, NUL/sustitutos/IDs largos, colisiones hash y carreras de evento/proyección con conexiones reales. Una excepción entre escrituras revierte todos los efectos.

El procesador se prueba con reclamación/ACK reales, resultado y continuación en el mismo commit, repetición después del commit sin efectos nuevos y cercas de cursor/generación/jobId/notBefore. Una excepción después de publicar la continuación revierte job, posición, revisión y dominio. El test de notBefore usa otro recibo para la fase ejecutable: PostgreSQL rechazó correctamente que el primer fixture intentara retroceder el instante reservado; el control permanece intacto.

El consumidor activo y HTTP/proxy reales también ejecutan ambos oráculos sin reset entre pasadas. Los lotes límite de 1.000 posiciones y exactamente 2 MiB obtienen resultado final dentro del plazo HTTP; la consulta del recibo coincide con la respuesta POST y no reenvía. Reiniciar conserva las recepciones finalizadas y sus posiciones. Las pruebas unitarias de pendiente/incertidumbre siguen vigentes. Los casos manuales de adaptadores/cola se ejecutan sin otro consumidor concurrente; no sustituyen el recorrido con servidor activo.

[Clasificación](classification.md) documenta archivos, protocolo, mensajes y fuentes. La recuperación frente a fallos/confirmaciones inciertas, backoff y agotamiento quedan en E1-I04. No se atribuye entrega SSE, dashboard, reproductor o revisión humana a estas comprobaciones. La PR de promoción identifica su diff, candidato y resultados remotos antes de integrar.

## Integración revisada en main — cierre de E0

La [PR #18](https://github.com/ngarayc/Nexo/pull/18) promovió E1-I03 a test tras revisión técnica y [CI 39612435194](https://github.com/ngarayc/Nexo/actions/runs/39612435194), con cinco artefactos del candidato `167a85a4c69facca571f5521f53ca55dd52afe6b` descargados y revalidados: 216 API, 4 Angular, 52 integración y 6 Chromium.

El autor aprobó el entorno main-review de [39613878609](https://github.com/ngarayc/Nexo/actions/runs/39613878609). Junto con [CI 39613878695](https://github.com/ngarayc/Nexo/actions/runs/39613878695), correspondiente al candidato `684c8d2278651df5408c0478b00cef134c43c3bf` y al origen `ae55ba7dbc8c4896acb8150587fb2aa138bf3e75`, permitió integrar la [PR #8](https://github.com/ngarayc/Nexo/pull/8). El agente realizó la integración después de esa aprobación real, sin omitir controles. La aprobación solo cubre ese candidato.

El commit resultante `b6d7a6e93c158ae068e8bfbb9dd1ffd7f1fde5ce` pasó [CI posterior 39615611149](https://github.com/ngarayc/Nexo/actions/runs/39615611149); sus cinco artefactos volvieron a descargarse y validarse con 216/4/52/6 y escaneos aprobados. E0 quedó cerrado con evidencia de preparación, acceso, copia limpia, controles negativos y revisión humana. Esto no cierra la aceptación funcional completa ni atribuye esos resultados a incrementos posteriores.

## Recuperación y límites — E1-I04

El incremento de [#19](https://github.com/ngarayc/Nexo/issues/19) pasó calidad, build, **229 pruebas API, 4 Angular y 6 Chromium**, sin omisiones; los 31 controles de CI permanecen aprobados. La integración completa pasó 65 casos y el caso añadido de SIGTERM pasó después por separado: el inventario del candidato publicado reúne 66. La imagen API del recorrido pasó Trivy sin altos/críticos; la auditoría de dependencias tampoco reportó vulnerabilidades. CI reconstruye y verifica las tres imágenes y el inventario completo del SHA de cada candidato.

Los nueve escenarios manuales nuevos usan adaptadores y PostgreSQL reales. Comprueban upgrade conservador desde E1, carreras de dos recuperadores, scheduler y microsegundo exacto, pérdida durante backoff, agotamiento y prefijo conservado, cierres tempranos, rollback después de send, pérdida de respuesta después de COMMIT real, ACK perdido, consulta/conexión ilegibles y páginas con veinte lotes ocupados. El cliente incierto se destruye y se comprueba que su backend SQL termina; no se reutiliza para inferir rollback.

Las cuotas agregadas se prueban en el límite: 20.000 pendientes, 64 MiB activos, 200.000 posiciones retenidas y 512 MiB lógicos retenidos; la última plaza activa ya conserva su carrera entre dos admisiones. Una admisión adicional se rechaza sin recibo parcial; recuperar una identidad existente no vuelve a consumir cuota. Los fixtures retenidos creados mediante SQL son consistentes en entradas, fragmentos, resultados y bytes, pero no se presentan como una prueba de procesar 200.000 eventos ni de espacio físico de disco.

Los cinco casos HTTP adicionales ejecutan consumidor/API reales y proxy cuando corresponde: fallo transitorio recuperado sin reenvío; agotamiento junto a otro lote sano y recibo terminal conservado tras reinicio; SIGKILL con job activo, posterior expiración y recuperación; SIGTERM con salida cero antes del plazo de 15 segundos y recuperación posterior; 1.200 lecturas más 1.200 POST malformados en contadores independientes, con 429 para cada siguiente petición y 403 para clave inválida aun con cuota agotada. Los fallos SQL proceden de triggers del stack sintético, sin hooks públicos. Las cuotas no crean recibos o efectos de negocio.

La primera prueba del proxy de agotamiento recibió 421 por el Host usado por su helper. Se corrigió el cliente nativo para enviar el host admitido, sin ampliar la política del proxy. El recorrido posterior pasó. El formato de snapshots generados y un import explícito de performance se corrigieron conservando los controles de formato/lint. Los casos SQL de esquema se ejecutan sin un consumidor concurrente que interprete sus estados intermedios como trabajo productivo; el recorrido de servidor activo se verifica aparte.

Los 52 casos previos vuelven a pasar, incluidos 20/2/2 y 0/22/2 por SQL y HTTP, identidades de eventos/latest/alertas y 43 efectos sin incremento al repetir. [Recuperación](recovery.md) relaciona protocolo, archivos, fuentes, costes y límites. Consultas del dominio, despacho SSE, dashboard, reproductor y CR-01 conservan sus incrementos propios. CI y QA de la PR registran el candidato exacto; esta comprobación local no sustituye la revisión humana de main.

### Promoción comprobada de recuperación

La [PR #21](https://github.com/ngarayc/Nexo/pull/21) se integró en test tras [QA](https://github.com/ngarayc/Nexo/pull/21#issuecomment-6319962915) y [CI 39624688334](https://github.com/ngarayc/Nexo/actions/runs/39624688334). Sus cinco artefactos se descargaron y revalidaron para el candidato `208c4d8061c7470668fec6147bff5dbc6081511f`: **229 API, 4 Angular, 66 integración y 6 Chromium**, sin omisiones, con los controles de seguridad aprobados.

El autor aprobó el entorno main-review de [39627969457](https://github.com/ngarayc/Nexo/actions/runs/39627969457) para el origen `3964ded57fcca5e07b550a82ab6fec0b5760eb62` y candidato de integración `98b2b23085d50be5e91508abd8ac1251fc504a3e`. El [CI de PR #22](https://github.com/ngarayc/Nexo/actions/runs/39627969485) pasó para ese mismo candidato; sus cinco artefactos se descargaron y validaron contra el checkout real de la ejecución, con 229/4/66/6.

La [PR #22](https://github.com/ngarayc/Nexo/pull/22) figura integrada con merge `cce67f73e16cab0323d89d1e3fa0949e6fdd607f`. El candidato revisado y ese merge tienen el mismo árbol Git. El [CI posterior en main 39660453027](https://github.com/ngarayc/Nexo/actions/runs/39660453027) también pasó y sus cinco artefactos se descargaron y revalidaron para el SHA del merge, conservando 229/4/66/6. Esta evidencia resuelve esa promoción; los incrementos posteriores mantienen su revisión propia.

## Consultas y volumen ordinario — E1-I05

El incremento de [#20](https://github.com/ngarayc/Nexo/issues/20) pasó localmente **239 pruebas API, 4 Angular, 72 de integración y 6 Chromium**, sin omisiones. Build y controles de calidad aprobados; los 31 controles de CI permanecen aprobados. La imagen API reconstruida pasó Trivy sin altos/críticos. Las pruebas existentes se mantienen, incluidos ambos oráculos originales y los escenarios de recuperación. La publicación y promoción identifican su SHA y CI en la PR; estas comprobaciones no se atribuyen a un candidato remoto todavía no evaluado.

Los cinco escenarios nativos nuevos comprueban GET de flota/historial/alertas, equivalencia del POST JSON y snapshot por HTTP con PostgreSQL/NGINX reales. Verifican los ocho últimos estados, historiales, cuatro alertas, resumen 7 MOVING/1 STOPPED y 43 mensajes sin nuevos efectos al repetir o consultar. Los casos aislados cubren identidad larga/NUL/sustitutos, precisión subnanosegundo, offsets, búsqueda literal, 2 MiB exactos/+1, acceso pre-parser, dieciséis cuerpos retenidos con recuperación del cupo al abortar y 600 consultas GET/POST compartidas. La prueba de snapshot intercala una ingesta confirmada entre las dos lecturas y acredita READ ONLY/REPEATABLE READ.

El escenario ordinario adicional procesa 10.000 eventos mediante HTTP en lotes de 1.000, con dos simultáneos; después repite los mismos 10.000. Comprueba 100 vehículos, 4.000 alertas, 20 recibos y 20.000 posiciones. La repetición conserva exactamente eventos, proyecciones, alertas y total de mensajes outbox. Se siguen consultando snapshots durante la carga. Los escenarios de volumen no contaminan el fixture oficial.

Una muestra de la ejecución completa local midió 168.926 ms para carga, repetición y verificaciones, con pico de once conexiones de runtime; los máximos individuales fueron tres de escrituras, tres de consultas y cinco de cola/listener. El EXPLAIN del historial de 100 eventos sobre 10.000 usó Bitmap Index Scan sobre `telemetry_events_vehicle_key_hash`, Bitmap Heap Scan y Sort: planificación de 0,958 ms y ejecución de 0,612 ms. Es una observación local, sin promesa de rendimiento productivo ni umbral portátil. El índice resuelve igualdad y el Sort conserva el orden residual.

Los presupuestos ampliados del runner/orquestador se documentan en [CI](ci-controls.md); no cambian plazos productivos. La cuenta del pool de pg-boss incluye su listener adicional y conserva el presupuesto total acordado. [Consultas](queries.md) relaciona contrato, archivos, fuentes y costes. SSE, dashboard, reproductor y filtro CR-01 siguen pendientes de sus incrementos propios.

La [PR #23](https://github.com/ngarayc/Nexo/pull/23) se integró en test como `dbf1d7cb334cbd16b4ea8742d5c5f052e6b4c21d`, después de [revisión técnica](https://github.com/ngarayc/Nexo/pull/23#issuecomment-6331184428) y [CI 39709943305](https://github.com/ngarayc/Nexo/actions/runs/39709943305). Los cinco artefactos se descargaron y revalidaron para fuente `91acbe21f7ac129353b4a824c5cc9e121528c82b`, candidato `78f8075ce1dbe147ea5997adafc66e6849600c71` e intento 1: 239 API, 4 Angular, 72 integración y 6 Chromium, sin omisiones, con los cinco controles aprobados. Su revisión hacia main mantiene el criterio humano del nuevo candidato.

## Consolidación del backend — E1-I06

Para [#24](https://github.com/ngarayc/Nexo/issues/24) se clonó de nuevo el commit publicado `91acbe21f7ac129353b4a824c5cc9e121528c82b`. Se generó configuración propia y se construyeron las tres imágenes desde esa copia. Pasaron npm ci, calidad, build, 239 pruebas API, 4 Angular, 72 PostgreSQL/HTTP, 6 Chromium y 31 controles CI. El checkout terminó limpio y en ese mismo SHA; los stacks de pruebas usaron recursos propios, conservando la aplicación y volumen habituales.

Ese recorrido verifica el backend completo E1: ambos oráculos originales, identidad/tiempo/JSON, migración/persistencia, admisión, clasificación, carreras, fallos/recuperación, consultas y 10.000 eventos HTTP más su repetición. No sustituye el simulador controlable E3, SSE/dashboard E2, CR-01 E4 ni la carga ampliada de entrega.

El incremento de consolidación añade [API](api.md) y [OpenAPI](openapi.json) y corrige referencias que describían consultas ya implementadas como pendientes. La descripción se validó con el esquema oficial OAS 3.1; sus veinte esquemas JSON y referencias internas son correctos. Un inventario obtenido del AST TypeScript contrastó sus trece operaciones con los controladores reales. Esta validación estructural complementa las pruebas HTTP; no acredita por sí sola reglas temporales, bytes o estados de negocio.

Los resultados de copia limpia pertenecen al SHA indicado, anterior al cambio documental. CI del candidato de consolidación mantiene su propia comprobación de fuentes, seguridad, imágenes y pruebas. El cierre de las issues y del milestone E1 exige además comprobar la promoción final y revisión humana de ese candidato; no se declara concluido por añadir documentación.

La [PR #25](https://github.com/ngarayc/Nexo/pull/25) se integró en test como `7b60df550b17472e4f92eed64c10fa1148ac6e5c`, después de [QA](https://github.com/ngarayc/Nexo/pull/25#issuecomment-6332113991) y [CI 39716310040](https://github.com/ngarayc/Nexo/actions/runs/39716310040). Sus cinco artefactos se descargaron y revalidaron para fuente `8c14f1262aa2fa0db05b7fb5b7c94622083549fc`, candidato `e93b5134fecb34685655660fd5dbb9bb81c34554` e intento 1: **239 API, 4 Angular, 72 integración y 6 Chromium**, sin omisiones, con seguridad y ci-required aprobados. Los dos intentos anteriores fallidos de 39711647349 se conservan como fallidos; no sustituyen el resultado del candidato corregido. [CI](ci-controls.md) explica el timeout externo de auditoría y la corrección de presupuestos. La promoción posterior hacia main conserva su revisión propia.

## Transporte SSE — E2-I01

El incremento de [#26](https://github.com/ngarayc/Nexo/issues/26) pasó localmente calidad, build, **265 pruebas API, 4 Angular y 6 Chromium**, sin omisiones. La integración completa pasó **81 casos** después de corregir el fixture de persistencia. Después se incorporó y aprobó por separado el caso de arranque degradado, tras ajustar exclusivamente la dependencia de inicio del proxy. El inventario publicado reúne 82 integraciones; CI conserva su ejecución completa sobre el candidato exacto antes de promover. Las tres imágenes comprobadas pasaron Trivy sin altos/críticos. Los oráculos y los cuatro fixtures permanecen intactos.

Las cinco integraciones SSE usan servidor, PostgreSQL y proxy reales: dos sesiones reciben los mismos 43 UUID originales (20 telemetry.accepted, 19 vehicle.updated y 4 alert.created), la repetición conserva 0/22/2 y no crea notificaciones; Last-Event-ID no solicita historial. Se verifican logout independiente, cuatro streams por SID/dieciséis globales, cuota de treinta aperturas, precedencia de sesión/origen y lectura en contador separado. Un trigger que impide marcar publicación conserva pendientes/diagnóstico, degrada salud y cierra streams mientras ingesta/consultas continúan; retirarlo publica los pendientes y recupera una generación nueva. Heartbeat atraviesa NGINX sin compresión y la conexión ociosa vuelve a recibir cambios.

Cuatro casos adicionales invocan dispatcher/adaptador sobre PostgreSQL real. Pierden la respuesta después de un marcado durable y comprueban que no se repite; el fallo antes del marcado conserva UUID, backoff y progreso de otros mensajes. Comprueban rollback sin publicación, commit tardío descubierto después de otro más reciente, grupos de cien metadatos antes de cargar payloads y tramas mayores de 2 MiB aisladas con tamaño UTF-8 exacto. La conexión SQL está liberada durante distribución local. Las pruebas puras controlan límites exactos, frescura, abortos, presión y temporizadores. Dos casos con HTTP/TCP reales comprueban saturación aislada y vencimiento ocioso; no sustituyen la futura verificación de renderizado de dos navegadores.

La primera integración completa detectó que el fixture de persistencia anterior construía sobres parciales y comparaba marcas pendientes antes del reinicio con marcas publicadas después. Ahora usa el serializador efectivo y drena mediante el dispatcher real antes del corte: la recreación sigue comparando íntegramente las seis tablas, incluida metadata operativa. Sus diecisiete casos pasaron y la siguiente suite completa aprobó los 81.

La prueba nueva de arranque reprodujo otro fallo: depender de la salud completa de API impedía iniciar web si la outbox ya estaba degradada. Web depende ahora del inicio del contenedor; los dos probes completos permanecen. El caso corregido verifica 503 de diagnóstico por proxy, otra ingesta confirmada durante el fallo, recuperación tras retirarlo y seis mensajes retenidos/publicados de dos eventos. `compose up --wait` solo aprueba después de recuperar salud. No se desactivó la comprobación para obtener un resultado verde.

Una muestra local de los 10.000 eventos HTTP y su repetición registró 191.875 ms, pico de once conexiones runtime y máximos individuales de tres de escrituras, dos de consultas y cinco de cola/listener. El muestreo comprueba también outbox hasta una y total hasta dieciséis. El historial de cien eventos sobre diez mil usó Bitmap Index Scan, Bitmap Heap Scan y Sort; planificación 0,924 ms y ejecución 0,870 ms. Son observaciones del escenario, sin promesa de rendimiento productivo.

[Tiempo real](realtime.md) describe protocolo, archivos, procedencia, costes y límites. OpenAPI pasó validación estructural oficial con veintidós esquemas; el inventario AST coincide con las catorce operaciones reales. Este incremento backend no acredita todavía el dashboard, el reproductor controlable ni EP-03/CR-01 completos. La PR y sus reportes identifican la verificación remota y la promoción; main conserva revisión humana propia.
