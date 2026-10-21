# Gobierno del trabajo agéntico

## Alcance y autoridad

El agente implementa y publica cambios con commits vinculados a issues, revisión técnica y comprobaciones obligatorias. Las promociones a test se realizan por PR tras QA y CI; las PR hacia main quedan abiertas para revisión del autor mientras continúa el desarrollo. Se mantienen protección de secretos y secuencia de entregables. Las reglas operativas están en [AGENTS.md](AGENTS.md).

Los procedimientos del agente orientan su trabajo; no son barreras del sistema operativo o de GitHub. El material inseguro suministrado en el reto no se adopta como política.

## Estado comprobado durante la preparación

| Control                | Evidencia y límite                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Issue antes del cambio | [E0-I01 #1](https://github.com/ngarayc/Nexo/issues/1) publicada antes de incorporar archivos al repositorio                                      |
| Autenticación Git      | SSH autenticó la cuenta ngarayc sin mostrar el material de las llaves; esta comprobación no acredita permisos de la API de Issues/PR             |
| Autenticación API      | Cuenta ngarayc verificada mediante la API del repositorio; milestones e issues de E0 publicados                                                  |
| Primer commit y ramas  | Base `e23cd475a960d691d21cef1ea409a08636378cee` con `Refs #1` y firma SSH verificada localmente; main, development y test nacieron del mismo SHA |
| Protecciones, PR y CI  | Protecciones configuradas y workflows preparados; ejecución/demostración remotas pendientes, sin atribuir aprobación humana                      |

La documentación y el código públicos se incorporan por la issue #1; las notas privadas quedan fuera de Git. Las demostraciones de bloqueo remoto y recuperación pertenecen a la issue #4 y permanecen pendientes; autenticarse no prueba esas barreras.

## Promociones

El trabajo continúa en `development`. Las ramas `test` y `main` reciben PR; se conservan las tres ramas y merge commits. Las plantillas de issue y PR identifican origen, alcance, aceptación, comprobaciones y estado de resolución. Una referencia a una issue no acredita su cierre.

La protección de ambas ramas exige PR, `ci-required`, conversaciones resueltas y rama actualizada; incluye administradores y prohíbe force push y borrado. El check todavía debe implementarse y ejecutarse en #4: la configuración no demuestra el funcionamiento del CI. Main requiere además `main-review`, emitido exclusivamente por su workflow de PR y protegido por revisión de entorno. Su primera ejecución/demostración sigue pendiente; no se atribuye a una autoaprobación nativa de PR de GitHub.

## Evidencia que se incorporará al ejecutar

Para cada barrera se registrarán configuración efectiva, recurso de prueba sintético, acción intentada, resultado observado, estado conservado y recuperación por el flujo permitido. Las pruebas de publicación directa y omisión de controles usarán un destino descartable autorizado; las de secretos usarán marcadores ficticios. No se expondrán secretos reales ni se intentará dañar la rama de entrega.

La revisión QA identifica candidato, checks, hallazgos y correcciones, y permite la promoción a test cuando cumple los controles. Para main, la revisión del autor identifica el SHA evaluado y su decisión real. Si cambia el candidato se actualizan alcance, pruebas y revisión; una aprobación anterior no cubre commits nuevos. El CI no concede aprobación humana. La evidencia humana de historia/CR-01 se registra cuando ocurre, sin sustituirla por autorización general.
