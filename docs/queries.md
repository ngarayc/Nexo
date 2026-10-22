# Consultas autenticadas

La [issue #20](https://github.com/ngarayc/Nexo/issues/20) añade el modelo de lectura de flota, historial, alertas y snapshot. Todas las rutas requieren sesión demo vigente, conservan `Cache-Control: no-store` y comparten la cuota de 600 consultas por minuto de la cuenta. La API key del productor no sustituye la sesión. [CR-01 #59](https://github.com/ngarayc/Nexo/issues/59) añade el filtro exacto de alertas y su transporte JSON.

| Ruta                                  | Resultado                                                       |
| ------------------------------------- | --------------------------------------------------------------- |
| `GET /api/vehicles?q=...`             | `items`, `total` filtrado, `overallTotal` y `summary` globales  |
| `GET /api/vehicles/:vehicleId/events` | `vehicleId`, `items`, `total`; historial completo               |
| `POST /api/queries/vehicle-events`    | El mismo historial, con `vehicleId` en JSON                     |
| `GET /api/alerts?vehicleId=...`       | Alertas históricas con filtro exacto opcional                   |
| `POST /api/queries/alerts`            | Las mismas alertas filtradas, con `vehicleId` en JSON           |
| `GET /api/snapshot`                   | `schemaVersion`, `instanceId`, `vehicles` y `alerts` coherentes |

## Contenido y orden

Flota e historial incluyen los siete campos del evento: eventId, vehicleId, observedAt, latitude, longitude, speedKph e ignitionOn. Flota añade status: OFF, MOVING o STOPPED. No devuelve payloads adicionales o representaciones internas. Las fechas se serializan a UTC con Z conservando la fracción exacta; se ordenan por segundo y fracción persistidos, sin convertir a Date. La presentación en español/Bogotá y 24 horas corresponde a la futura interfaz.

La flota lee la proyección confirmada y ordena por vehicleId según la codificación canónica de puntos de código. El estado aplica la misma función de dominio que la clasificación. El resumen global cuenta OFF/MOVING/STOPPED sobre esa colección, antes de filtrar, por lo que no mezcla dos lecturas concurrentes.

`q` busca una subcadena literal sin distinguir mayúsculas; no recorta ni transforma la identidad almacenada. Ausente o vacío conserva toda la flota. `%` y `_` no son comodines. La ruta admite únicamente q string: valores repetidos, estructuras como `q[x]` o parámetros ajenos devuelven 400 INVALID_QUERY. El filtrado se realiza en el modelo de lectura de la API sobre la colección completa; no se atribuye esa búsqueda parcial al índice hash.

El historial compara la clave binaria completa y devuelve todos los eventos aceptados, incluidos tardíos, por `(segundo UTC, fracción, eventId)` ascendente. Un vehículo desconocido devuelve 200 con su identificador, `items: []` y `total: 0`. La identidad sigue siendo exacta y sensible a mayúsculas, espacios, NUL o sustitutos escapados: la búsqueda parcial de flota no modifica esa regla.

Las alertas incluyen type OVERSPEED, eventId, vehicleId, observedAt, speedKph, latitude y longitude. Se ordenan por instante y eventId descendentes. GET sin filtro devuelve todas las alertas. vehicleId opcional exige un único string no vacío; compara el ID completo sin recortar, cambiar mayúsculas, normalizar ni buscar subcadenas. Vacío, repetido, array, objeto, parámetro ajeno o URI mal codificada produce 400 INVALID_QUERY. Un vehículo desconocido devuelve 200 con items vacío y total cero; overallTotal conserva el número global de alertas de esa lectura. total siempre coincide con items.length. Las colecciones son completas; no hay truncamiento o paginación implícitos.

## Historial y alertas mediante JSON

Los GET exigidos permanecen disponibles. POST /queries/vehicle-events y POST /queries/alerts transportan exactamente la misma identidad mediante `{"vehicleId":"VEH-001"}` y usan el mismo caso de consulta de su GET. Permiten IDs que exceden los límites de URL o contienen unidades que no pueden representarse fielmente en ella. Un fallo de URL/transporte no equivale a una colección vacía; el cliente debe usar la variante JSON cuando corresponda.

El guard verifica sesión, Origin exacto y X-CSRF-Token, y después consume la cuota compartida de lectura. El controlador reserva el cupo de consultas antes de leer el cuerpo. El parser común de transporte, compartido con ingesta, admite application/json UTF-8 sin compresión y hasta 2 MiB reales. Su espera de recepción es de 15 segundos; la conexión SQL solo se adquiere después de recibir y validar el documento.

Se exige objeto y vehicleId string no vacío, sin coerción, recorte o normalización. Los demás campos son inertes y no configuran acceso o consulta. JSON malformado/UTF-8 inválido da 400 MALFORMED_JSON; cuerpo/ID incorrecto, 400 INVALID_QUERY; exceso, 413 BODY_TOO_LARGE; formato ajeno, 415 UNSUPPORTED_MEDIA_TYPE. La aplicación utiliza Problem Details para esos errores; los rechazos de acceso mantienen el contrato de sesión. Un fallo SQL produce error sanitizado, sin reemplazarlo por una colección vacía.

La comparación GET/POST se verifica sobre datos estables: mismo contenido, orden y totales. Peticiones separadas pueden observar commits distintos; no se promete igualdad si se escribe entre ambas. Las consultas no admiten eventos, crean jobs o alteran recibos, proyecciones, alertas u outbox.

## Consistencia del filtro de alertas

La variante filtrada usa una sola sentencia SELECT parametrizada en el pool de consultas. Compara e.vehicle_key=$1 con Buffer.from(encodeIdentity(vehicleId)); %, _, comillas, espacios, NUL y sustitutos son datos. Un agregado global de alerts se une mediante LEFT JOIN a los eventos del vehículo que tienen alerta. La fila del agregado mantiene overallTotal incluso sin coincidencias; el adaptador retira esa fila nula de items. El conteo y los eventos comparten el snapshot de la sentencia PostgreSQL. No hay dos lecturas independientes ni conversión de fallo SQL a vacío. El orden usa segundo, fracción exacta COLLATE "C" y event_key descendentes.

No se añade DDL. El conteo global todavía requiere contar alertas; el índice hash existente puede servir para igualdad de vehículo, sin garantizar un plan o tiempo concretos. Antes de recomendar un índice deben revisarse el plan real y datos representativos. La prueba alertsConsistency ejecutó EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) sobre la sentencia capturada del adaptador real; no impone uso de índice ni un umbral de latencia.

