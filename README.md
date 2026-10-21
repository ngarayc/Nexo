# Nexo

Telemetría sintética de flotas con NestJS, Angular y PostgreSQL. El nombre expresa el vínculo entre vehículos, información y supervisión.

**Estado:** base inicial de [E0-I01](https://github.com/ngarayc/Nexo/issues/1). API NestJS y frontend Angular con instalación reproducible, compilación y pruebas locales. Los servicios de telemetría y la demostración oficial se incorporan en los siguientes incrementos.

## Estructura inicial

- `apps/api`: API NestJS/TypeScript; composición, configuración de escucha y respuesta identificadora en `/api`.
- `apps/web`: Angular standalone, navegación y pantalla inicial.
- `skills/`: especificación, implementación y revisión; `.agents/skills/` permite descubrirlas.
- `docs/requirements/` y `fixtures/`: contratos y datos suministrados, preservados.
- `scripts/`: comprobaciones de enlaces internos y conservación de fixtures.

El diseño acordado es un monolito modular, con Angular organizado por funcionalidades y fachadas cuando se incorpore estado. PostgreSQL, Docker Compose, autenticación, telemetría, SSE, reproductor y CR-01 se incorporan en incrementos posteriores. Este bootstrap no demuestra todavía esas capacidades.

## Arranque local de la base inicial

Requisitos: **Node.js 24.22.0 y npm 12.2.0**. Dependencias directas fijadas y lockfile raíz; el gestor comprueba las versiones. Desde la raíz del repositorio:

```sh
npm ci
npm run quality
npm run build
npm run test:unit
```

Iniciar la API compilada:

```sh
npm run start:api
```

`http://127.0.0.1:3000/api` devuelve `{"name":"Nexo"}`. En otra terminal, iniciar Angular:

```sh
npm run start:web
```

Abrir `http://127.0.0.1:4200`. Estos comandos corresponden al bootstrap; Docker Compose y el acceso demo se incorporan en E0-I03/E0-I05. Consultar [operación](docs/operations.md) y [verificación](docs/verification.md) para resultados y límites.

La API y el servidor de desarrollo web están limitados a loopback por defecto. `GET /api/health` se incorporará con la comprobación real de PostgreSQL y del esquema; no se simula salud de una dependencia ausente.

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
