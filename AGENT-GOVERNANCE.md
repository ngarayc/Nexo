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

La documentación y el código públicos se incorporan por la issue #1; las notas privadas quedan fuera de Git. Las demostraciones de bloqueo remoto y recuperación de la issue #4 se ejecutaron en el recurso descartable documentado. Autenticarse no prueba esas barreras: los rechazos GH006/405, referencias conservadas y recuperación tienen evidencia propia.

## Promociones

El trabajo continúa en `development`. Las ramas `test` y `main` reciben PR; se conservan las tres ramas y merge commits. Las plantillas de issue y PR identifican origen, alcance, aceptación, comprobaciones y estado de resolución. Una referencia a una issue no acredita su cierre.

La protección de ambas ramas exige PR, `ci-required`, conversaciones resueltas y rama actualizada; incluye administradores y prohíbe force push y borrado. El check pasó efectivamente antes de integrar la PR #7. Main requiere además `main-review`, emitido exclusivamente por su workflow de PR y protegido por revisión de entorno. La PR #8 tiene CI aprobado y revisión de entorno pendiente del autor; los rechazos demostrados no equivalen a una aprobación humana de esta PR.

## Evidencia de controles

Se registraron configuración efectiva, recurso sintético, acción, resultado, estado conservado y recuperación en [la demostración](docs/control-demonstrations.md). El recurso reprodujo protecciones/CI de Nexo y quedó archivado. El marcador se detectó y retiró localmente antes de commit/publicación; los intentos remotos defectuosos solo afectaron al recurso de prueba.

La revisión QA identifica candidato, checks, hallazgos y correcciones, y permite la promoción a test cuando cumple los controles. Para main, la revisión del autor identifica el SHA evaluado y su decisión real. Si cambia el candidato se actualizan alcance, pruebas y revisión; una aprobación anterior no cubre commits nuevos. El CI no concede aprobación humana. La evidencia humana de historia/CR-01 se registra cuando ocurre, sin sustituirla por autorización general.
