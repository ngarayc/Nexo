# Arquitectura de Nexo

Nexo usa un monolito modular en NestJS y un frontend Angular organizado por funcionalidades. Ambos comparten tipos y funciones puras mediante `packages/contracts`. PostgreSQL conserva los datos y la cola durable de pg-boss.

## Aplicaciones y despliegue

```text
apps/api/             API NestJS y migraciones PostgreSQL
apps/web/             Interfaz Angular
packages/contracts/   Tipos, validaciones y comparadores puros compartidos
infra/                Dockerfiles, Compose y proxies
scripts/              Preparación, verificación, CI y CD
```

El perfil local tiene tres servicios Docker: `web` sirve Angular con NGINX y reenvía `/api` a NestJS; `api` procesa peticiones y trabajos; `db` conserva PostgreSQL en un volumen. Solo web publica `127.0.0.1:8080`.

Azure añade un cuarto contenedor, `gateway`, con Caddy. Publica 80/443, gestiona HTTPS y reenvía a web. Base y certificados están en disco persistente. [Operación local](operations.md), [perfil cloud](cloud-deployment.md) y [CD](cd.md) explican ambos recorridos.

## Backend por responsabilidades

```text
apps/api/
├── migrations/       Ocho migraciones propias, 0000–0007
└── src/
    ├── main.ts       Arranque
    ├── app.module.ts Composición de NestJS
    ├── modules/
    │   ├── access/      Autenticación, sesiones y acceso
    │   ├── ingestion/   Recepción, cola y recuperación de lotes
    │   ├── telemetry/   Reglas y clasificación de eventos
    │   ├── queries/     Lecturas de flota, historial y alertas
    │   ├── realtime/    Distribución de cambios por SSE
    │   └── demo/        Reproductor, diario e informes
    └── platform/
        ├── database/    Conexiones y transacciones
        ├── http/        Transporte HTTP y errores
        ├── queue/       Conexión y preparación de pg-boss
        └── runtime/     Salud y coordinación de la instancia
```

Los módulos contienen capacidades funcionales; platform aporta recursos técnicos compartidos. [AppModule](../apps/api/src/app.module.ts) compone los módulos de NestJS. `telemetry` se consume como código interno mediante su `public.ts` y no necesita un decorador `@Module` propio.

### Ejemplo: una alerta por velocidad

```text
modules/telemetry/
├── domain/event.ts
├── application/classify.ts
├── adapters/postgres/telemetry-transaction.ts
└── public.ts
```

- **Dominio:** `event.ts` valida el evento, compara su contenido y expone reglas puras. `isOverspeed` se implementa en [event-fields.ts](../packages/contracts/src/event-fields.ts), dentro de contracts, y se reexporta desde el dominio. La regla es `speedKph > 80`; exactamente 80 no genera alerta.
- **Caso de uso:** [ClassifyTelemetry](../apps/api/src/modules/telemetry/application/classify.ts) distingue aceptados, duplicados y rechazados. Para un evento nuevo coordina último estado, alerta y notificaciones mediante la interfaz `TelemetryEffects`.
- **Adaptador:** [TelemetryTransaction](../apps/api/src/modules/telemetry/adapters/postgres/telemetry-transaction.ts) implementa esos efectos con SQL parametrizado dentro de la transacción recibida.
- **Acceso entre módulos:** `public.ts` expone las piezas que puede consumir ingestion. [ProcessItem](../apps/api/src/modules/ingestion/adapters/postgres/process-item.ts) crea la transacción y llama al caso de uso.

Esta separación aplica puertos y adaptadores: el caso de uso expresa las operaciones que necesita y el adaptador concreta cómo ejecutarlas. Las carpetas aparecen cuando hay comportamiento útil; queries y realtime no tienen actualmente una carpeta domain.

### Recepción, persistencia y tiempo real

