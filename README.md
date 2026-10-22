# Nexo

Telemetría sintética de flotas con NestJS, Angular y PostgreSQL. El nombre expresa el vínculo entre vehículos, información y supervisión.

**Estado:** base E0 con Docker, acceso demo por sesión y CI; E1 admite lotes HTTP, clasifica eventos y recupera fallos mediante cola durable, conservando identidad, tiempo y JSON exactos. Incluye proyección, alertas y outbox transaccionales, tres oportunidades por posición y reconciliación tras reinicio. Las consultas autenticadas exponen flota, historial, alertas y snapshot coherente. El stream SSE protegido publica cambios confirmados desde la outbox, con límites por conexión, heartbeat y recuperación de salud. Angular presenta flota, búsqueda, historial y alertas globales con hora24h de Bogotá; enlaza cada alerta con su observación y conserva conexión/totales al navegar. Reproductor y filtro CR-01 conservan sus incrementos posteriores.

E3 incorpora el [diario persistente](docs/replay-journal.md) y el [verificador de datos](docs/replay-verification.md), con fuentes originales, preparación, comparación e informes históricos. El [motor HTTP compartido](docs/replay-emitter.md) conserva cuerpos originales, una sola petición, controles protegidos e incertidumbre sin reenvíos. Las rutas ya permiten iniciar/pausar/reanudar/reiniciar/finalizar y observar progreso por SSE. Panel, reset seguro y demostración integral en dos navegadores siguen pendientes para cerrar el simulador obligatorio.

## Arranque

Requisitos: Docker Engine y Compose, Bash y OpenSSL. Desde la raíz, generar la configuración solo la primera vez:

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

La detención conserva el volumen. [Operación](docs/operations.md) detalla configuración, persistencia, permisos y límites comprobados.

## Fuentes y comprobaciones

Herramientas de desarrollo: **Node.js 24.22.0 y npm 12.2.0**, fijadas también en las imágenes de build y el lockfile.

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

Los cinco controles remotos y `ci-required` pasaron en [el primer candidato de CI](https://github.com/ngarayc/Nexo/actions/runs/39552267643), promovido por [PR #7](https://github.com/ngarayc/Nexo/pull/7). Cada candidato nuevo repite los controles. Las [demostraciones negativas y recuperación](docs/control-demonstrations.md) están comprobadas; la revisión humana de main conserva su estado propio. Backend y dos aplicaciones Angular verifican20/2/2 y0/22/2 sin reset entre pasadas,20eventos/8vehículos/4alertas e identidades originales. Esta evidencia automatizada todavía no acredita el reproductor controlable y video pendientes.

## Documentación

- [Arquitectura](docs/architecture.md).
- [Trazabilidad y alcance comprobado](docs/traceability.md).
- [Persistencia exacta y migraciones](docs/persistence.md).
- [Admisión durable y contratos HTTP](docs/ingestion.md).
- [Clasificación y efectos transaccionales](docs/classification.md).
- [Recuperación, backoff y agotamiento](docs/recovery.md).
- [Consultas, historial JSON y snapshot](docs/queries.md).
- [SSE, outbox y recuperación en vivo](docs/realtime.md).
- [Coordinación Angular, capturas y reconexión](docs/frontend-sync.md).
- [Flota, búsqueda, historial y alertas](docs/dashboard.md).
- [Ciclo funcional EP-03 — Alertas base](docs/agent-cycles/EP-03.md).
- [Diario durable del reproductor](docs/replay-journal.md).
- [Preparación y verificación del par oficial](docs/replay-verification.md).
- [Emisor HTTP, temporización e intenciones](docs/replay-emitter.md).
- [API y contrato OpenAPI versionado](docs/api.md).
- [Comprobación desde copia limpia](docs/reproducibility.md).
- [Reglas de dominio y GPS](docs/domain.md).
- [Seguridad](docs/security.md).
- [Acceso local](docs/access.md).
- [Controles de CI](docs/ci-controls.md).
- [Procedencia](docs/references.md).
- [Contrato común suministrado](docs/requirements/common-spec.md).
- [Demostración requerida](docs/requirements/DEMO-REPLAY.md).
- [Rúbrica suministrada](docs/requirements/CRITERIOS-EVALUACION.md).
- [Backlog suministrado](docs/requirements/backlog.md).

## Entrega pendiente

La demostración, vídeo accesible, resultados completos y tag `entrega-final` corresponden al cierre del proyecto. El total estimado de horas lo confirmará el autor; no se inferirá del historial o las herramientas.
