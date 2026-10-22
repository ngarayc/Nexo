# Comparación agéntica de CR-01

La [issue #57](https://github.com/ngarayc/Nexo/issues/57) fija la comparación y [#59](https://github.com/ngarayc/Nexo/issues/59) implementa el filtro de alertas. Se comparan dos propuestas reales sobre el mismo cambio de API. Los resultados permiten revisar sus decisiones y correcciones; no demuestran ahorro causal ni superioridad general de una modalidad.

## Condiciones anteriores a las propuestas

El [protocolo publicado antes de comenzar](https://github.com/ngarayc/Nexo/issues/57#issuecomment-6346462641) fija los mismos criterios GET/POST, acceso, identidad, coherencia, PostgreSQL y ausencia de efectos. Base: `de7fdb03b398ca5c35ae14bc5378b85a2c430ff8`; árbol `5d86c1abdabd4d0e76d3432c509050662b6da9b4`. [EP-03](docs/agent-cycles/EP-03.md) conserva su historia sin filtro y revisión humana anterior.

Dos auxiliares recibieron contextos nuevos, sin heredar la conversación del principal, sobre el mismo checkout de Ubuntu. No se configuró un modelo diferente para ninguna condición. Ambos tuvieron autorización solo de lectura: preparar un parche, explicar pruebas y declarar archivos consultados; sin cambios, pruebas, builds, credenciales o publicación. No se crearon worktrees ni otros entornos agénticos. Compartir sistema y checkout no proporciona aislamiento técnico de credenciales.

Instrucciones operativas resumidas y depuradas, conservando las diferencias relevantes:

- **General:** cumplir los criterios de CR-01 de #59 sobre la base común; leer AGENTS y contratos, descubrir el código pertinente y devolver diff, explicación y lecturas. Conservar guardrails sin invocar workflows especializados para esta condición.
- **Focalizada:** cumplir exactamente los mismos criterios y límites; usar además `nexo-implement-change` y `nexo-review-change`, con referencias seleccionadas al caso de uso, controlador/modelo de consultas, identidad, guard/parser, pruebas y API/OpenAPI.

El contexto común tenía 6917 bytes UTF-8; SHA-256 `3d901bcf9ac3b85027aa7f759a4a112f89ef701eb96589178176b39f57ea4bb3`. Ese tamaño no incluye todos los prompts, respuestas o lecturas y no es una medición de tokens. La declaración de no invocar workflows en la condición general es del propio auxiliar; AGENTS seguía enlazándolos y no se afirma una auditoría independiente de su atención.

Ninguna propuesta recibió la de la otra. El principal esperó ambas y aplicó/verificó sus cambios secuencialmente, restaurando solo los suyos entre intentos. Durante la promoción de E3 el HEAD avanzó a `e0f298f8960f8f8baf35dd783ac227f882d32c85`, con el mismo árbol comprobado: los archivos base de ambas propuestas permanecieron idénticos. Los auxiliares devolvieron sus resultados por canales de salida; únicamente el principal conservó archivos y ejecutó comprobaciones.

## Evidencia conservada

Los parches originales incluyen implementación, pruebas y documentación propuesta; son evidencia alternativa, no dos implementaciones activas. Cada uno se verificó por bytes y SHA-256 antes de aplicarlo:

| Medida observada                                            | General                                                  | Focalizada                                                |
| ----------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| Parche original conservado                                  | [General](docs/agent-cycles/evidence/CR01-general.patch) | [Focalizado](docs/agent-cycles/evidence/CR01-focal.patch) |
| Tamaño UTF-8 del diff                                       | 47099 bytes                                              | 52136 bytes                                               |
| Archivos cambiados                                          | 10                                                       | 10                                                        |
| Líneas añadidas / retiradas                                 | 474 / 34                                                 | 543 / 45                                                  |
| Archivos distintos declarados como consultados              | 38                                                       | 38                                                        |
| Tipos API                                                   | Aprobados                                                | Aprobados                                                 |
| Pruebas de aplicación/HTTP seleccionadas                    | 16 aprobadas en 2 archivos                               | 19 aprobadas en 2 archivos                                |
| Casos nuevos PostgreSQL/API/proxy                           | 2 aprobados                                              | 2 aprobados                                               |
| Criterios comunes de aceptación                             | 5 aprobados                                              | 5 aprobados, con repetición focalizada indicada abajo     |
| Correcciones necesarias en código o pruebas de la propuesta | 0                                                        | 0                                                         |

SHA-256 general: `513472396e51441197af7f75139ef106f774e8d6fe19cebe3832faa482009ca6`.

SHA-256 focalizado: `61c4058650c0efc6f8e490aba926dcd8829a8b8c37975a3a4f08d82b3c6c7d8d`.

Las lecturas son declaraciones de los auxiliares e incluyen algunas salidas parciales o truncadas. No equivalen a archivos leídos por completo ni a un recuento independiente de contexto. Los distintos números de pruebas reflejan suites diferentes; no constituyen una puntuación de calidad o eficiencia. No están disponibles métricas exactas de tokens y no se reconstruyen horas del autor.

## Comprobación común y correcciones reales

Los cinco recorridos comunes comprobaron: fixture oficial y ambos oráculos; identidades adversariales/acceso/límites; coherencia bajo ingesta intercalada; cuota GET/POST compartida; cupo antes del parser y liberación tras aborto. Usaron API, PostgreSQL y proxy reales en recursos sintéticos propios, con instancias nuevas por caso y sin tocar servicios habituales. Verificaron ausencia de cambios en dominio, recibos, jobs, cuenta y diario. No sustituyen pruebas de una interfaz renderizada.

Antes de evaluar las propuestas, el control sobre la base detectó un error en la expectativa del propio comprobador: faltaba desempatar por eventId descendente dos alertas de igual instante. Se corrigió esa expectativa conforme al contrato. El control posterior detectó el POST ausente en E3, como correspondía al cambio incremental. Ningún fallo del comprobador se atribuye a una propuesta.

En el primer recorrido adversarial focalizado se observó `EPIPE` del cliente de pruebas. Se conservó el fallo y se añadió diagnóstico del último paso, sin cambiar semántica ni código de aplicación. La repetición puntual pasó y luego pasaron los tres recorridos restantes. La causa original quedó indeterminada; no se convierte en defecto de la propuesta, éxito del primer intento o evidencia causal sobre los workflows.

Después se aplicó cada parche completo y se ejecutaron sus tipos, dos archivos unitarios/HTTP y dos casos nuevos de integración. Ambos pasaron sin correcciones. Las pruebas ejecutaron el plan SQL real capturado: la general demuestra una sentencia coherente; la focalizada intercala escrituras entre selección y conteo y comprueba READ ONLY/REPEATABLE READ, incluso sin coincidencias. Las muestras son pequeñas y no acreditan capacidad productiva ni justifican otro índice.

Comandos focalizados reproducibles, sobre la propuesta aplicada y con su imagen API construida:

```sh
npm run typecheck --workspace @nexo/api
npm run test:unit --workspace @nexo/api -- src/modules/queries/application/queries.spec.ts src/modules/queries/adapters/http/query-http.spec.ts
node --test --test-concurrency=1 --test-name-pattern="^CR-01" tests/integration/queries.test.mjs
```

## Selección y alcance de las conclusiones

Se tomó la propuesta general como base: una sentencia parametrizada obtiene el subconjunto y conteo global en un mismo snapshot, conservando el total cuando no hay coincidencias. Se incorporó de la focalizada la lectura JSON compartida de historial y alertas y se nombró su validador según ambos usos. Es una consolidación del principal posterior a comparar las propuestas; no se atribuye íntegramente a una sola condición.

La selección reduce sentencias explícitas frente a BEGIN/configuración/selección/conteo/COMMIT y evita duplicación del parser. Es una decisión de implementación, no una medición de latencia, ahorro de tokens o rendimiento con flotas reales. El coste de contar alertas globales permanece. El refinamiento seleccionado requiere sus comprobaciones propias y queda registrado en [CR-01](docs/agent-cycles/CR-01.md) y [verificación](docs/verification.md).

La consolidación posterior pasó tipos y las 16 pruebas de aplicación/HTTP. Su primer caso de integración terminó con un error de ejecución cuyo detalle interno no quedó capturado. Se conservó ese resultado y una repetición con diagnóstico pasó sin cambios de aplicación. Una comprobación acotada adicional realizó 80 rechazos de cuerpos de 2MiB+1 por API/proxy, en historial y alertas, todos con413, sin reproducir el fallo. Esto no demuestra la causa del intento original ni convierte ese intento en aprobado; el CI del candidato conserva su comprobación propia.

Dos propuestas, un modelo sin override, un entorno compartido y un principal con contexto de ambas no forman un experimento estadístico independiente. Los resultados respaldan que ambas alternativas cumplieron los criterios ejecutados y permiten revisar una elección concreta. CI, selección visual y revisión humana del candidato nuevo conservan su evidencia propia; la aprobación de EP-03 o E3 no aprueba CR-01.

La publicación posterior del principal añadió un punto al trailer Refs y el CI lo rechazó conforme a su gramática vigente. [#62](https://github.com/ngarayc/Nexo/issues/62) registra ese fallo y la compatibilidad acotada de formato, sin excluir commits o referencias. Es posterior a comparar las propuestas: no modifica sus bases, parches o resultados ni se atribuye como corrección de una modalidad.
