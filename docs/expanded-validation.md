# Validación ampliada y candidatura final

La [issue #77](https://github.com/ngarayc/Nexo/issues/77) incorpora un recorrido separado del CI ordinario. El [workflow manual](../.github/workflows/expanded.yml) exige un SHA completo y una etapa explícita: rehearsal para ensayos o final para el commit vigente de main. [El runner](../scripts/ci/run-expanded.mjs) comprueba checkout limpio, SHA y, en Actions, el SHA efectivo del workflow. Un ensayo local no se acredita como cierre final.

## Fuente, entorno e imágenes

Git exporta únicamente los archivos registrados del candidato mediante git archive y los entrega como contexto a Docker. No necesita otra rama, worktree, checkout o archivos privados. Cada imagen API/web/DB recibe la etiqueta de revisión del SHA; se registran IDs reales y se escanean esas mismas imágenes con inventarios completos. Un HIGH/CRITICAL, escaneo inconcluso, ID cambiado o revisión ajena impide emitir el manifiesto satisfactorio.

El manifiesto identifica Node/npm/Playwright, Docker/Compose, plataforma/arquitectura, motores reales y hashes de los tres fixtures suministrados. Las imágenes instalan/construyen desde el lockfile exportado. Las pruebas crean configuración y volúmenes sintéticos propios; los servicios/datos habituales no se recrean. El caso de arranque verifica salud, login demo, ingesta HTTP, persistencia de datos/credencial al recrear y reset mediante el comando real, con evidencia externa y login posterior.

## Carga y navegadores

El escenario ampliado reutiliza las aserciones del ordinario de10.000 eventos con un parámetro de pruebas limitado a10.000/100.000. Envía lotes de1.000 con dos simultáneos, consulta mientras ingresa y repite todo sin reset:100.000 eventos,100 vehículos,40.000 alertas,200 lotes y200.000 posiciones de recibos tras ambas pasadas. Comprueba latest, historial, alertas, ausencia de efectos nuevos al repetir y presupuesto de16 conexiones runtime. No exige100.000 trabajos simultáneos ni representa capacidad productiva para3.000 vehículos. Solo el cliente de pruebas ampliado admite un plazo mayor; los presupuestos de la aplicación no cambian.

Firefox y WebKit ejecutan todos los archivos de sistema, cada uno con su propio stack. Se verifica el motor de cada caso, inventario no vacío, una ejecución por prueba, cero fallos/omisiones y limpieza satisfactoria. Los recorridos incluyen dos clientes, ambos replays, seguridad, SSE/recuperación, CR-01, mapas, trayectoria, gráfico y precisión temporal. Chromium permanece en el CI ordinario. Los tiles son sintéticos y se bloquean otros orígenes durante las suites; no se afirma disponibilidad del proveedor público.

## Ejecución

Además de los prerrequisitos del README, instalar los motores fijados de Playwright en el entorno de pruebas:

```sh
npx --no-install playwright install firefox webkit
npm run test:expanded -- "$(git rev-parse HEAD)" rehearsal
```

En Linux deben estar presentes las bibliotecas nativas de esos motores. Playwright documenta install-deps; el workflow las prepara en su runner. El script comprueba el lanzamiento real y contenido DOM, no solo la descarga. No se deshabilita la validación nativa.

El recorrido construye y etiqueta las tres imágenes nexo-*:local; ejecutarlo sin otro recorrido que esté usando esas etiquetas. No inicia el proyecto habitual. El informe anterior se retira al comenzar y solo se genera otro si termina todo satisfactoriamente. Ante un fallo, conservar el diagnóstico privado, corregir y repetir el alcance correspondiente antes de emitir otra candidatura.

Para el cierre remoto, ejecutar el workflow desde main con source igual al SHA final y stage igual a final. La ejecución ampliada no sustituye los seis jobs/cinco artefactos del [CI ordinario](ci-controls.md), su revisión humana o la comprobación posterior al merge. Ambos resultados deben corresponder al SHA definitivo antes de publicar el tag/release. [La auditoría final #82](https://github.com/ngarayc/Nexo/issues/82) precede al congelamiento de esa entrega: revisar, consolidar, planear y corregir antes del PR final y el libreto.

## Lista de publicación y límites

El workflow ampliado publica únicamente reports/expanded/manifest.json durante siete días. Su esquema cerrado rechaza campos ajenos, otro SHA/intento/fixture/imagen, carga menor, exceso de conexiones, reset incompleto, navegador/archivo ausente o pruebas omitidas. Las negativas incluyen datos crudos insertados en distintos niveles del reporte. Los cinco informes ordinarios conservan su formato y lista de publicación; el manifiesto pertenece a otra ejecución.

JSON de Playwright, logs de procesos, escaneos crudos, archivos de reset y diagnósticos quedan en reports/raw, fuera del upload. No se publican trace, HAR, storageState, sesiones, claves, archivos de entorno o rutas personales. Solo métricas, versiones, hashes/IDs y resultados permitidos pueden incorporarse después al manifiesto de release.

Este procedimiento describe las comprobaciones implementadas. [Verificación](verification.md), las ejecuciones y el manifiesto final identifican cuáles terminaron y sobre qué SHA; la existencia del script no declara aprobado el candidato final ni cerrada la entrega.

Antes del upload ampliado se ejecuta también la [comprobación de publicación](ci-controls.md): adjunto sintético excluido, contenido sin marcador literal/escapado y revalidación del manifiesto contra checkout, ejecución, fixtures e IDs/revisiones actuales. Es un paso posterior al recorrido y anterior al único upload; no amplía sus archivos permitidos o sustituye la ejecución final sobre main.
