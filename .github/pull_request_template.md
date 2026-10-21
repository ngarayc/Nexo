## Resultado y alcance

Problema concreto y comportamiento resultante. Incluir todo el diff de la rama compartida, también si agrupa varios incrementos.

## Issues

Referencias `Refs #<issue>` y estado de cada criterio. Usar `Closes #<issue>` únicamente cuando la entrada en main complete todos sus criterios.

## Verificación

SHA candidato, comandos y resultados efectivos. Identificar hallazgos corregidos y límites o comprobaciones pendientes. La revisión técnica del agente no constituye revisión humana.

## Promoción

- [ ] Origen/destino permitido: development → test o test → main.
- [ ] Commits propios vinculados a issues reales; sin cambios ajenos al alcance declarado.
- [ ] QA del diff y checks del candidato satisfactorios; sin omisiones ni excepciones nuevas.
- [ ] Contenido y artefactos sin secretos o planes privados.
- [ ] Si cambia el candidato, actualizar alcance, evidencia y revisión.

La promoción a main espera la revisión del autor. Una PR pendiente permite continuar el desarrollo; no acredita aprobación del candidato nuevo.
