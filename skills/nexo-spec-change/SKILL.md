---
name: nexo-spec-change
description: Especificar una historia o CR de Nexo con criterios observables, impacto y comprobaciones antes de implementarla. Usar cuando falten decisiones; no repetir especificaciones ya suficientes.
---

Leer `AGENTS.md` desde la raíz del proyecto. Recibir la issue, comportamiento actual comprobado y resultado solicitado. Para preparación previa a una issue, producir únicamente un borrador externo al repositorio y conservar explícitamente ese estado.

1. Localizar en `docs/requirements/` las obligaciones afectadas. Si intervienen fechas, IDs, GPS o alertas, consultar `docs/domain.md`.
2. Contrastar el cambio con esas obligaciones y las decisiones vigentes. Identificar información faltante sin convertir propuestas en aprobaciones ni ampliar el alcance.
3. Describir antes/después, casos límite y criterios verificables de contenido, errores, persistencia y efectos. Derivar expectativas del contrato, no de la implementación.
4. Asignar comprobaciones al nivel que puede demostrar la garantía: unidad, PostgreSQL real, HTTP o navegador. Separar fixture oficial de datos adversariales.
5. Entregar alcance, archivos/módulos afectados, criterios, riesgos concretos y decisiones pendientes. Reutilizar el registro del incremento; evitar informes duplicados.

Para CR-01 conservar referencia estable de EP-03 sin filtro y criterios idénticos en la comparación general/focalizada. No anticipar el cambio en la base ni inventar métricas.
