# Verificación

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
