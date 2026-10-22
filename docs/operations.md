# Operación

## Preparación local

El recorrido principal requiere Docker Engine y Compose; Node/npm se usan dentro de las imágenes. Se verificó con Engine 29.9.2 y Compose 5.6.0 en Linux/WSL, incluido acceso desde Windows por localhost. Solo web publica `127.0.0.1:8080`; API y PostgreSQL carecen de puertos publicados al host.

Desde la raíz, generar la configuración una sola vez:

```sh
bash scripts/configure-local.sh
docker compose --env-file .env.local -f infra/compose.yaml up --build -d --wait
```

El script requiere Bash y OpenSSL. Genera cuatro valores independientes de 32 bytes aleatorios en hexadecimal, usa permisos privados y rechaza reemplazar un `.env.local` existente. `.env.example` describe las variables sin valores utilizables. La configuración real queda fuera de Git y del contexto de build. Usar `compose config --quiet` para validar sin volcar secretos.

Abrir `http://localhost:8080` e ingresar con `demo` / `demo`. `PUBLIC_ORIGIN` se deriva en Compose de ese puerto canónico; no usar otro host en el navegador. `GET /api` identifica Nexo y `GET /api/health` comprueba conexión, versión de migración, usuario preparado y disponibilidad real del [dispatcher SSE](realtime.md).

## Arranque y credenciales

Compose espera la salud de PostgreSQL antes de iniciar API. Web inicia después de que arranque el contenedor API, para mantener accesibles ingesta y diagnóstico si la outbox comienza degradada. La API aplica migraciones y prepara `demo` / `demo` antes de aceptar tráfico; durante esa preparación el proxy puede responder 502. Los probes de API/web conservan la salud completa y `up --wait` no aprueba mientras persista indisponibilidad. El seed utiliza Argon2id con 19 MiB, dos iteraciones y paralelismo uno; revisa los parámetros mediante la biblioteca, sin depender de su orden serializado.

Repetir el arranque conserva ID y hash. En una base inicializada, una cuenta ausente o incompatible impide preparar el servicio: no se reemplaza silenciosamente. SQL permite únicamente el nombre `demo` y su unicidad. `DEMO_ENABLED=false` omite seed y deniega login/sesiones sin borrar la cuenta. Reiniciar API invalida sesiones; volver a ingresar conserva los datos durables.

Las migraciones usan `nexo_owner`. HTTP usa `nexo_app`, sin superusuario, creación de bases/roles, DDL o modificación de credenciales. Lee usuarios y metadatos de migración; E1 añade escritura acotada de sus seis tablas, con inmutabilidad de eventos, evidencia y payloads según [persistencia](persistence.md). El entrypoint elimina `DB_OWNER_PASSWORD` del entorno heredado por HTTP. La configuración administrativa de Docker contiene las variables necesarias para preparar el contenedor y no debe publicarse.

E3 añade SELECT/INSERT y UPDATE por columnas del [diario](replay-journal.md), manteniendo identidades, evidencia y borrado protegidos. La migración no inicia el emisor ni inserta fixture/oráculos; todavía no hay controles públicos del replay en este incremento.

La imagen API incorpora únicamente los tres archivos originales que utiliza el [verificador](replay-verification.md), además del lockfile necesario para identificar el material ejecutado. Son archivos de solo lectura, sin precarga de base; no proceden del navegador. Carga, comparación e inspección se prueban como componentes antes de componer el motor HTTP.

La preparación incorpora también el esquema interno de pg-boss y la cola, antes de servir. Sus permisos DML se limitan a ese esquema; no habilitan borrado de datos propios. [Admisión](ingestion.md) describe las rutas y [recuperación](recovery.md) describe reintentos acotados, reconciliación y cierres técnicos. No modificar manualmente sus tablas internas para operar la aplicación.

El productor usa X-API-Key de entorno para POST /api/events/batch y GET /api/ingestions/:id; Angular no recibe esa credencial. El panel puede leer el mismo recibo con sesión en GET /api/demo/ingestions/:id. El POST devuelve 200 cuando todas sus posiciones quedan clasificadas dentro del plazo; si continúa pendiente responde 503 con recibo. Consultar no crea ni reenvía trabajo. El reconciliador conserva el presupuesto tras reinicio; agotar tres oportunidades o detectar una invariante conocida cierra técnicamente el lote sin contar rechazos de dominio. Un POST que observa ese cierre devuelve 500; leer el recibo mediante GET sigue siendo 200. Reiniciar no reactiva un lote terminal. Conservar ingestionId, especialmente si la primera respuesta se perdió.

