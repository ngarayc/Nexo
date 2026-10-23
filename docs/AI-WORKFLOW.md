# Uso de IA durante la construcción

El [ciclo EP-03](agent-cycles/EP-03.md) registra la historia funcional de alertas base, propuesta, workflows aplicados, pruebas/correcciones observadas y estado de revisión humana. Conserva su referencia anterior al filtro. [CR-01](agent-cycles/CR-01.md) registra el cambio posterior de API y [AGENT-EFFICIENCY](../AGENT-EFFICIENCY.md) la comparación ejecutada y sus limitaciones.

## Preparación de E0-I01

Solicitud: comenzar la implementación del plan, relacionar commits con issues y preparar PR, continuando hasta un bloqueo que requiera intervención, preservando los controles del reto.

El agente contrastó la solicitud con los requisitos y el flujo de bootstrap. Encontró un repositorio sin commits, Node 22.23.1/npm 12.2.0 disponibles, ausencia de Docker en PATH y falta de conexión autenticada de GitHub para Issues. La selección de Node para el proyecto sigue siendo 24.22.0.

Se prepararon externamente el cuerpo de la issue E0-I01, reglas, tres procedimientos y archivos candidatos de NestJS/Angular. La issue [#1](https://github.com/ngarayc/Nexo/issues/1) se publicó antes de incorporar los archivos al repositorio. Se resolvió el lockfile y se ejecutaron instalación limpia, calidad, compilación, 13 pruebas y arranque HTTP de las dos aplicaciones.

Esta preparación no constituye los dos ciclos funcionales requeridos. EP-03 dispone de revisión humana real en su registro; CR-01 parte de su base estable y tiene especificación, implementación y comparación de API propias. La selección visual y aceptación integral CR-01 se incorporaron después de comparar las propuestas. Su [registro](agent-cycles/CR-01.md) acredita la revisión humana efectiva posterior por PR68 y sus checks; la aprobación de E3 no se reutiliza para ese cambio.

## Registro de cada ciclo

Conservar issue, contexto mínimo, propuesta, diff/SHA, comandos y resultados, hallazgos, corrección y decisión humana real. Redactar los prompts para publicación sin conversaciones privadas, credenciales o datos ajenos. Identificar comprobaciones no ejecutadas y su causa.

La comparación general/focalizada parte del mismo estado y criterios, con modelo, herramientas y permisos registrados. Los controles de seguridad se conservan en ambos intentos. No reconstruir métricas ausentes, fabricar un error o atribuir ahorro causal sin evidencia.

El agente publica y promueve a test con revisión técnica y CI; las PR hacia main quedan abiertas para revisión del autor. Los registros de EP-03/CR-01 identifican verificación y decisiones humanas reales; la autorización general de trabajo no se presenta como revisión del diff o aprobación del software.

## Uso de los procedimientos en E0-I01

- `nexo-spec-change`: contrastar el bootstrap con el stack, delimitar capacidades posteriores y definir comprobaciones antes de incorporar el cambio.
- `nexo-implement-change`: preparar e incorporar el workspace bajo la issue #1 y ejecutar sus comandos.
- `nexo-review-change`: detectar Vite vulnerable en el árbol real, comprobar el parche, revisar metadatos de inyección y corregir la incompatibilidad de tipos del adaptador multibundler sin silenciar el typecheck.

La corrección se verificó con auditoría sin hallazgos, calidad, builds y 13 pruebas. Esta revisión técnica la realizó el agente; no se atribuye como revisión humana ni sustituye los ciclos funcionales. Sus registros propios identifican candidatos, comprobaciones y decisiones humanas reales.

## Comparación aplicada en CR-01

Dos propuestas autorizadas de solo lectura se prepararon en contextos separados sobre el mismo checkout. El principal aplicó y comprobó ambas desde el mismo árbol; no se crearon entornos agénticos adicionales. Las condiciones se publicaron antes de los intentos. La comparación conserva parches originales, lecturas declaradas, criterios comunes, resultados y un fallo de transporte indeterminado con repetición puntual aprobada. Se seleccionó la consulta de una sentencia general y el lector JSON compartido focalizado. La consolidación se verifica por separado; no se afirma ahorro causal o métricas de tokens ausentes. [El informe](../AGENT-EFFICIENCY.md) permite revisar esos hechos sin publicar conversaciones o planes privados.

## Decisiones de IA corregidas por el autor

Durante el diseño, el autor corrigió el significado de la pausa: debía controlar nuevos envíos del productor simulado, mientras el receptor seguía procesando lo ya admitido. Se adoptaron recepción durable en PostgreSQL, trabajadores independientes y un emisor HTTP con diario. [Clasificación](classification.md), [recuperación](recovery.md) y [motor](replay-emitter.md) explican la solución; las pruebas de HTTP pendiente, pausa y dos clientes comprueban sus efectos reales. Esta fue una corrección humana del criterio de diseño; los hallazgos técnicos posteriores del agente conservan su propia atribución.

El autor también retiró el editor/formulario de reparación de registros por desviar el foco del resultado. Se conservaron validación estricta, inspector de envíos y motivos de rechazo. No se implementó reparación automática o una gestión adicional de borradores. Ambas decisiones se presentan como resúmenes técnicos depurados; no se publican conversaciones privadas ni se inventa un rechazo de PR.

La [auditoría final](final-audit.md) añade revisión de cobertura y correcciones verificadas. Los candidatos nuevos mantienen revisión humana propia antes de main; las aprobaciones históricas de EP-03 y CR-01 no cubren el código posterior.
