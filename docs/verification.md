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

Acceso, CI remoto y validación desde copia limpia pertenecen a E0-I04–I06. Ingesta, igualdad, concurrencia y consultas se incorporan en E1; navegador/SSE en E2 y el reproductor oficial en E3. Cada capacidad conserva sus pruebas a partir de su incorporación.

La aceptación final mantiene el fixture original: primera pasada 20/2/2 y segunda sin reset 0/22/2, 20 eventos, 8 vehículos y 4 alertas, con sus identidades y orden. Estos resultados no se deducen del bootstrap ni se rellenan desde el oráculo. Los adversariales y la carga usan datos separados.

Las evidencias de CI y entrega identificarán el SHA comprobado, sus resultados y limitaciones. Un resultado de un commit anterior no se atribuye a un candidato nuevo.

## Persistencia y contenedores — E0-I03

Calidad y build de ambas aplicaciones aprobados; 21 pruebas unitarias de API y una de Angular. Las 12 pruebas de integración ejecutan PostgreSQL 18.6 y la API construida desde fuentes: migración desde vacío, cuenta única, seed repetido, restricciones SQL, permisos de runtime, entorno del proceso HTTP, desconexión/recuperación, tabla ausente, hash incompatible, recreación con persistencia, usuario eliminado y configuración inválida. Ninguna prueba omitida.

La primera ejecución detectó un montaje tmpfs interpretado como dos entradas; se corrigió su representación YAML. La siguiente identificó una validación frágil del orden de parámetros del hash Argon2; se sustituyó por `needsRehash` y verificación de contraseña de la biblioteca. Las comprobaciones posteriores pasaron sin modificar los valores exigidos para memoria, iteraciones o paralelismo.

El stack completo devuelve HTTP 200 de `/api`, `/api/health` y el documento Angular. Solo web publica `127.0.0.1:8080`; API/PostgreSQL permanecen en redes Docker. La consulta de salud desde Windows por `localhost:8080` también pasó. El documento recibe un nonce CSP coherente con su cabecera, sin `unsafe-inline`. Esto comprueba HTTP y configuración; el renderizado y seguridad de navegador se verificarán con el recorrido de sistema de E0-I04/I05.

La comprobación inicial de declaraciones de Drizzle falló con 73 diagnósticos de dependencias. La excepción explícita y su límite están documentados en [seguridad](security.md); no se presenta como reparación upstream. El árbol corregido pasó auditoría sin vulnerabilidades reportadas.