El perfil de demo/CI conserva 1.000 posiciones y 2 MiB. Las dos variables opcionales INGEST_MAX_EVENTS_PER_BATCH e INGEST_MAX_BODY_BYTES permiten reducirlo; valores incompatibles con esquema/proxy impiden arrancar. El tamaño retenido es contabilidad lógica y no espacio físico de disco.

Las [consultas de flota, historial, alertas y snapshot](queries.md) usan sesión, cuota compartida de 600/minuto y el pool de lectura. POST /api/queries/vehicle-events requiere además origen/CSRF antes del parser de 2 MiB y conserva el GET de historial. GET /api/alerts todavía devuelve la colección global; CR-01 incorpora su filtro después. Estas rutas no crean trabajo ni usan la API key como acceso del panel.

Se rechazan configuración ausente, secretos inválidos y reutilización del secreto de sesión como API key. La generación acredita el origen aleatorio; la longitud de un valor arbitrario no demuestra entropía. Los fallos HTTP no exponen cadenas de conexión, contraseñas o stacks.

## Persistencia y detención

PostgreSQL 18 monta el volumen nombrado `postgres18-data` del proyecto en `/var/lib/postgresql`, con `PGDATA=/var/lib/postgresql/18/docker`. Conservar `.env.local` y volumen entre arranques: el rol de base se inicializa al crear el directorio de datos.

```sh
docker compose --env-file .env.local -f infra/compose.yaml ps
docker compose --env-file .env.local -f infra/compose.yaml down
docker compose --env-file .env.local -f infra/compose.yaml up -d --wait
```

`down` conserva el volumen. Este recorrido no utiliza `--volumes` ni limpieza global de Docker. Las pruebas crean recursos con un identificador aleatorio propio y eliminan únicamente esos recursos al terminar; no se ejecutan contra el volumen de la aplicación.

## Desarrollo y comprobación

Para herramientas de fuentes usar Node.js 24.22.0 y npm 12.2.0:

```sh
npm ci
npm run quality
npm run build
npm run test:unit
docker compose --env-file .env.local -f infra/compose.yaml build
npm run test:integration
```

La integración necesita las imágenes locales construidas y Docker. Crea su stack db/api con configuración sintética, sin publicar puertos, comprueba migración/seed, permisos, indisponibilidad, recuperación y persistencia, y elimina su volumen propio al finalizar. Sus reportes contienen métricas, no hashes ni entornos.

`npm run schema:check` comprueba esquema/snapshots sobre una copia temporal y rechaza cambios o un generador inconcluso. No modifica migraciones ni reemplaza las pruebas SQL de exclusiones y triggers. Para ampliar el esquema, revisar el SQL generado y conservar las garantías manuales documentadas; no editar migraciones ya publicadas.

`npm run start:web` sirve el desarrollo Angular en `127.0.0.1:4200`. La API compilada necesita configuración completa y acceso de red a PostgreSQL; el recorrido soportado es Compose, cuya red privada no publica la base para procesos nativos del host.

## Navegador y CI

```sh
npx --no-install playwright install chromium
npm run test:ci-controls
npm run test:e2e
```

El recorrido de navegador crea un stack sintético nuevo por archivo en `127.0.0.1:8081`, con origen canónico `http://localhost:8081`, manteniendo `8080` para la aplicación local. Comprueba Angular compilado, dos contextos independientes, flota/historial/alertas, oráculos, carreras, cortes, recuperación, logout, proxy, cabeceras y CSP en Chromium. No guarda trace, HAR, vídeo, capturas o storageState. Los reportes crudos de cada invocación permanecen en reports/raw/system y solo se generan métricas para publicación, según [CI](ci-controls.md).

La pantalla inicial muestra conexión, totales y [flota/historial/alertas](dashboard.md) mediante [sincronización Angular](frontend-sync.md). Mientras recupera conserva la base previa señalada como posiblemente desactualizada; tras agotar cinco reintentos ofrece Reconectar. Esa acción respeta Retry-After y no reinicia la API o PostgreSQL. El productor auxiliar del recorrido de sistema usa HTTP por NGINX y mantiene la clave dentro del contenedor API, sin entregarla a la página. El reproductor controlable permanece pendiente de E3.

Los jobs de Actions preparan Node/npm y construyen sus propias imágenes. Usan tokens de lectura y una lista explícita de artefactos; los controles y su estado se describen en [CI](ci-controls.md).

El [procedimiento de copia limpia](reproducibility.md) usa configuración y proyecto propios, verifica el SHA declarado y distingue sus recursos de la instalación habitual. [Verificación](verification.md) registra el candidato comprobado, los resultados observados y los criterios de gobierno todavía pendientes.
