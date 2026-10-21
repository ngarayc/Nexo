# Verificación

## Bootstrap — E0-I01

Los resultados siguientes corresponden a la base inicial y no acreditan todavía la aceptación funcional completa de Nexo.

| Comprobación                  | Resultado local                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| Instalación mediante `npm ci` | Árbol instalado desde el lockfile, sin vulnerabilidades reportadas                          |
| `npm run quality`             | Formato, lint, tipos, fronteras, enlaces internos y hashes de los cuatro fixtures correctos |
| `npm run build`               | API NestJS y Angular compilados                                                             |
| `npm run test:unit`           | 12 casos de backend y 1 de Angular aprobados; ninguna suite vacía                           |
| Arranque API compilada        | HTTP 200 de `/api`, servicio inyectado y contenido esperado                                 |
| Arranque servidor Angular     | HTTP 200 y documento de la aplicación servido en loopback                                   |

La prueba de configuración cubre valores inválidos y límites de escucha; la de HTTP verifica inyección real de Nest. El frontend se comprueba mediante su builder y TestBed/router. El HTTP del servidor Angular no se presenta como prueba de un navegador completo.

## Condiciones que se incorporan después

CI remoto y acceso se documentan abajo; validación desde copia limpia pertenece a E0-I06. Ingesta, igualdad, concurrencia y consultas se incorporan en E1; navegador/SSE del dashboard en E2 y el reproductor oficial en E3. Cada capacidad conserva sus pruebas a partir de su incorporación.

La aceptación final mantiene el fixture original: primera pasada 20/2/2 y segunda sin reset 0/22/2, 20 eventos, 8 vehículos y 4 alertas, con sus identidades y orden. Estos resultados no se deducen del bootstrap ni se rellenan desde el oráculo. Los adversariales y la carga usan datos separados.

Las evidencias de CI y entrega identificarán el SHA comprobado, sus resultados y limitaciones. Un resultado de un commit anterior no se atribuye a un candidato nuevo.

## Persistencia y contenedores — E0-I03

Calidad y build de ambas aplicaciones aprobados; 21 pruebas unitarias de API y una de Angular. Las 12 pruebas de integración ejecutan PostgreSQL 18.6 y la API construida desde fuentes: migración desde vacío, cuenta única, seed repetido, restricciones SQL, permisos de runtime, entorno del proceso HTTP, desconexión/recuperación, tabla ausente, hash incompatible, recreación con persistencia, usuario eliminado y configuración inválida. Ninguna prueba omitida.

La primera ejecución detectó un montaje tmpfs interpretado como dos entradas; se corrigió su representación YAML. La siguiente identificó una validación frágil del orden de parámetros del hash Argon2; se sustituyó por `needsRehash` y verificación de contraseña de la biblioteca. Las comprobaciones posteriores pasaron sin modificar los valores exigidos para memoria, iteraciones o paralelismo.

El stack completo devuelve HTTP 200 de `/api`, `/api/health` y el documento Angular. Solo web publica `127.0.0.1:8080`; API/PostgreSQL permanecen en redes Docker. La consulta de salud desde Windows por `localhost:8080` también pasó. El documento recibe un nonce CSP coherente con su cabecera, sin `unsafe-inline`. Esto comprueba HTTP y configuración; el renderizado y seguridad de navegador se verificarán con el recorrido de sistema de E0-I04/I05.

La comprobación inicial de declaraciones de Drizzle falló con 73 diagnósticos de dependencias. La excepción explícita y su límite están documentados en [seguridad](security.md); no se presenta como reparación upstream. El árbol corregido pasó auditoría sin vulnerabilidades reportadas.

## CI remoto — E0-I04

[La ejecución 39552267643](https://github.com/ngarayc/Nexo/actions/runs/39552267643) aprobó los cinco controles y ci-required para el origen `7d65bd2518e2501687123b3c702b142ed8a98e02`. Los cinco artefactos descargados corresponden al candidato de integración `9d373779aa138bbb27152ee34e89dfe2b03415f4` y se validaron de nuevo: 21 pruebas API, una Angular, 12 PostgreSQL y tres Chromium; imágenes y auditorías aprobadas. La [revisión técnica de PR #7](https://github.com/ngarayc/Nexo/pull/7#issuecomment-6309263608) precedió a su integración en test. Los [controles](ci-controls.md) distinguen ese recorrido de las demostraciones negativas y revisión humana pendientes.

## Acceso — E0-I05

Sobre el incremento de acceso pasaron localmente **41 pruebas API, 4 Angular, 16 de integración y 6 Chromium**, sin omisiones. Los 31 controles de CI siguen aprobados. El build compila API/Angular; las imágenes API/web/db del incremento pasaron Trivy sin altos/críticos. La auditoría de dependencias no reportó vulnerabilidades. El candidato remoto se verificará antes de promoverlo.

Las pruebas HTTP de API usan bibliotecas de sesión/CSRF/cuotas reales y sustituyen explícitamente el caso de credenciales; comprueban precedencia de origen y parser, cookies, regeneración, cuatro horas con reloj controlado, cuotas, capacidad y fallos de almacén/limitador. Pruebas del almacén verifican que escrituras y lecturas pendientes tras logout no revivan el SID. Esto no acredita por sí solo la verificación de contraseña persistida.

La integración adicional usa PostgreSQL y la imagen API reales: credenciales contra Argon2id, respuesta genérica de usuario desconocido/clave incorrecta, dos sesiones, CSRF, revocación independiente, cuatro horas absolutas con consultas previas y reloj controlado; caída SQL con 503 sin cookie; reinicio API con sesiones invalidadas y mismo registro/hash; demo deshabilitada sin borrar cuenta. Los doce casos anteriores permanecen y vuelven a ejecutarse.

Chromium pasa por NGINX y Angular compilado. Comprueba dos contextos con SIDs diferentes, cookie inaccesible a JavaScript, logout sin revocar al otro cliente, restauración por recarga sin cambio de SID, error de contraseña y limpieza del formulario, almacenamiento web vacío, host ajeno y origen falsificado rechazados, además de CSP/nonce y salud. No guarda cookies, cuerpos de sesión o trazas como evidencia publicable.

Una prueba de capacidad detectó que `regenerate` podía causar una cookie al fallar la admisión. Se destruye ahora el estado de esa solicitud antes de responder 503 y se verifica ausencia de cookie, preservación de sesiones existentes y recuperación al liberar cupo. Otro caso simula fallo de guardado y comprueba que no queda reserva ni se reintenta persistir al finalizar la respuesta.
