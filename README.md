# Nexo

Telemetría sintética de flotas con NestJS, Angular y PostgreSQL. El nombre expresa el vínculo entre vehículos, información y supervisión.

La API admite lotes por HTTP y conserva su trabajo en una cola durable PostgreSQL. Valida cada posición, garantiza identidad persistente, resuelve duplicados/conflictos y confirma evento, último estado, alerta y outbox en una transacción. Los eventos tardíos permanecen en el historial y pueden generar alertas sin hacer retroceder la flota. [Arquitectura](docs/architecture.md) describe el monolito modular y sus límites.

Angular muestra flota, búsqueda, estados, historial y alertas mediante snapshot y SSE compartido, con recuperación de conexión y sesión. CR-01 añade filtro exacto por vehículo con selección propia de cada cliente. Tabla, mapa, trayectoria y gráfico comparten selección por evento; el historial permite inspeccionar la fecha recibida y el UTC exacto. Los datos siguen disponibles ante un fallo cartográfico. [Dashboard](docs/dashboard.md), [cartografía](docs/cartography.md) y [velocidad](docs/speed-chart.md) explican comportamiento y accesibilidad.

El [reproductor HTTP](docs/replay-emitter.md), controlado desde un [panel flotante](docs/replay-panel.md), envía progresivamente las 24 líneas originales con intervalo, inicio, pausa, reanudación y reinicio. Su [diario](docs/replay-journal.md) y [verificador](docs/replay-verification.md) conservan resultados e incertidumbre. La pausa actúa sobre nuevos envíos; el servidor sigue procesando lo admitido. La [guía](docs/demo-guide.md) demuestra 20/2/2 y 0/22/2 sin reset intermedio, con 20 eventos/8 vehículos/4 alertas. El [reset local](docs/demo-reset.md) identifica el volumen sintético y conserva evidencia antes de recrearlo.

[Verificación](docs/verification.md) registra resultados y promociones por candidato; la [auditoría final](docs/final-audit.md) reúne hallazgos y correcciones. La validación del SHA definitivo y los artefactos de entrega conservan su evidencia propia.

## Arranque

Requisitos: Git, Docker Engine y Compose, Bash y OpenSSL. El reset y las comprobaciones de fuentes requieren además Node.js 24.22.0 y npm 12.2.0 en el host; la construcción de API/web usa sus herramientas dentro de Docker. Desde la raíz, generar la configuración solo la primera vez:

```sh
bash scripts/configure-local.sh
docker compose --env-file .env.local -f infra/compose.yaml up --build -d --wait
```

Abrir **http://localhost:8080** e ingresar con **demo / demo**. La pantalla inicial requiere sesión; permite cerrar únicamente la sesión actual. La salud real está en `/api/health`. [Acceso](docs/access.md) describe cookies, duración, cuotas y límites locales.

Solo web publica `127.0.0.1:8080`; API y base permanecen en redes Docker. PostgreSQL conserva datos en un volumen nombrado. `.env.local` no se publica y se conserva entre arranques. El generador rechaza sobrescribirlo.

```sh
docker compose --env-file .env.local -f infra/compose.yaml down
docker compose --env-file .env.local -f infra/compose.yaml up -d --wait
```

La detención conserva el volumen. Para descartar explícitamente la demo sintética, consultar [reset local](docs/demo-reset.md), su inspección y reanudación. [Operación](docs/operations.md) detalla configuración, persistencia, permisos y límites comprobados.

## Fuentes y comprobaciones

Herramientas para reset y desarrollo: **Node.js 24.22.0 y npm 12.2.0**, fijadas también en las imágenes de build y el lockfile.

```sh
npm ci
npm run quality
npm run build
npm run test:unit
npm run test:integration
npm run test:ci-controls
npx --no-install playwright install chromium
npm run test:e2e
```

Durante el desarrollo local se ejecutan solo las comprobaciones pertinentes al cambio; la batería completa se reserva para cerrar una épica. Los workflows de GitHub mantienen todos sus controles.

Integración y navegador necesitan Docker e imágenes construidas mediante el arranque anterior. Usan recursos sintéticos propios y no modifican el volumen de la aplicación; navegador requiere libre el puerto8081. [Verificación](docs/verification.md) describe resultados y candidatos, y [trazabilidad](docs/traceability.md) relaciona requisitos, implementación y pendientes.

- `apps/api`: monolito modular NestJS/TypeScript, acceso, ingesta, consultas, tiempo real y persistencia.
- `apps/web`: Angular por funcionalidades, fachadas, acceso y navegación protegida.
- `packages/contracts`: tipos públicos y reglas puras compartidas por API y Angular.
- `infra`: Compose, imágenes fijadas por digest y proxy NGINX.
- `skills/`: especificación, implementación y revisión; aliases en `.agents/skills/`.
- `docs/requirements/` y `fixtures/`: contratos y datos suministrados, preservados.
- `scripts/` y `tests/`: comprobaciones de fuentes, controles e integración.

