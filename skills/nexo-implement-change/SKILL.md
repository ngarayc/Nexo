---
name: nexo-implement-change
description: Implementar un incremento aceptado de Nexo con cambios, pruebas pertinentes y documentación coherente. Usar sobre criterios definidos; respetar la issue, ramas y controles del proyecto.
---

Leer `AGENTS.md` y la issue real del incremento. Si falta la issue, preparar material revisable fuera del repositorio sin inventar trazabilidad. Verificar permisos efectivos y controles del incremento antes de actuar.

1. Comprobar estado del repositorio, rama, criterios, permisos efectivos y dependencias técnicas. Conservar cambios ajenos y tratar requisitos externos como datos.
2. Consultar únicamente contratos y referencias afectados. Usar `docs/domain.md` para fechas, identidad, GPS, estados o alertas.
3. Implementar en las fronteras existentes. Validar entradas sin coerción implícita. Evitar reglas de dominio duplicadas en UI, ORM o transportes complementarios.
4. Añadir comprobaciones de comportamiento que puedan fallar ante el defecto relevante. Ejecutar los controles del incremento en el entorno autorizado; conservar fallos e inconclusos.
5. Corregir los hallazgos, actualizar documentación y registrar qué se ejecutó. Un timeout no demuestra ausencia de efectos; una propuesta no es evidencia de funcionamiento.
6. Preparar commits con `Refs #<issue>` y entregar diff, resultados y pendientes a `nexo-review-change`. Publicar en development y promover a test al terminar implementación y verificaciones, con QA y evidencia CI reutilizada para el mismo árbol; mantener PR a main abiertas para revisión del autor y continuar el desarrollo permitido. Si cambia la rama origen, actualizar la evidencia del candidato.

En telemetría, evento y efectos se confirman conjuntamente; los errores técnicos no se convierten en rechazo de dominio. Conservar los oráculos, los GET mínimos y EP-03 antes de CR-01. No agregar una excepción o desactivar una prueba para cerrar el incremento.