1. Ingestion valida el sobre HTTP y admite el lote junto con su primer trabajo de cola en una transacción.
2. El consumidor procesa cada posición mediante telemetry. Evento, último estado cuando corresponde, alerta, outbox, resultado y continuación se confirman juntos.
3. Después del commit se confirma el trabajo a pg-boss. La recuperación relee el estado durable antes de sustituir una oportunidad; un error técnico no se convierte en rechazo de dominio.
4. Realtime distribuye los mensajes confirmados de la outbox por SSE. El navegador obtiene snapshot al abrir o recuperar la conexión.
5. Queries permite consultar el estado persistido con sesión y sin efectos de negocio. Las lecturas están separadas de los comandos, sobre la misma base.

La pausa del reproductor detiene nuevos envíos del simulador; la cola del receptor continúa procesando lo admitido. [Ingesta](ingestion.md), [clasificación](classification.md), [recuperación](recovery.md) y [SSE](realtime.md) detallan garantías y límites. La outbox conserva la intención de notificar junto al cambio; su publicación no acredita recepción o renderizado en todos los navegadores.

La API tiene ocho migraciones propias y nueve tablas de aplicación. Las migraciones 0000–0004 incorporan cuenta, telemetría, recuperación, diario y corrección de identidad; 0005 permite recorridos exploratorios después del cierre; 0006 admite las credenciales local/cloud y 0007 limita la tabla a una sola cuenta. Drizzle y pg-boss mantienen sus esquemas técnicos. [Persistencia](persistence.md) y [diario](replay-journal.md) describen las restricciones. Preparar el esquema usa el propietario; HTTP usa un rol restringido, con una función de limpieza demo de alcance fijo.

## Frontend por funcionalidades

```text
apps/web/src/app/
├── features/
│   ├── access/          Login y acceso
│   ├── fleet/           Flota, mapas, historial y gráfico
│   ├── alerts/          Alertas y filtros
│   ├── demo-replay/     Panel del reproductor e informe
│   └── live-monitoring/ Sincronización de la sesión
├── platform/            HTTP, SSE, sesión, mapas y presentación común
└── shell/               Navegación y estructura general
```

En flota, `FleetPage` organiza la pantalla, `FleetFacade` mantiene vehículos/filtros/totales y `VehicleDetailFacade` conserva la selección y su historial. Tabla y mapa reciben la misma colección visible y emiten la identidad seleccionada. Los adaptadores encapsulan Leaflet y Chart.js. `LiveMonitor` coordina una conexión SSE por aplicación autenticada, instala el snapshot y aplica cambios a las colecciones compartidas.

Las señales de Angular permiten derivar las vistas del estado. Una respuesta antigua no reemplaza una selección nueva; al perder continuidad se recupera la base. Las alertas proceden del servidor. La geocerca fija calcula Dentro/Fuera y cambios entre muestras para presentación, sin crear alertas persistidas. [Dashboard](dashboard.md), [sincronización](frontend-sync.md), [cartografía](cartography.md), [gráfico](speed-chart.md) y [geocerca](geofence.md) explican el detalle.

## Contratos y controles de arquitectura

`packages/contracts` comparte DTO, identidad, tiempo exacto, validación, orden y funciones puras de estado/umbral. Tiene consumidores reales en ambas aplicaciones y no depende de NestJS, Angular o Node. El backend conserva la autoridad sobre admisión y persistencia; los validadores del navegador comprueban las respuestas recibidas.

`npm run boundaries` comprueba ciclos, dependencias entre aplicaciones, capas y accesos entre módulos. [CI](ci-controls.md) documenta sus pruebas negativas. La inyección de dependencias conecta puertos y adaptadores; las fachadas concentran el estado de presentación y la outbox vincula cambios confirmados con su distribución.

## Límites

El diseño mantiene una instancia API y una base compartida. Sesiones, cuotas y coordinación de demo son de proceso. El snapshot descarga colecciones completas; hay costes crecientes de memoria y almacenamiento. Las pruebas sintéticas acreditan sus recorridos, no capacidad productiva para una flota arbitraria. [Retrospectiva](RETROSPECTIVA.md) y [verificación](verification.md) conservan decisiones, resultados por candidato y mejoras posteriores.