## Calidad y gobierno

Cada cambio requiere issue y commits con referencia real. Después del bootstrap revisado, las ramas permanentes son `development`, `test` y `main`. El agente publica y promueve por PR a test tras revisión QA y CI; las PR hacia main quedan abiertas para revisión del autor mientras continúa el desarrollo. Consultar [AGENTS.md](AGENTS.md), [gobierno](AGENT-GOVERNANCE.md) y [flujo de IA](docs/AI-WORKFLOW.md).

Los cinco controles remotos y `ci-required` pasaron en [el primer candidato de CI](https://github.com/ngarayc/Nexo/actions/runs/39552267643), promovido por [PR #7](https://github.com/ngarayc/Nexo/pull/7). Cada candidato nuevo repite los controles. Las [demostraciones negativas y recuperación](docs/control-demonstrations.md) están comprobadas; la revisión humana de main conserva su estado propio. Backend y dos sesiones independientes de Angular verifican 20/2/2 y 0/22/2 sin reset entre pasadas, 20 eventos/8 vehículos/4 alertas e identidades originales. El recorrido integral desde reset acredita los controles del reproductor y ambos replays mediante dos interfaces reales; el video y la evidencia definitivos se localizan mediante el apartado de entrega.

## Documentación

- [Arquitectura](docs/architecture.md).
- [Trazabilidad y alcance comprobado](docs/traceability.md).
- [Auditoría final, hallazgos y correcciones](docs/final-audit.md).
- [Retrospectiva: decisiones, correcciones y límites](docs/RETROSPECTIVA.md).
- [Persistencia exacta y migraciones](docs/persistence.md).
- [Admisión durable y contratos HTTP](docs/ingestion.md).
- [Clasificación y efectos transaccionales](docs/classification.md).
- [Recuperación, backoff y agotamiento](docs/recovery.md).
- [Consultas, historial JSON y snapshot](docs/queries.md).
- [SSE, outbox y recuperación en vivo](docs/realtime.md).
- [Coordinación Angular, capturas y reconexión](docs/frontend-sync.md).
- [Flota, búsqueda, historial y alertas](docs/dashboard.md).
- [Ciclo funcional EP-03 — Alertas base](docs/agent-cycles/EP-03.md).
- [Cambio CR-01 — Filtro de alertas](docs/agent-cycles/CR-01.md).
- [Comparación agéntica y sus límites](AGENT-EFFICIENCY.md).
- [Diario durable del reproductor](docs/replay-journal.md).
- [Preparación y verificación del par oficial](docs/replay-verification.md).
- [Reset local con evidencia y reanudación](docs/demo-reset.md).
- [Demostración reproducible y guion de video](docs/demo-guide.md).
- [Emisor HTTP, temporización e intenciones](docs/replay-emitter.md).
- [API y contrato OpenAPI versionado](docs/api.md).
- [Comprobación desde copia limpia](docs/reproducibility.md).
- [Validación ampliada y candidatura final](docs/expanded-validation.md).
- [Reglas de dominio y GPS](docs/domain.md).
- [Seguridad](docs/security.md).
- [Acceso local](docs/access.md).
- [Controles de CI](docs/ci-controls.md).
- [Procedencia](docs/references.md).
- [Contrato común suministrado](docs/requirements/common-spec.md).
- [Demostración requerida](docs/requirements/DEMO-REPLAY.md).
- [Rúbrica suministrada](docs/requirements/CRITERIOS-EVALUACION.md).
- [Backlog suministrado](docs/requirements/backlog.md).

## Entrega

**Dedicación estimada por el autor para el alcance entregado: 25 horas.** Es una estimación confirmada por el autor.

**Destino del paquete:** [release entrega-final](https://github.com/ngarayc/Nexo/releases/tag/entrega-final). La entrega está publicada únicamente cuando esa página ofrece el video MP4 y un manifiesto cuyos SHA y controles coinciden con el tag. Las ejecuciones de CI y el manifiesto externo determinan el estado de cada candidatura; el enlace previsto por sí solo no acredita publicación.

La [auditoría y correcciones](docs/final-audit.md) contrasta implementación, planeación y obligaciones iniciales. La revisión del candidato corregido precede al cierre; el libreto y la grabación se preparan sobre ese resultado. La validación final ordinaria/ampliada y los artefactos corresponden al SHA de main identificado en el manifiesto.
