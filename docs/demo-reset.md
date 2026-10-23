# Reset local de la demo

`npm run demo:reset` descarta la base sintética del proyecto indicado para poder repetir una primera reproducción. Es una operación local explícita y no se ejecuta al arrancar. La interfaz ofrece además una [limpieza de datos en modo demo](replay-panel.md#limpiar-demostracion) que conserva la cuenta y no sustituye volúmenes ni crea respaldos. Reiniciar servicios conserva la base; reiniciar el reproductor conserva datos y diario.

Desde la raíz, con Node/npm fijados, Docker accesible y los tres servicios ya construidos:

```sh
npm run demo:reset -- --project nexo --inspect
npm run demo:reset -- --project nexo
```

Usa `.env.local` sin modificarlo. Para otro proyecto sintético iniciado con el mismo Compose, indicar su nombre y configuración mediante `--project` y `--env-file`. El archivo debe pertenecer al usuario y tener permisos600. La invocación sin `--inspect` autoriza descartar los datos sintéticos del destino mostrado, incluida la cuenta local; el arranque reproducible vuelve a crear `demo`.

## Identidad del destino

El comando exige Docker Linux mediante socket Unix local, proyecto reconocido, modo demo, imágenes locales existentes y volumen `${proyecto}_postgres18-data` con etiquetas de Compose y `io.github.ngarayc.nexo.purpose=synthetic-demo`. Comprueba consumidores, directorio del proyecto e identidad de creación. Rechaza volúmenes externos, compartidos, bind, opciones de driver o etiquetas insuficientes. Los volúmenes creados antes de esta etiqueta no se adoptan ni reetiquetan automáticamente; se puede iniciar un proyecto sintético nuevo con otro nombre y puerto disponible.

Las etiquetas permiten identificar recursos administrados; no prueban autorización frente a otro administrador de Docker. No modificar recursos, imágenes, configuración o emisores del destino mientras se ejecuta el procedimiento. Los servicios de otros proyectos permanecen fuera del reset. [Identidad y ciclo de vida de volúmenes Compose](https://docs.docker.com/reference/compose-file/volumes/), [inspección de contexto Docker](https://docs.docker.com/reference/cli/docker/context/inspect/).

## Evidencia y fases

La operación crea `reports/demo-reset/<proyecto>-<id>/`, fuera del volumen y excluida de Git. `--evidence-dir` permite elegir otra subcarpeta de `reports/`. El directorio es privado; los archivos, modo600. Un bloqueo por proyecto/daemon impide resets concurrentes.

Guarda snapshots JSONL coherentes en `REPEATABLE READ`, antes de detener y después de cerrar web/API. Incluyen conteos, hash de migración, informes conservados, metadata de ejecuciones/intentos y diagnósticos de recibos. Una lista fija de columnas excluye sesiones, contraseñas/hashes, claves, cuerpos originales y logs. Exporta como máximo64MiB por snapshot y verifica terminación, cantidades y SHA-256 antes de borrar. Un fallo conserva la base; si ya se detuvieron servicios, permanece no preparada hasta resolver o reanudar.

Después detiene PostgreSQL, verifica detención, retira contenedores propios mediante `compose down` sin `--volumes` y elimina exclusivamente el volumen validado mediante `docker volume rm`, sin fuerza ni prune. Docker conserva los volúmenes nombrados con down normal y rechaza retirar un volumen en uso. [Semántica de down](https://docs.docker.com/reference/cli/docker/compose/down/), [borrado de volumen](https://docs.docker.com/reference/cli/docker/volume/rm/).

Recrea servicios con las mismas imágenes, sin construir o descargar versiones nuevas. El arranque aplica migraciones propias/pg-boss y cuenta demo. Comprueba salud, ocho tablas de datos vacías, login/logout y motor sin ejecución. Las sesiones anteriores dejan de funcionar porque la API y su sesión de proceso fueron sustituidas. No precarga fixtures u oráculos.

## Interrupción y reanudación

El comando imprime la carpeta exacta. Conservarla completa y usarla al reanudar:

```sh
npm run demo:reset -- --project nexo --resume reports/demo-reset/nexo-ID
```

La reanudación exige mismo daemon, proyecto, configuración e imágenes; revalida archivos y volumen. La huella incluye el Compose expandido para detectar también valores heredados del proceso, no solo cambios en .env.local. Si el volumen original sigue presente, captura evidencia actual antes de descartarlo. Si el borrado se confirmó en Docker pero su respuesta se perdió, continúa desde la ausencia del mismo nombre después de la fase registrada. Un volumen de reemplazo nunca se vuelve a borrar por reanudar. Si ya contiene datos nuevos, devuelve `NOT_EMPTY` y los conserva. Reanudar una operación completada solo comprueba el destino actual, sin repetir el reset.

| Código                                                   | Acción                                                                                                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNRECOGNIZED_VOLUME`, `VOLUME_SHARED`, `VOLUME_CHANGED` | Revisar identidad/consumidores; el comando no busca ni adopta otro volumen.                                                                                 |
| `PRIVATE_FILE_REQUIRED`, `PRIVATE_DIRECTORY_REQUIRED`    | Corregir propiedad/permisos del archivo o directorio indicado.                                                                                              |
| `RESET_LOCKED`                                           | Conservar evidencia; otra operación está activa o el bloqueo no pudo verificarse. Un bloqueo de proceso terminado solo se recupera con su mismo `--resume`. |
| `INVALID_EVIDENCE`, `INCOMPLETE_EVIDENCE`                | Conservar archivos y base; no continuar con un archivo truncado o alterado.                                                                                 |
| `IMAGE_CHANGED`, `RESUME_TARGET_CHANGED`                 | Restaurar la configuración/imágenes del destino antes de reanudar.                                                                                          |
| `DOCKER_OPERATION_FAILED`, `NOT_PREPARED`                | Revisar salud local sin publicar logs o configuración; repetir con `--resume`. No implica que una operación con timeout careciera de efectos.               |

La recuperación de evidencia de una base dañada requiere intervención aparte. Una fase incompleta no acredita una base preparada ni la conformidad del par oficial. Los snapshots se conservan como evidencia histórica; no restauran automáticamente datos borrados.
