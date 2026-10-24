# Gobierno del trabajo agéntico

## Alcance y autoridad

El agente implementa y publica cambios con commits vinculados a issues, revisión técnica y comprobaciones obligatorias. Las promociones a test se realizan por PR tras QA y CI; las PR hacia main quedan abiertas para revisión del autor mientras continúa el desarrollo. Se mantienen protección de secretos y secuencia de entregables. Las reglas operativas están en [AGENTS.md](AGENTS.md).

Los procedimientos del agente orientan su trabajo; no son barreras del sistema operativo o de GitHub. El material inseguro suministrado en el reto no se adopta como política.

## Estado comprobado durante la preparación

| Control                | Evidencia y límite                                                                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issue antes del cambio | [E0-I01 #1](https://github.com/ngarayc/Nexo/issues/1) publicada antes de incorporar archivos al repositorio                                                                                                                                       |
| Autenticación Git      | SSH autenticó la cuenta ngarayc sin mostrar el material de las llaves; esta comprobación no acredita permisos de la API de Issues/PR                                                                                                              |
| Autenticación API      | Cuenta ngarayc verificada mediante la API del repositorio; milestones e issues de E0 publicados                                                                                                                                                   |
| Primer commit y ramas  | Base `e23cd475a960d691d21cef1ea409a08636378cee` con `Refs #1` y firma SSH verificada localmente; main, development y test nacieron del mismo SHA                                                                                                  |
| Protecciones, PR y CI  | [CI remoto aprobado](https://github.com/ngarayc/Nexo/actions/runs/39552267643), artefactos revalidados y [PR #7](https://github.com/ngarayc/Nexo/pull/7) integrada en test; [rechazos y recuperación comprobados](docs/control-demonstrations.md) |

La documentación y el código del bootstrap se incorporaron por la issue #1; las notas privadas quedan fuera de Git. Las demostraciones de bloqueo remoto y recuperación de la issue #4 se ejecutaron en el recurso descartable documentado. Autenticarse no prueba esas barreras: los rechazos GH006/405, referencias conservadas y recuperación tienen evidencia propia.

## Promociones

El trabajo continúa en `development`. Las ramas `test` y `main` reciben PR; se conservan las tres ramas y merge commits. Las plantillas de issue y PR identifican origen, alcance, aceptación, comprobaciones y estado de resolución. Una referencia a una issue no acredita su cierre.

La protección de ambas ramas exige PR, `ci-required`, conversaciones resueltas y rama actualizada; incluye administradores y prohíbe force push y borrado. El check pasó efectivamente antes de integrar la PR #7. Main requiere además `main-review`, emitido exclusivamente por su workflow de PR y protegido por revisión de entorno. Cada promoción conserva la revisión de su candidato exacto. [PR #51](https://github.com/ngarayc/Nexo/pull/51#issuecomment-6347135921) acredita aprobación real de ngarayc en main-review y cinco reportes propios revalidados para E3; esa intervención corresponde a E3. La revisión posterior de CR-01 está acreditada por [PR68](https://github.com/ngarayc/Nexo/pull/68#issuecomment-6350436349): ngarayc aprobó main-review39844605142 para test `0edba3be27f7ab80daeec447a8ce065189a668ed`; su CI propio39844604982 y el posterior39848012781 en main `cb494a285fe31b1bfad94cf6278e0f49462786eb` completaron seis jobs y cinco artefactos revalidados cada uno. No se atribuye a esa aprobación código posterior. Los rechazos demostrados y la QA del agente no sustituyen una aprobación humana.

## Dónde se aplica la protección de main

La restricción se aplica en GitHub al publicar o integrar en la rama protegida. El checkout revisado no tiene hooks activos ni `core.hooksPath` configurado para bloquear `git commit` local. `AGENTS.md` y las skills establecen las instrucciones de trabajo del agente; no interceptan comandos Git.

La configuración comprobada en Settings → Branches → main exige PR, los checks `ci-required` y `main-review`, conversaciones resueltas y base actualizada. Incluye administradores y prohíbe force push y borrado. En Settings → Environments → main-review se configura al autor como revisor requerido. [main-review.yml](.github/workflows/main-review.yml) referencia ese entorno mediante `environment: main-review`; GitHub mantiene el job pendiente hasta su aprobación.

Una vez autorizado el entorno, [review-context.mjs](scripts/ci/review-context.mjs) comprueba la promoción hacia main y el checkout exacto. El script no aprueba la revisión ni bloquea comandos Git. La configuración exige cero aprobaciones convencionales de PR: la intervención requerida se registra mediante el entorno. Esa aprobación identifica un candidato; el autor debe revisar su diff antes de aprobarlo.

La sesión de trabajo utiliza la cuenta autorizada del autor. GitHub identifica esa cuenta, pero no distingue por sí solo una acción manual de una automatización con los mismos permisos. Respetar que la aprobación la realice el autor es también una regla operativa. La configuración remota puede ser modificada por quien tenga administración; las pruebas de bloqueo acreditan el estado y los intentos documentados, no una barrera inalterable.

## Evidencia de controles

Se registraron configuración efectiva, recurso sintético, acción, resultado, estado conservado y recuperación en [la demostración](docs/control-demonstrations.md). El recurso reprodujo protecciones/CI de Nexo y quedó archivado. El marcador se detectó y retiró localmente antes de commit/publicación; los intentos remotos defectuosos solo afectaron al recurso de prueba.

La revisión QA identifica candidato, checks, hallazgos y correcciones, y permite la promoción a test cuando cumple los controles. Para main, la revisión del autor identifica el SHA evaluado y su decisión real. Si cambia el candidato se actualizan alcance, pruebas y revisión; una aprobación anterior no cubre commits nuevos. El CI no concede aprobación humana. La evidencia humana de historia/CR-01 se registra cuando ocurre, sin sustituirla por autorización general.
