# Operación de la base inicial

## Preparación y alcance

Usar Node.js 24.22.0 y npm 12.2.0 desde la raíz del workspace. `npm ci` instala el árbol del lockfile; `npm run build` compila primero la API y después Angular. Las dependencias y sus versiones se conservan en los manifiestos y `package-lock.json`.

La instalación y los comandos de calidad, build y pruebas se han ejecutado en Linux/WSL. El bootstrap contiene una API identificadora y una pantalla inicial; no contiene todavía base operativa, autenticación, telemetría o reproductor.

## API

Después de compilar, `npm run start:api` ejecuta `apps/api/dist/main.js`. El valor por defecto es `127.0.0.1:3000`; `PORT` admite enteros de 1 a 65535 y `HOST` admite `127.0.0.1` o `0.0.0.0` explícito. Valores incorrectos impiden el arranque. Para el desarrollo local se mantiene loopback.

`GET /api` devuelve el nombre de la aplicación. `GET /api/health` se implementará junto a la comprobación real de PostgreSQL y esquema en E0-I03; no se utiliza el identificador como sustituto de salud de las dependencias.

## Frontend

`npm run start:web` inicia el servidor de desarrollo en `127.0.0.1:4200`. `npm run build` genera la distribución Angular en `apps/web/dist/web/browser`. La prueba de arranque HTTP comprueba que se sirve el documento Angular; la prueba de TestBed comprueba la navegación y presentación inicial. El navegador sobre el stack completo pertenece al incremento de contenedores/acceso.

Detener estos procesos con Ctrl+C. El bootstrap no crea datos persistentes ni requiere un reset. El arranque Compose y la conservación de volumen se documentarán con su implementación y prueba reales.