## Snapshot y recursos

El snapshot contiene `vehicles` con el sobre de flota completo y `alerts` con el sobre global de alertas. `schemaVersion: 1` identifica el protocolo y `instanceId` es el UUID de la instancia API, provisto por RuntimeModule. El [stream](realtime.md) comparte esa identidad. Se captura antes de iniciar la lectura; una transición concurrente puede devolver la generación anterior, que el cliente debe descartar frente a ready nuevo. Reinicio o recuperación de degradación renuevan la generación; la coordinación Angular conserva su incremento propio.

`PostgresReadModel.snapshot` reserva un cliente, abre `REPEATABLE READ READ ONLY`, aplica transaction_timeout de diez segundos, lee flota y alertas y confirma antes de devolver el resultado. Así una ingesta confirmada entre ambas sentencias no añade solo su alerta a una flota anterior. El cliente se libera antes de serializar/transmitir HTTP; ante error se destruye para no devolver una transacción incierta al pool.

Todas las consultas comparten las 16 operaciones admitidas por DatabaseSlots y el pool de cuatro conexiones de consultas/sesiones/salud. No existe una cola adicional ilimitada; saturar el cupo devuelve 503 QUERY_CAPACITY_EXCEEDED antes del parser. Abortar un cuerpo libera su turno. Siguen vigentes adquisición de dos segundos, sentencia SQL de cinco y timeout cliente de seis. Esos presupuestos acotan operaciones; no garantizan tiempo de respuesta bajo cualquier volumen.

## Archivos, fuentes y límites

`modules/queries/application` define puertos, respuestas, filtros y validación pura. Los adaptadores HTTP aplican transporte/cupo y el adaptador PostgreSQL realiza consultas parametrizadas. La composición Nest conecta el pool y RuntimeInstance. `platform/http/read-body.ts` comparte la lectura incremental sin incorporar reglas de ingesta a las consultas; el adaptador de ingesta conserva sus propios errores y requestId.

[PostgreSQL: aislamiento](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-REPEATABLE-READ) sustenta la vista repetible; [node-postgres: transacciones](https://node-postgres.com/features/transactions) exige el mismo cliente. Nexo añade la liberación previa a HTTP y el presupuesto compartido. El [índice hash](https://www.postgresql.org/docs/18/indexes-types.html#INDEXES-TYPES-HASH) sirve para igualdad, no para orden ni subcadenas: historial conserva la clave completa como predicado y ordena después; flota y alertas ordenan sus colecciones. No se añaden índices que impongan un máximo oculto a los IDs.

`tests/integration/volume.test.mjs` incorpora a la integración ordinaria 10.000 eventos por HTTP en lotes de 1.000, con dos lotes simultáneos, y repite los 10.000 sin limpiar. Comprueba 100 vehículos, 4.000 alertas, 20 recibos/20.000 posiciones y ausencia de nuevos efectos de dominio en la repetición. Durante la ingesta consulta snapshots y muestrea conexiones: escrituras hasta seis, consultas hasta cuatro y cola hasta cinco incluyendo su listener adicional. El dispatcher outbox usa su conexión antes reservada dentro del presupuesto total de 16. La comparación de efectos antes/después de lecturas espera a que consumidor y dispatcher estén quietos, para no atribuir a un GET el marcado autónomo de published_at.

EXPLAIN ANALYZE verifica el historial de un vehículo con 100 eventos sobre los 10.000 persistidos. El informe local `reports/volume-sample.json`, fuera de Git, conserva tiempos, nodos y picos observados, sin IDs de entrada ni credenciales. Un índice de igualdad puede reducir filas candidatas y aun requerir ordenación residual. Los tiempos de una ejecución local no acreditan capacidad productiva ni constituyen un umbral universal de rendimiento.

Las pruebas nativas comparan ambos oráculos por HTTP, últimos estados, ocho historiales, alertas y snapshot, incluyendo ausencia de efectos persistidos. Casos separados cubren IDs largos/sustitutos, fracciones subnanosegundo, literales de búsqueda, límites de API/proxy, 16 cuerpos retenidos/aborto y cuota GET/POST compartida. Una prueba intercala una ingesta real entre las dos lecturas del snapshot y comprueba READ ONLY/REPEATABLE READ. [Verificación](verification.md) mantiene resultados y candidatos; esos resultados previos no acreditan CR-01. Las pruebas nuevas ejecutadas cubren los dos replays oficiales, igualdad literal GET/POST, POST largo/sustitutos, API/proxy 2 MiB exacto/+1, parser/acceso/cuota/cupo, una única sentencia PostgreSQL real y ausencia de efectos incluyendo cuenta y tablas de replay. Los parches originales pasaron sus casos focalizados y el SQL seleccionado conserva esa implementación; el lector compartido posterior tiene verificación propia documentada. Se conserva un fallo de ejecución sin causa determinada y su repetición diagnóstica aprobada. No se declaran rendimiento productivo ni aprobación humana de CR-01.
