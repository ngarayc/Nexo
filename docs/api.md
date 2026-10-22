# API de Nexo

La [issue #24](https://github.com/ngarayc/Nexo/issues/24) consolida el contrato del backend E1. La descripción [OpenAPI 3.1.1 versionada](openapi.json) enumera las catorce operaciones actuales, incluido el transporte SSE de la [issue #26](https://github.com/ngarayc/Nexo/issues/26). Las pruebas HTTP, reglas de dominio y respuestas reales conservan la autoridad sobre su comportamiento; OpenAPI no sustituye la validación del servidor.

Origen predeterminado: `http://localhost:8080`; prefijo: `/api`. Una copia de comprobación puede configurar otro puerto/origen. El perfil soportado es HTTP local con una instancia API. No habilita CORS ni ofrece transporte de producción. Reproductor, dashboard y filtro CR-01 conservan sus incrementos posteriores y no aparecen como operaciones disponibles.

## Rutas y acceso

| Método y ruta                           | Acceso                          | Resultado                                         |
| --------------------------------------- | ------------------------------- | ------------------------------------------------- |
| `GET /api`                              | Público                         | Identidad mínima del servicio                     |
| `GET /api/health`                       | Público                         | Salud de base/esquema/dispatcher, 200 o 503       |
| `POST /api/session`                     | Origin canónico                 | Login, cookie, usuario, vencimiento y token CSRF  |
| `GET /api/session`                      | Sesión                          | Misma sesión, sin renovación del plazo            |
| `DELETE /api/session`                   | Sesión, Origin y CSRF           | 204, revocación de ese SID                        |
| `POST /api/events/batch`                | X-API-Key                       | Admisión durable y resultado o estado explícito   |
| `GET /api/ingestions/:ingestionId`      | X-API-Key                       | Recibo, incluso pendiente o con fallo técnico     |
| `GET /api/demo/ingestions/:ingestionId` | Sesión y modo demo              | Mismo recibo sin entregar la API key al navegador |
| `GET /api/vehicles?q=...`               | Sesión                          | Flota, total filtrado y resumen global            |
| `GET /api/vehicles/:vehicleId/events`   | Sesión                          | Historial completo ascendente                     |
| `POST /api/queries/vehicle-events`      | Sesión, Origin y CSRF           | El mismo historial transportando el ID en JSON    |
| `GET /api/alerts`                       | Sesión                          | Todas las alertas históricas, orden descendente   |
| `GET /api/snapshot`                     | Sesión                          | Flota y alertas de una vista SQL coherente        |
| `GET /api/stream`                       | Sesión; Origin válido si existe | SSE de cambios confirmados y controles            |

La API key procede del entorno del servidor/productor. No autoriza rutas de sesión ni se entrega a Angular. Una cookie o un token CSRF tampoco sustituyen la API key. Las rutas sin política explícita se deniegan por defecto.

El login usa `{"username":"demo","password":"demo"}` con Origin exacto. La respuesta contiene `user: { id, username }`, `expiresAt` y `csrfToken`; el SID firmado solo viaja en la cookie HttpOnly `nexo.sid`. Sesión absoluta de cuatro horas, máximo 32 sesiones; reiniciar API las invalida sin borrar la cuenta. El token se mantiene en memoria y se envía como X-CSRF-Token en logout y POST de consulta. [Acceso](access.md) documenta cuotas, revocación y precedencia.

## Entrada y clasificación

Un lote se envía como objeto con un arreglo events no vacío:

```json
{
  "events": [
    {
      "eventId": "evento-ejemplo-1",
      "vehicleId": "vehiculo-ejemplo",
      "observedAt": "2026-01-01T00:00:00Z",
      "latitude": 4.65,
      "longitude": -74.05,
      "speedKph": 81,
      "ignitionOn": true
    }
  ]
}
```

El ejemplo ilustra la forma y no debe mezclarse con la demostración oficial. JSON malformado o sobre incorrecto se rechazan antes de admitir. Dentro de un sobre válido se conserva cada posición: un registro con tipos/rangos incorrectos se rechaza individualmente, sin abortar los otros. Por eso el esquema de BatchInput admite cualquier JSON por posición; restringir todos sus items a eventos válidos alteraría la aceptación parcial requerida.

eventId y vehicleId son strings no vacíos con identidad exacta. No se recortan, normalizan o acortan. observedAt requiere fecha/calendario/zona válidos y conserva la precisión admitida. Latitud finita entre −90 y 90, longitud entre −180 y 180, velocidad finita no negativa y encendido booleano. Sin reparación ni coerción. [Dominio](domain.md) y [persistencia](persistence.md) explican representación y comparación.

Un eventId nuevo se acepta; igual ID/payload equivalente es duplicado; contenido distinto produce EVENT_ID_CONFLICT sin sobrescribir. Evento tardío permanece en historial y puede generar alerta sin cambiar latest. OVERSPEED exige velocidad estrictamente superior a 80. Índices de resultados/errores son relativos a ese lote, desde cero.

## Admisión, recibos e incertidumbre

Idempotency-Key es opcional y debe ser UUID v4. Si falta, el servidor genera el identificador. Reutilizarlo con igual cuerpo estructural recupera el mismo recibo sin nueva admisión; con otro contenido devuelve 409. La identidad de recepción es independiente de eventId. [Ingesta](ingestion.md) distingue igualdad de recepción y de evento.

El recibo incluye ingestionId, revision, complete, total, accepted, duplicates, rejected, results, errors, pendingIndexes, failedIndexes, failures y requestId. Los resultados clasificados, pendientes y fallidos particionan el total. complete solo es verdadero cuando todas las posiciones tienen clasificación de dominio; fallo técnico no incrementa rejected.

| Respuesta de POST                | Significado y siguiente acción                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| 200                              | Todas las posiciones clasificadas; revisar contadores y errores individuales             |
| 503 INGESTION_RESULT_PENDING     | Lote admitido que sigue procesándose; consultar su recibo sin reenviar                   |
| 500 INGESTION_PROCESSING_FAILED  | Fallo técnico comprobado con prefijo conservado; consultar el diagnóstico del recibo     |
| 503 INGESTION_STATUS_UNAVAILABLE | Estado durable no comprobable; conservar identificador y consultar, sin deducir rollback |
| 409 INGESTION_ID_CONFLICT        | El identificador ya representa otro cuerpo; no sobrescribe                               |
| 503 INGESTION_CAPACITY_EXCEEDED  | No se reservó capacidad para una recepción nueva                                         |

Los errores de ingesta usan application/problem+json con type, title, status, detail, code y requestId. Incluyen el mínimo accepted/duplicates/rejected/errors y los campos admission/resultsAvailable. Con lectura coherente pueden añadir el recibo completo. Si resultsAvailable=false, los ceros no prueban ausencia de efectos; no se inventan revisión, complete o listas de posiciones. admission distingue admitted, not_admitted y unknown.

GET de un recibo devuelve 200 aunque esté pendiente o tenga fallos técnicos: HTTP confirma la lectura, no el éxito de procesamiento. 404 indica que el recibo no era visible en ese corte; no descarta una admisión concurrente. Un error de acceso/SQL no se convierte en recibo o colección vacíos. [Recuperación](recovery.md) documenta tres oportunidades, backoff, reconciliación y cierres sanitizados.

## Lecturas del dominio

Flota devuelve items, total filtrado, overallTotal y summary global. q es subcadena literal sin distinguir mayúsculas; ausente/vacío conserva toda la flota. No recorta IDs, y `%`/`_` no son patrones. Solo admite q simple: repetidos, estructuras o parámetros ajenos producen 400.

Historial usa identidad exacta y contiene todos los eventos aceptados por `(instante, eventId)` ascendente. Vehículo desconocido: 200 con vehicleId, items vacío y total cero. El POST `{"vehicleId":"VEH-001"}` usa el mismo caso de uso; resuelve IDs largos o unidades no representables fielmente en URL. Sobre datos estables, GET/POST devuelven igual contenido, orden y total. Entre peticiones separadas puede haber commits distintos.

Alertas devuelve items/total/overallTotal globales, por instante/eventId descendente. Esta versión todavía no implementa el filtro vehicleId de CR-01; tampoco existe su futuro POST complementario. El snapshot reúne vehicles y alerts con schemaVersion 1 e instanceId, de una misma transacción de lectura. Comparar generación con stream.ready; cambia al reiniciar API o recuperar degradación del dispatcher. Las colecciones son completas y no tienen paginación o truncamiento implícitos.

Las vistas omiten extras arbitrarios y detalles internos. observedAt se serializa en UTC con Z y fracción exacta; no se limita a Date o nanosegundos. La presentación posterior usa español, America/Bogota y 24 horas. [Consultas](queries.md) describe campos, orden, cuotas, consistencia, planes y costes.

## Actualizaciones en vivo

El [protocolo SSE](realtime.md) define ready primero, heartbeat cada quince segundos, las notificaciones telemetry.accepted/vehicle.updated/alert.created y resincronización mediante snapshot. La API key no abre streams; no existe replay histórico por Last-Event-ID. La distribución local puede repetir un UUID ante marcado no confirmado y no acredita un ACK del navegador. Salud y acceso se vuelven a comprobar durante el uso.

## Límites y errores

| Recurso                          | Perfil predeterminado                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| Login                            | 4 KiB; usuario 1–64 bytes UTF-8 y contraseña 1–256; 10 solicitudes/minuto y dos hashes simultáneos |
| Lote                             | 2 MiB y 1.000 posiciones; 16 POST activos; 1.200 POST/minuto                                       |
| Consulta de recibo por API key   | 1.200 lecturas/minuto, separadas del contador POST                                                 |
| Lecturas de sesión, GET y POST   | 600/minuto compartidas por cuenta; 16 operaciones y pool compartido de cuatro conexiones           |
| Cuerpo de historial JSON         | 2 MiB y recepción de 15 segundos, tras comprobar acceso y reservar cupo                            |
| Aperturas SSE                    | 30/minuto por cuenta; cuatro streams por SID y dieciséis globales                                  |
| Salida SSE por conexión          | 1.000 tramas/2 MiB, incluyendo writableLength; cierre tras 15 s sin progreso                       |
| Espera HTTP de ingesta           | 60 segundos totales; proxy 75; no retiene conexión SQL mientras espera                             |
| Espera/sentencia/transacción SQL | Adquisición 2 s, lock 1 s, sentencia 5 s, cliente 6 s y transacción 10 s donde aplica              |

Los cuerpos de ingesta/consulta exigen application/json UTF-8 sin compresión. El perfil de ingesta puede reducir sus límites mediante configuración compatible. Las reservas activas/retenidas tienen límites conjuntos documentados en [operación](operations.md); tamaño lógico no equivale a disco físico.

400 identifica formato/parámetros incorrectos; 403, acceso; 408, cuerpo fuera de plazo; 413, tamaño/posiciones; 415, tipo de contenido; 429, cuota, con Retry-After cuando aplica; 503, indisponibilidad/capacidad. Login conserva sus errores de formato propios. Los errores de acceso usan JSON code/message; ingesta y errores de consulta identificados usan Problem Details. NGINX puede rechazar framing, host o tamaño antes de llegar a la autenticación; su 413 es JSON y no-store. No se promete un 403 previo a los rechazos de esa frontera.

Un timeout no demuestra rollback y una respuesta 200 no sustituye las comprobaciones del dominio. Nunca se devuelven stack traces, cadenas de conexión, claves, hashes o mensajes SQL.

## Reproducir y mantener el contrato

Desde una configuración local generada, con las imágenes construidas según [reproducibilidad](reproducibility.md):

```sh
npm run quality
npm run build
npm run test:unit
npm run test:integration
npm run test:ci-controls
npm run test:e2e
```

La integración crea proyectos/volúmenes sintéticos propios. Comprueba ambos oráculos, GET mínimos, alternativa JSON, ausencia de efectos, fallos y 10.000 eventos ordinarios. No equivale al reproductor E3 ni a la demostración con dos clientes en vivo. [Verificación](verification.md) identifica resultados y SHAs reales.

Al cambiar rutas o respuestas, actualizar OpenAPI, esta página y las pruebas pertinentes en la misma issue. La descripción sigue [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html); el [esquema oficial OAS 3.1](https://spec.openapis.org/oas/3.1/schema/2025-09-15) comprueba estructura, y la revisión debe contrastarla además con DTO/controladores y comportamiento HTTP. Los límites en bytes, igualdad exacta, partición de recibos y reglas temporales necesitan validación y pruebas del servidor: no se deducen de un generador de clientes.
