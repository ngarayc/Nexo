# Acceso local

Una sola cuenta, **demo / demo**, sin roles, perfiles ni registro. PostgreSQL conserva su UUID y hash Argon2id; el login verifica ese hash mediante la biblioteca. Un nombre desconocido pasa por un hash de coste equivalente. No se concede acceso comparando la contraseña con un literal.

## Contratos

| Operación             | Requisitos                                            | Resultado                                                         |
| --------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| `POST /api/session`   | Origen canónico, JSON con `username` y `password`     | 200, cookie nueva, usuario público, vencimiento y token CSRF      |
| `GET /api/session`    | Cookie vigente                                        | 200 con el mismo usuario, vencimiento y token; no renueva ni rota |
| `DELETE /api/session` | Cookie vigente, origen y `X-CSRF-Token` de esa sesión | 204, revocación y limpieza de cookie                              |
| `GET /api/health`     | Público                                               | Salud mínima 200/503, sin cuota de acceso                         |

Las respuestas de sesión contienen únicamente `user: { id, username }`, `expiresAt` ISO y `csrfToken`. No contienen SID, contraseña, hash, API key ni configuración. El SID firmado se transporta exclusivamente en la cookie. Falta de sesión y credenciales incorrectas devuelven 403 con códigos distintos; usuarios desconocidos y contraseñas incorrectas comparten respuesta genérica. JSON/formato inválido devuelve 400, cuerpo excesivo 413, frecuencia excedida 429 y fallo técnico/capacidad 503. No se exponen errores internos.

El login acepta como máximo 4 KiB y cadenas de 1–64 bytes UTF-8 para usuario y 1–256 para contraseña. No convierte tipos, recorta ni trunca. Origen se comprueba antes de leer JSON; tamaño y formato preceden a cuota y hash. El parser global permanece deshabilitado para mantener esa precedencia en futuros contratos de ingesta.

## Sesión absoluta y capacidad

`nexo.sid` usa HttpOnly, SameSite=Strict y Path=/, sin Domain. El perfil soportado es HTTP local y no marca Secure: no se presenta como transporte cifrado ni como configuración de producción. El origen canónico es `http://localhost:8080`; el stack de navegador configura explícitamente `http://localhost:8081`.

Cada login correcto regenera el SID, revoca el anterior y guarda el estado antes de responder. La duración es de **cuatro horas absolutas**. Actividad, GET, `touch` y respuestas tardías no extienden el plazo. La autorización verifica vencimiento y reserva viva en cada uso, además de la limpieza de 60 segundos.

Se permiten **32 sesiones** en el proceso API. Una reserva síncrona precede al guardado; al llenarse se responde 503 `SESSION_CAPACITY_REACHED`, sin expulsar a otra sesión ni emitir cookie. El adaptador de memorystore exige reserva vigente para cada escritura y no escribe mediante `touch`. Destruir o vencer elimina la reserva antes de acceder al almacén: una escritura/lectura pendiente no puede revivirla. Las reservas vencidas y logout liberan capacidad.

El logout afecta solo a su SID. Reiniciar API invalida todas las sesiones efímeras, conservando la cuenta persistida. No hay tabla de sesiones ni servicio adicional. La solución corresponde a una única instancia; necesitaría otro almacenamiento/coordinación para varias réplicas. La revocación se publica internamente para integrar el cierre de SSE cuando exista ese módulo; E0 no declara streams implementados.

## Origen, CSRF y cuotas

El origen permitido procede de configuración validada, nunca de Host o cabeceras reenviadas. Para escrituras del navegador se rechazan Origin ajeno, `null` o ausente; después del login se exige también un token sincronizado con la sesión mediante `csrf-sync`, leído únicamente de `X-CSRF-Token`. No se habilita CORS. Las rutas sin política explícita se deniegan por defecto.

NGINX rechaza hosts ajenos a localhost/loopback y retira Forwarded, X-Forwarded-For/Host/Proto y X-Real-IP. Express mantiene `trust proxy: false`. Abrir la UI por `127.0.0.1` no convierte ese origen en otro permitido para login: utilizar la URL canónica documentada.

El login comparte **10 solicitudes por 60 segundos** entre nombres y resultados, con máximo **dos verificaciones de credenciales concurrentes**, sin cola de espera. Lecturas autenticadas comparten **600 por 60 segundos** para la cuenta. Las identidades del limitador son constantes internas, no entradas arbitrarias. La cuota excedida incluye Retry-After; un fallo del limitador o almacén bloquea el acceso. Logout no consume cuota de lecturas y salud permanece disponible. Cuotas de replay, ingesta y SSE se incorporan con sus módulos.

Angular usa formulario reactivo, fachada de acceso, adaptador HTTP y guard de navegación. Limpia la contraseña al enviar, permite pegado y mantiene el token solo en memoria. Su interceptor funcional añade CSRF únicamente a operaciones de la API propia. Revisiones del estado impiden que respuestas de una sesión anterior restituyan datos o retiren una sesión nueva. Caducidad o 403 `SESSION_REQUIRED` retiran estado protegido y solicitan acceso de nuevo. El servidor conserva la autoridad de autorización.

## Límites y evidencia

`DEMO_ENABLED=false` deshabilita login y sesiones sin borrar la cuenta. La credencial conocida permite entrar a quien alcance la demo y la conozca; hashing y CSRF no la convierten en contraseña privada. La API key del productor es independiente, permanece en backend y se comprobará al incorporar ingesta. La UI actual protege una pantalla inicial; no muestra vehículos o métricas inventadas.

[Seguridad](security.md), [operación](operations.md) y [verificación](verification.md) registran controles, reproducción y pruebas observadas. Las pruebas con credenciales sustituidas verifican el transporte; la aceptación del hash y la persistencia usa PostgreSQL y la imagen API reales.
