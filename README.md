# Nexo

Telemetría sintética de flotas con NestJS, Angular y PostgreSQL. El nombre expresa el vínculo entre vehículos, información y supervisión.

**Estado:** base reproducible de E0 con NestJS, Angular y PostgreSQL en Docker, migración/seed, salud y persistencia verificadas. Login, telemetría, SSE, reproductor y CR-01 se incorporan en los siguientes incrementos.

## Arranque

Requisitos: Docker Engine y Compose, Bash y OpenSSL. Desde la raíz, generar la configuración solo la primera vez:

```sh
bash scripts/configure-local.sh
docker compose --env-file .env.local -f infra/compose.yaml up --build -d --wait
```

Abrir **http://localhost:8080**. Actualmente se muestra la pantalla inicial; `demo` / `demo` queda preparada en PostgreSQL y su interfaz de acceso pertenece a E0-I05. La salud real está en `/api/health`.

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
```

La integración necesita Docker e imágenes construidas mediante el arranque anterior; usa su stack db/api con datos sintéticos y no modifica el volumen de la aplicación. Se comprobaron 21 casos unitarios de API, uno de Angular y 12 de integración SQL/contenedores. [Verificación](docs/verification.md) describe resultados y pendientes.

- `apps/api`: monolito modular NestJS/TypeScript, configuración, persistencia y salud.
- `apps/web`: Angular por funcionalidades, navegación y pantalla inicial.
- `infra`: Compose, imágenes fijadas por digest y proxy NGINX.
- `skills/`: especificación, implementación y revisión; aliases en `.agents/skills/`.
- `docs/requirements/` y `fixtures/`: contratos y datos suministrados, preservados.
- `scripts/` y `tests/`: comprobaciones de fuentes, controles e integración.

## Calidad y gobierno

Cada cambio requiere issue y commits con referencia real. Después del bootstrap revisado, las ramas permanentes son `development`, `test` y `main`. El agente publica y promueve por PR a test tras revisión QA y CI; las PR hacia main quedan abiertas para revisión del autor mientras continúa el desarrollo. Consultar [AGENTS.md](AGENTS.md), [gobierno](AGENT-GOVERNANCE.md) y [flujo de IA](docs/AI-WORKFLOW.md).

Los controles de CI se incorporan con E0-I04 y crecen con las capacidades. No hay ejecuciones remotas acreditadas en este estado. La aceptación final conserva 20/2/2 y 0/22/2, 20 eventos, 8 vehículos y 4 alertas con las identidades de los oráculos. Los datos adversariales y de carga se aíslan del fixture oficial.

## Documentación

- [Arquitectura](docs/architecture.md).
- [Reglas de dominio y GPS](docs/domain.md).
- [Seguridad](docs/security.md).
- [Procedencia](docs/references.md).
- [Contrato común suministrado](docs/requirements/common-spec.md).
- [Demostración requerida](docs/requirements/DEMO-REPLAY.md).
- [Rúbrica suministrada](docs/requirements/CRITERIOS-EVALUACION.md).
- [Backlog suministrado](docs/requirements/backlog.md).

## Entrega pendiente

La demostración, vídeo accesible, resultados completos y tag `entrega-final` corresponden al cierre del proyecto. Las horas invertidas las confirmará el autor y se identificarán como estimadas o medidas; no se inferirán del historial o las herramientas.
