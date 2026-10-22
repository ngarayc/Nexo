# Verificación desde copia limpia

Comprobar el commit declarado mediante clonación nueva, configuración nueva y un volumen propio.

## Preparación

Clonar la rama candidata, registrar `git rev-parse HEAD` como SHA comprobado y conservar ese checkout durante todo el recorrido. Requisitos: Git, Docker Engine/Compose, Bash y OpenSSL.

```sh
git clone --branch development https://github.com/ngarayc/Nexo.git nexo-check
cd nexo-check
git rev-parse HEAD
```

Node 24.22.0/npm 12.2.0 se necesitan únicamente para comprobar fuentes fuera de las imágenes.

Desde la raíz de esa copia, generar una configuración nueva. No copiar `.env.local` de otra instalación:

```sh
bash scripts/configure-local.sh
NEXO_VERIFY_PROJECT="nexo-check-$(openssl rand -hex 6)"
WEB_PORT=8081 docker compose --project-name "$NEXO_VERIFY_PROJECT" --env-file .env.local -f infra/compose.yaml up --build -d --wait
```

Conservar el nombre generado hasta terminar; identifica exclusivamente sus contenedores, redes y volumen. `8081` debe estar disponible. La aplicación habitual conserva `8080` y sus datos. El origen canónico de esta comprobación es `http://localhost:8081`.

## Recorrido

Comprobar `/api/health`, ingresar con demo/demo, navegar entre Flota/Alertas, recargar y cerrar sesión. El acceso verifica PostgreSQL real y el [dashboard](dashboard.md) confirma la base antes de mostrar totales; una base nueva está vacía y no inicia un replay automáticamente. El backend expone las [consultas autenticadas](queries.md). Repetir con dos contextos confirma sesiones independientes. Reiniciar API invalida sus sesiones y requiere login nuevo, sin borrar el usuario o la telemetría.

```sh
WEB_PORT=8081 docker compose --project-name "$NEXO_VERIFY_PROJECT" --env-file .env.local -f infra/compose.yaml restart api
WEB_PORT=8081 docker compose --project-name "$NEXO_VERIFY_PROJECT" --env-file .env.local -f infra/compose.yaml up -d --wait
```

Detener y recrear conserva el volumen y el registro/hash. Comparar identidad y hash solo en memoria, sin volcarlos a logs ni artefactos. El suite SQL también comprueba esa conservación.

```sh
WEB_PORT=8081 docker compose --project-name "$NEXO_VERIFY_PROJECT" --env-file .env.local -f infra/compose.yaml down
WEB_PORT=8081 docker compose --project-name "$NEXO_VERIFY_PROJECT" --env-file .env.local -f infra/compose.yaml up -d --wait
```

## Comprobación de fuentes

```sh
npm ci
npm run quality
npm run build
npm run test:unit
npm run test:integration
npm run test:ci-controls
```

Para el recorrido automatizado de navegador, detener antes el stack manual de esta comprobación para liberar 8081. Las pruebas crean sus proyectos propios y eliminan solo esos recursos; nunca apuntan al volumen habitual.

```sh
WEB_PORT=8081 docker compose --project-name "$NEXO_VERIFY_PROJECT" --env-file .env.local -f infra/compose.yaml down
npx --no-install playwright install chromium
npm run test:e2e
```

## Evidencia y limpieza

Registrar SHA, comandos, resultados y nombres de recursos propios sin credenciales/cookies/hashes o reportes crudos. Un fallo, omisión o prueba vacía no se registra como aprobación. Las horas del README requieren el dato del autor.

Solo si ese proyecto se creó para esta comprobación y sus datos son sintéticos prescindibles, eliminar sus recursos mediante el nombre conservado:

```sh
WEB_PORT=8081 docker compose --project-name "$NEXO_VERIFY_PROJECT" --env-file .env.local -f infra/compose.yaml down --volumes
```

No ejecutar limpieza global ni reutilizar este comando sobre el proyecto habitual. Cada incremento conserva controles remotos y revisión humana de su candidato a main; una copia limpia no los sustituye. La integración procesa ambos oráculos y 10.000 eventos ordinarios en sus propios stacks; navegador comprueba además dos clientes con tiempo real, carreras y recuperación. La [guía E3](demo-guide.md) concreta reset y reproductor controlable con dos clientes; la copia limpia del SHA final conserva su comprobación propia. [Verificación](verification.md) identifica los SHAs efectivamente ejecutados; este procedimiento no afirma que una versión posterior ya haya pasado ese recorrido.

## Exportación del SHA en la comprobación ampliada

La [validación ampliada](expanded-validation.md) implementa otra modalidad de fuente limpia: entrega git archive del SHA explícito a los builds Docker, sin archivos no registrados o configuración privada. Verifica instalación/construcción por lockfile, revisión/IDs de imágenes, arranque/login, persistencia y reset sobre recursos propios. No se presenta como una clonación ejecutada. El procedimiento manual anterior sigue disponible para el evaluador; el manifiesto identifica la modalidad y candidato realmente comprobados.
