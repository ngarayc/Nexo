---
name: nexo-review-change
description: Revisar un cambio de Nexo contra sus criterios, contratos, persistencia y seguridad, con hallazgos y verificaciones reproducibles. Usar antes de promover o para verificar una corrección.
---

Leer `AGENTS.md`, criterios de la issue y diff completo respecto de su base. La revisión técnica del agente no constituye aprobación humana.

1. Derivar expectativas del contrato y los oráculos antes de evaluar el resultado del código. Consultar `docs/domain.md` cuando afecte al dominio.
2. Revisar comportamiento, errores, concurrencia y efectos persistidos. Elegir el nivel de prueba que demuestra la garantía; mocks no acreditan restricciones SQL ni renderizado real.
3. Revisar superficies afectadas de entrada, SQL, API key, sesión/CSRF, secretos, dependencias, infraestructura y CI. Comprobar que no se debiliten suites, checks o artefactos permitidos.
4. Ejecutar verificaciones pertinentes con los permisos autorizados. Distinguir planificado, ejecutado, aprobado, fallido y no ejecutado; registrar comando, preparación y resultado.
5. Informar hallazgos con ubicación, evidencia, efecto y prioridad. Incumplimiento obligatorio, pérdida de datos, acceso indebido o exposición de secretos bloquean la recomendación de integrar.
6. Verificar las correcciones y entregar dictamen sobre el diff/SHA evaluado, límites y pendientes. Un cambio posterior requiere revisar su diferencia y repetir las comprobaciones afectadas.

Comprobar los GET obligatorios y la equivalencia de sus alternativas sobre datos estables, sin efectos de negocio. Verificar conteos e identidades, no solo HTTP 200. No fabricar revisión humana, ahorro, intervención o resultados ausentes. En preparación externa sin issue, identificar ese estado y distinguir comprobaciones ejecutadas de las pendientes; no declarar cambios incorporados al repositorio.
