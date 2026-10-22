# Nexo

Telemetría sintética de flotas con NestJS, Angular y PostgreSQL. El nombre expresa el vínculo entre vehículos, información y supervisión.

**Estado:** base E0 con Docker, acceso demo por sesión y CI; E1 admite lotes HTTP, clasifica eventos y recupera fallos mediante cola durable, conservando identidad, tiempo y JSON exactos. Incluye proyección, alertas y outbox transaccionales, tres oportunidades por posición y reconciliación tras reinicio. Las consultas autenticadas exponen flota, historial, alertas y snapshot coherente. El stream SSE protegido publica cambios confirmados desde la outbox, con límites por conexión, heartbeat y recuperación de salud. Angular presenta flota, búsqueda, historial y alertas globales con hora24h de Bogotá; enlaza cada alerta con su observación y conserva conexión/totales al navegar. El reproductor compartido está incorporado en E3. CR-01 añade filtro exacto de alertas por API y selector visual, con cantidades visible/global, selección propia por cliente y reconexión conservada.

E3 incorpora el [diario persistente](docs/replay-journal.md) y el [verificador de datos](docs/replay-verification.md), con fuentes originales, preparación, comparación e informes históricos. El [motor HTTP compartido](docs/replay-emitter.md) conserva cuerpos originales, una sola petición, controles protegidos e incertidumbre sin reenvíos. El [panel flotante](docs/replay-panel.md) permite iniciar, pausar, reanudar, reiniciar y finalizar desde Flota/Alertas; muestra progreso, inspector e informes mediante el mismo SSE. El [reset local](docs/demo-reset.md) conserva evidencia externa y recrea exclusivamente el volumen sintético identificado. La [guía de demostración](docs/demo-guide.md) une reset, dos clientes y ambos replays; [verificación](docs/verification.md) conserva resultados y promociones de cada candidato.

E5 incorpora filtros compartidos de búsqueda/estado y un [mapa de últimas posiciones](docs/cartography.md) con Leaflet, selección del mismo historial y proveedor revisado. La tabla y los datos en vivo siguen disponibles ante un fallo cartográfico. El detalle muestra la trayectoria de observaciones y comparte selección por evento con la tabla y las alertas. El [gráfico de velocidad observada](docs/speed-chart.md) conserva las mismas muestras y selección, con referencia80 km/h y alternativa accesible en el historial. El recorrido local ordinario de E5 pasó y la presentación temporal se verificó además en Firefox/WebKit; CI, promoción/revisión del candidato y cierre de entrega conservan evidencia propia.

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

La detención conserva el volumen. Para descartar explícitamente la demo sintética, consultar [reset local](docs/demo-reset.md), su inspección y reanudación. [Operación](docs/operations.md) detalla configuración, persistencia, permisos y límites comprobados.

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

Los cinco controles remotos y `ci-required` pasaron en [el primer candidato de CI](https://github.com/ngarayc/Nexo/actions/runs/39552267643), promovido por [PR #7](https://github.com/ngarayc/Nexo/pull/7). Cada candidato nuevo repite los controles. Las [demostraciones negativas y recuperación](docs/control-demonstrations.md) están comprobadas; la revisión humana de main conserva su estado propio. Backend y dos aplicaciones Angular verifican20/2/2 y0/22/2 sin reset entre pasadas,20eventos/8vehículos/4alertas e identidades originales. El recorrido integral desde reset acredita los controles del reproductor y ambos replays mediante dos interfaces reales; el video de entrega sigue pendiente.

## Documentación

- [Arquitectura](docs/architecture.md).
- [Trazabilidad y alcance comprobado](docs/traceability.md).
- [Retrospectiva: decisiones, correcciones y límites](RETROSPECTIVA.md).
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

El paquete definitivo se publicará en [la release entrega-final](https://github.com/ngarayc/Nexo/releases/tag/entrega-final), con video MP4 y manifiesto del candidato verificado. El destino está previsto; su publicación y acceso permanecen pendientes. Antes del cierre se audita la implementación contra la planeación y todas las obligaciones, se consolidan/corrigen los hallazgos y se presenta el candidato final a revisión del autor. El libreto y la grabación se preparan sobre el resultado corregido; ningún enlace previsto acredita todavía entrega publicada.
