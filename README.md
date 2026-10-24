# Nexo

Sistema de telemetría GPS sintética que implementa la prueba FleetPulse. Recibe eventos de vehículos, conserva su historial y muestra estado y alertas en Angular sin recargar la página. Incluye un reproductor HTTP para demostrar el comportamiento con los datos originales del kit.

**Stack:** Node.js y TypeScript, NestJS, Angular, PostgreSQL, pg-boss y Docker Compose. Mapas con Leaflet y gráfico de velocidad con Chart.js.

[Video de presentación](https://youtu.be/5CQrZa1BlhY) · [Arranque local](#arranque-local) · [Demostración](#demostración-reproducible) · [Pruebas](#desarrollo-y-pruebas) · [CICD](#cicd-y-despliegue) · [Documentación](#documentación)

## Arranque local

Requisitos: Git, Docker Engine en ejecución con acceso para el usuario, Docker Compose, Bash, OpenSSL y curl. API y frontend se construyen dentro de Docker; Node/npm en el host se necesitan para desarrollar, ejecutar pruebas o usar el reset por CLI.

Si todavía no tienes el repositorio:

```sh
git clone https://github.com/ngarayc/Nexo.git
cd Nexo
```

Desde la raíz, genera la configuración **solo la primera vez**:

```sh
bash scripts/configure-local.sh
```

El script crea `.env.local` con cuatro secretos técnicos aleatorios y permisos privados. Conserva ese archivo: el generador rechaza sobrescribirlo. La plantilla `.env.example` documenta las variables y no contiene valores utilizables.

Construye e inicia los servicios:

```sh
docker compose --env-file .env.local -f infra/compose.yaml up --build -d --wait
```

Abre **http://localhost:8080** e ingresa con **demo / demo** para el perfil local predeterminado. Comprueba los servicios y la salud real:

```sh
docker compose --env-file .env.local -f infra/compose.yaml ps
curl --fail --silent --show-error http://localhost:8080/api/health
```

La salud debe indicar `status`, `database` y `schema` en `ok`. Solo web publica `127.0.0.1:8080`; API y PostgreSQL permanecen en redes Docker. Los datos se conservan en un volumen nombrado. Abrir o recargar la aplicación recupera el estado guardado y conecta SSE; el reproductor se inicia manualmente.

Para detener y volver a iniciar, conservando los datos:

```sh
docker compose --env-file .env.local -f infra/compose.yaml down
docker compose --env-file .env.local -f infra/compose.yaml up -d --wait
```

El [procedimiento de operación](docs/operations.md) detalla configuración, permisos, persistencia y diagnóstico. La [comprobación desde copia limpia](docs/reproducibility.md) permite validar una revisión con recursos propios.

## Demostración reproducible

Abre dos sesiones independientes, por ejemplo una ventana normal y otra privada, e ingresa en ambas. El dashboard debe indicar **En vivo**. Una ventana muestra los cambios y la otra controla el reproductor flotante. Los botones usan iconos con nombres accesibles y tooltips, disponibles también mediante teclado.

1. Si ya hay datos o escenarios, termina la reproducción activa y espera las ingestas. En **Reproductor → Control**, usa la papelera **Limpiar demostración** y confirma. La limpieza elimina datos e informes de la demo, conserva la cuenta y no genera respaldo. Si la base ya está vacía, continúa directamente.
2. Fija un intervalo observable, por ejemplo **750 ms**, e inicia la reproducción. Comprueba que vehículos y alertas cambien sin refrescar. Pausa antes de terminar y reanuda: se detiene el siguiente envío del simulador; el servidor continúa procesando lo admitido.
3. Espera la primera pasada completa. **Envíos** conserva los motivos de rechazo y **Informe** explica el resultado; el desglose queda en **Detalles técnicos**.
4. Pulsa **Reiniciar reproducción**, **sin limpiar datos**, y espera la segunda pasada. El reinicio vuelve a enviar desde la primera línea y demuestra idempotencia.
5. Finaliza la verificación y consulta el Informe del par. El cierre conserva el resultado oficial y permite reproducciones exploratorias posteriores. Para preparar otra primera limpia, utiliza nuevamente la papelera.

| Resultado esperado  | Primera, con base limpia | Segunda, sin limpiar |
| ------------------- | ------------------------ | -------------------- |
| Líneas del fixture  | 24                       | 24                   |
| Aceptados nuevos    | **20**                   | **0**                |
| Duplicados          | **2**                    | **22**               |
| Rechazados          | **2**                    | **2**                |
| Eventos almacenados | 20                       | 20                   |
| Vehículos           | 8                        | 8                    |
| Alertas             | 4                        | 4                    |

El reproductor lee `fixtures/events.jsonl` en su orden original y hace los POST HTTP reales. Los oráculos `expected_sample.json` y `expected_detailed.json` se conservan. Un evento tardío puede generar alerta sin reemplazar el último estado; la alerta OVERSPEED requiere velocidad estrictamente mayor que 80 km/h.

**Reiniciar conserva datos; limpiar los descarta explícitamente.** La limpieza exige sesión, origen, CSRF, confirmación y ausencia de actividad incompatible. El [reset local por CLI](docs/demo-reset.md) sigue disponible para el destino sintético identificado; ese procedimiento recrea el volumen y conserva evidencia técnica fuera de él.

La [guía de demostración](docs/demo-guide.md), el [panel](docs/replay-panel.md) y el [verificador](docs/replay-verification.md) explican controles, resultados e incertidumbre.

## Funcionalidades

| Área            | Comportamiento                                                                                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ingesta         | Lotes parcialmente válidos, identidad persistente, duplicados sin efectos y conflictos sin sobrescritura. Trabajo durable y recuperación acotada.                                            |
| Flota y alertas | Último estado por instante observado, búsqueda, filtro por estado, historial y alertas en vivo. CR-01 permite filtrar alertas por vehículo.                                                  |
| Mapas y gráfico | Últimas posiciones, trayectoria de muestras y velocidades recibidas con selección compartida. Rueda sin zoom, una sola copia mundial y tooltips accesibles.                                  |
| Geocerca        | Una zona rectangular fija, bordes incluidos, estado Dentro/Fuera y cambios observados entre muestras. El fixture termina con **2 dentro y 6 fuera**; conserva las cuatro alertas originales. |
| Reproductor     | Intervalo, inicio, pausa, reanudación, reinicio, diario durable, Informe legible y limpieza confirmada.                                                                                      |

La geocerca usa los datos confirmados del dashboard. Su resumen corresponde a la flota visible; **Ver geocerca** encuadra la zona y el historial permite seleccionar la muestra posterior a un cambio observado. No determina la hora o el punto exactos de cruce. [Alcance de geocerca](docs/geofence.md), [cartografía](docs/cartography.md) y [gráfico](docs/speed-chart.md).

## Arquitectura y seguridad

El backend es un **monolito modular**: acceso, ingesta, telemetría, consultas, tiempo real y demo. Puertos y adaptadores separan reglas de HTTP, SQL y cola. Angular organiza funcionalidades con fachadas de estado y adaptadores de transporte; `packages/contracts` comparte tipos y reglas puras.

```text
Reproductor HTTP → API → PostgreSQL/pg-boss → procesamiento + outbox → SSE → Angular
```

La admisión y el trabajo de cola se confirman conjuntamente. El procesamiento confirma evento, último estado, alerta y outbox en una transacción. SSE distribuye cambios confirmados; los clientes recuperan snapshot al abrir o reconectar. La pausa del emisor no pausa la cola del servidor.

| Perfil | Servicios Docker                                | Acceso                                                                                                                          |
| ------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Local  | web/NGINX, API y PostgreSQL.                    | `http://localhost:8080`, cuenta predeterminada `demo`.                                                                          |
| Azure  | Los tres anteriores y Caddy como gateway HTTPS. | [Demo HTTPS](https://nexo-dtk-676b30.eastus2.cloudapp.azure.com), cuenta `Demo` con contraseña proporcionada por canal privado. |

La API key del productor permanece en backend. El dashboard requiere sesión; las escrituras de navegador verifican origen y CSRF. Las contraseñas usan Argon2id y las cookies cloud son Secure, HttpOnly y SameSite=Strict. El login cloud limita cinco intentos globales por minuto y dos verificaciones simultáneas, sin CAPTCHA externo. Migración y ejecución HTTP usan permisos SQL distintos.

El perfil cloud conserva base y certificados en disco persistente; solo gateway publica 80/443. La configuración y credenciales reales permanecen fuera de Git y de las imágenes. [Arquitectura](docs/architecture.md), [acceso](docs/access.md), [seguridad](docs/security.md) y [perfil cloud](docs/cloud-deployment.md).

## Desarrollo y pruebas

Para herramientas del host utiliza **Node.js 24.22.1 y npm 12.2.0**, fijados en `.nvmrc`, engines, lockfile e imágenes. La comprobación `test:ci-controls` requiere además **Python 3**, porque prueba el operador de CD. Comprueba las herramientas e instala las dependencias:

```sh
node --version
npm --version
python3 --version
npm ci
```

Durante el desarrollo ejecuta las comprobaciones del cambio. Ejemplos puntuales:

```sh
npm run test:unit --workspace @nexo/api -- src/modules/telemetry/application/classify.spec.ts
npm run test:unit --workspace @nexo/web -- --include=src/app/features/fleet/geofence.spec.ts
```

Para una comprobación completa del proyecto, con Docker accesible e imágenes construidas mediante el arranque anterior:

```sh
npm run quality
npm run build
npm run test:unit
npm run test:integration
npm run test:ci-controls
npx --no-install playwright install chromium --only-shell
npm run test:e2e
```

Integración y navegador crean recursos sintéticos propios. El navegador necesita libre el puerto **8081** y las bibliotecas nativas de Chromium; su [preparación verificable](docs/ci-controls.md#preparación-verificable-de-chromium) explica diagnóstico y dependencias. La aplicación habitual puede permanecer en 8080. Los reportes crudos permanecen fuera de Git; los publicables contienen metadatos y métricas permitidos.

La batería local completa se reserva para cierres o verificaciones que la requieran. El CI remoto conserva sus controles. [Verificación](docs/verification.md) registra comandos, resultados y revisiones; los casos adversariales permanecen separados del fixture oficial.

## CI/CD y despliegue

El flujo de trabajo usa issues reales, commits con `Refs #<issue>` y las ramas permanentes **development → test → main**. La promoción a test requiere QA y evidencia; main conserva revisión humana del candidato actual.

1. **CI en development:** calidad, unitarias, integración, seguridad de fuentes y sistema; `ci-required` exige resultados y reportes completos.
2. **Promociones a test/main:** verifican procedencia y reutilizan los cinco artefactos del mismo árbol Git. No repiten las suites por cambiar de rama. Un contenido diferente necesita su propia comprobación.
3. **CD desde main:** verifica la promoción y la evidencia antes de autenticar en Azure mediante OIDC. Construye y escanea las cuatro imágenes Docker, activa la release y comprueba imágenes y HTTPS. Conserva datos, cuenta y certificados; la recuperación de aplicación exige migraciones compatibles.

El workflow ampliado ofrece comprobaciones de cierre mediante su perfil manual. La revisión de main y CD tienen funciones separadas. Los secretos, entornos, cookies y logs crudos quedan fuera de los artefactos públicos. El arranque y el despliegue no envían fixtures ni limpian la base.

[CI en Actions](https://github.com/ngarayc/Nexo/actions/workflows/ci.yml) · [CD Azure](https://github.com/ngarayc/Nexo/actions/workflows/cd.yml) · [Controles de CI](docs/ci-controls.md) · [Operación de CD](docs/cd.md).

## Agentes y trazabilidad

[AGENTS.md](AGENTS.md) define autoridad, permisos y límites. Las skills de [especificación](skills/nexo-spec-change/SKILL.md), [implementación](skills/nexo-implement-change/SKILL.md) y [QA/seguridad](skills/nexo-review-change/SKILL.md) organizan el trabajo; sus aliases están en `.agents/skills/`.

[EP-03](docs/agent-cycles/EP-03.md) conserva la historia base y [CR-01](docs/agent-cycles/CR-01.md) su cambio incremental. El [flujo de IA](docs/AI-WORKFLOW.md), el [gobierno](AGENT-GOVERNANCE.md), las [demostraciones de bloqueo y recuperación](docs/control-demonstrations.md) y la [comparación agéntica](AGENT-EFFICIENCY.md) registran uso real, correcciones y límites de las conclusiones.

## Alcance y limitaciones

- Una cuenta de demostración y una instancia API. Sesiones y cuotas son de proceso; reiniciar API exige iniciar sesión de nuevo.
- pg-boss usa PostgreSQL para trabajo durable; Kafka no está incorporado.
- La geocerca es fija y de consulta, sin editor o alertas persistidas de entrada/salida. Las trayectorias unen muestras; no calculan rutas por calles ni movimiento continuo.
- El gráfico es descriptivo y la observabilidad es básica. Las pruebas sintéticas no acreditan capacidad productiva, alta disponibilidad o un SLA.
- La cartografía depende de Internet y de OpenStreetMap, con atribución visible. Tabla, historial y datos continúan disponibles si falla el proveedor.
- Las métricas exactas de tokens y un onboarding para tres juniors no se presentan como realizados. Los opcionales P1 y su prioridad se describen en la rúbrica.

La [retrospectiva](docs/RETROSPECTIVA.md) desarrolla decisiones, deuda y próximos pasos.

## Documentación

| Tema                    | Referencias                                                                                                                                                                                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requisitos y aceptación | [Contrato](docs/requirements/common-spec.md), [reproductor](docs/requirements/DEMO-REPLAY.md), [rúbrica](docs/requirements/CRITERIOS-EVALUACION.md), [backlog](docs/requirements/backlog.md), [trazabilidad](docs/traceability.md).                                                           |
| Backend y datos         | [Persistencia](docs/persistence.md), [admisión](docs/ingestion.md), [clasificación](docs/classification.md), [recuperación](docs/recovery.md), [consultas](docs/queries.md), [API/OpenAPI](docs/api.md).                                                                                      |
| Dashboard y tiempo real | [Dashboard](docs/dashboard.md), [SSE/outbox](docs/realtime.md), [sincronización Angular](docs/frontend-sync.md), [mapas](docs/cartography.md), [geocerca](docs/geofence.md), [velocidad](docs/speed-chart.md).                                                                                |
| Reproductor             | [Guía](docs/demo-guide.md), [panel](docs/replay-panel.md), [emisor HTTP](docs/replay-emitter.md), [diario](docs/replay-journal.md), [verificador](docs/replay-verification.md), [reset local](docs/demo-reset.md).                                                                            |
| Operación y evidencia   | [Operación](docs/operations.md), [copia limpia](docs/reproducibility.md), [cloud](docs/cloud-deployment.md), [CD](docs/cd.md), [verificación](docs/verification.md), [validación ampliada](docs/expanded-validation.md), [auditoría](docs/final-audit.md), [procedencia](docs/references.md). |

## Entrega y revisión

**[Ver el video de presentación de Nexo](https://youtu.be/5CQrZa1BlhY).** El enlace permite acceder a la grabación del autor desde este README; el archivo audiovisual se aloja en YouTube.

**Dedicación estimada aportada por el autor: 25 horas.** La cifra es estimada; no representa una medición de dedicación.

La última versión desplegada comprobada es main `23f6702`, con [CI de origen](https://github.com/ngarayc/Nexo/actions/runs/40036044204), [PR #105](https://github.com/ngarayc/Nexo/pull/105) y [CD Azure aprobado](https://github.com/ngarayc/Nexo/actions/runs/40039165651). El [estado de entrega](docs/verification.md#estado-de-entrega-y-despliegue) detalla su evidencia.

La [release entrega-final](https://github.com/ngarayc/Nexo/releases/tag/entrega-final) conserva el commit anterior `81bf4bb` y los artefactos de esa revisión. No contiene las mejoras posteriores de nube, limpieza, CD y geocerca. Las nuevas entregas se publican como versiones separadas en [Releases](https://github.com/ngarayc/Nexo/releases), con su commit y evidencia propios. `main` puede incorporar mejoras posteriores: relaciona siempre el código evaluado con su CI, PR y despliegue correspondientes. Identifica el checkout con:

```sh
git rev-parse HEAD
```

La [auditoría final](docs/final-audit.md) documenta el contraste con planificación y obligaciones iniciales. Los manifiestos vinculan el código probado y publicado mediante el árbol Git, conservando las revisiones originales de los reportes y las imágenes identificadas.
