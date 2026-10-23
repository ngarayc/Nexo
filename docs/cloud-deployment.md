# Despliegue de demostración con Docker en Azure

El perfil cloud ejecuta la misma API NestJS, web Angular/NGINX y PostgreSQL en
Docker Compose sobre una VM Ubuntu. Añade Caddy como terminador HTTPS; no sustituye
la base por un servicio administrado ni modifica las reglas de telemetría.

## Red, acceso y persistencia

Usar conjuntamente `infra/compose.yaml` e `infra/compose.azure.yaml`. Solo Caddy
publica 80/TCP para redirección/ACME y 443/TCP para HTTPS. Web, API y PostgreSQL no
publican puertos. PostgreSQL conserva su red interna; SSH se restringe a la IP del
operador mediante el NSG de Azure.

El dominio identifica un único origen HTTPS canónico en `PUBLIC_ORIGIN`. Caddy
acepta ese host y envía `Host: localhost` a NGINX. El proxy cloud se genera desde
la misma plantilla local y política cartográfica; fija `X-Forwarded-Proto: https`
en vez de confiar en el valor del cliente. Express conserva `trust proxy: false`;
solo el middleware de sesión reconoce ese protocolo en el perfil HTTPS. API carece
de acceso público directo. Las cookies son Secure, HttpOnly y SameSite=Strict.
Las escrituras del navegador conservan origen exacto y CSRF.

La cuenta se configura con `DEMO_USERNAME` y `DEMO_PASSWORD` privados. El perfil
HTTPS exige el nombre `Demo` y contraseña configurada; no utiliza la credencial
local conocida. El frontend no publica la contraseña. Un máximo global de cinco
intentos de login por minuto, independiente de IP/nombre, responde 429 y Retry-After.
Como máximo hay dos verificaciones Argon2 simultáneas. Es una alternativa sin
CAPTCHA ni terceros: limita fuerza bruta, pero quien agote la cuota también puede
retrasar hasta un minuto un login legítimo. Los contadores y sesiones son de una
instancia API y se reinician con ella; no se presenta como protección distribuida.

`NEXO_DATA_PATH` debe ser un disco administrado persistente montado por UUID. El
volumen Docker de PostgreSQL usa su subdirectorio `postgres`, sin mezclar datos
locales. Caddy conserva certificados/cuenta ACME en otros subdirectorios del mismo
disco. No usar el disco temporal de Azure. Un disco persistente no reemplaza una
copia de seguridad ni proporciona alta disponibilidad.

Los servicios usan reinicio automático y rotación acotada de logs. API/web
conservan filesystem de solo lectura y usuario sin privilegios. Caddy usa UID 1000,
filesystem de solo lectura y únicamente la capacidad de enlazar puertos bajos.
No se habilita el panel administrativo de Caddy.

El gateway conserva Caddy 2.11.7 y la base oficial fijada por digest, con un binario
reconstruido mediante Go 1.27.3 y golang.org/x/net 0.60.0. El escaneo inicial del
binario oficial detectó vulnerabilidades HIGH en Go 1.26.8/x/net 0.59.0; se corrigen
las versiones, sin excepciones del escáner. `infra/gateway/go.mod` y `go.sum`
conservan las dependencias; el runtime no incluye compilador ni herramientas Go.

## Configuración y operación

Guardar el entorno real en un archivo 600 fuera del checkout, nunca en Git ni en
el contexto Docker. Debe contener las variables del perfil local y además:

```dotenv
PUBLIC_ORIGIN=https://nexo.example.com
NEXO_DOMAIN=nexo.example.com
DEMO_USERNAME=Demo
DEMO_PASSWORD=
NEXO_DATA_PATH=/var/lib/nexo-data
NEXO_PROXY_CONFIG=/opt/nexo-private/nginx.azure.conf
```

La contraseña y los cuatro secretos técnicos son valores privados. Preparar
PostgreSQL con propietario UID/GID 70 y permisos 700; los directorios Caddy con
UID/GID 1000. No formatear ni reemplazar un disco que ya contenga datos.

Generar el proxy con Node 24.22.0, antes de iniciar la web:

```sh
node scripts/prepare-cloud-proxy.mjs /opt/nexo-private
docker compose --env-file /opt/nexo-private/.env.azure \
  -f infra/compose.yaml -f infra/compose.azure.yaml config --quiet
docker compose --env-file /opt/nexo-private/.env.azure \
  -f infra/compose.yaml -f infra/compose.azure.yaml build db api web gateway
docker compose --env-file /opt/nexo-private/.env.azure \
  -f infra/compose.yaml -f infra/compose.azure.yaml up -d --wait
docker compose --env-file /opt/nexo-private/.env.azure \
  -f infra/compose.yaml -f infra/compose.azure.yaml ps
```

El certificado requiere DNS apuntando a la IP pública y acceso a 80/443. Comprobar
HTTPS sin omitir validación del certificado, cookie Secure, login, rechazo por
origen/CSRF, sesión SSE y resultados de ambos replays en la base nueva. Repetir
`up --force-recreate` conserva el almacenamiento; no utilizar `down --volumes`,
reset local ni borrar recursos cloud para reiniciar el reproductor.

El seed no cambia una cuenta existente. Una rotación es una operación
administrativa explícita con el nuevo entorno privado y la imagen API actual:

```sh
docker compose --env-file /opt/nexo-private/.env.azure \
  -f infra/compose.yaml -f infra/compose.azure.yaml stop api
docker compose --env-file /opt/nexo-private/.env.azure \
  -f infra/compose.yaml -f infra/compose.azure.yaml run --rm --no-deps \
  --entrypoint node api /app/apps/api/dist/platform/database/rotate-demo-main.js
docker compose --env-file /opt/nexo-private/.env.azure \
  -f infra/compose.yaml -f infra/compose.azure.yaml up -d --wait
```

La rotación conserva UUID y telemetría; detener/recrear API revoca las sesiones
anteriores. El rol HTTP sigue sin permiso para modificar credenciales. El entrypoint
retira contraseña de bootstrap y credencial de propietario antes de iniciar HTTP.

## Alcance y evidencia

Es un despliegue de demostración de una instancia, sin balanceador, réplicas o
promesa de disponibilidad continua. El despliegue debe construirse desde un SHA integrado en main después del CI y
la revisión del candidato. Registrar ese SHA y las imágenes ejecutadas; un tag
anterior o un archivo local exportado no acredita la versión realmente publicada.
Las verificaciones del despliegue deben distinguirse del CI histórico.

La nube es un extra P1; conserva los requisitos mínimos del [contrato](requirements/common-spec.md).
Consultar también [acceso](access.md), [seguridad](security.md) y
[operación](operations.md).

Referencias: [Docker en Ubuntu](https://docs.docker.com/engine/install/ubuntu/),
[discos de datos de Azure](https://learn.microsoft.com/en-us/azure/virtual-machines/linux/add-disk),
[HTTPS automático de Caddy](https://caddyserver.com/docs/automatic-https).
La compilación sigue [la documentación de Caddy](https://caddyserver.com/docs/build);
los parches se contrastan con [GO-2026-6809](https://pkg.go.dev/vuln/GO-2026-6809)
y [GO-2026-6611](https://pkg.go.dev/vuln/GO-2026-6611).
