# Procedencia de decisiones y herramientas

Los requisitos suministrados se conservan en [requirements](requirements/common-spec.md) y [el backlog](requirements/backlog.md). Se distinguen de las elecciones propias de Nexo. No se copia una plataforma de seguimiento ni se atribuye código que no se haya tomado de una fuente.

| Fuente primaria                                                                   | Aplicación y límite                                                                                                                |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [Nest: módulos](https://docs.nestjs.com/modules)                                  | Composición e inyección del bootstrap; las fronteras del monolito son decisión de Nexo                                             |
| [Angular: estilo](https://angular.dev/style-guide)                                | Organización por funcionalidades y componentes; las fachadas se incorporan al existir estado                                       |
| [Angular: pruebas](https://angular.dev/guide/testing)                             | Builder de pruebas Angular; no sustituir su compilación por un transformador TypeScript genérico                                   |
| [Node 24.22.0](https://nodejs.org/en/blog/release/v24.22.0)                       | Runtime seleccionado y verificado en instalación, builds, pruebas y arranque locales                                               |
| [npm workspaces](https://docs.npmjs.com/cli/v12/using-npm/workspaces/)            | Un repositorio, manifiestos por aplicación y lockfile raíz                                                                         |
| [Skills](https://learn.chatgpt.com/docs/build-skills)                             | Formato y descubrimiento; mantener `skills/` y enlaces relativos no demuestra por sí solo uso real                                 |
| [Seguridad de Codex](https://learn.chatgpt.com/docs/enterprise/security-cookbook) | Proteger credenciales y comprobar controles efectivos; una regla escrita o un filtro de variables no acreditan una barrera técnica |

La investigación de telemetría, colas, recuperación y cartografía se incorporará a la documentación pública junto al comportamiento realmente implementado: fuente, adaptación, motivo, coste, archivos y prueba observada. El catálogo privado de planeación no forma parte del repositorio.

## Integración comprobada en el bootstrap

[SWC core](https://swc.rs/docs/usage/core) aporta la transformación de TypeScript con metadatos usada en las pruebas Nest. El hook de Vite es propio y pequeño; no reemplaza el typecheck. El parche [Vite 8.3.4](https://github.com/vitejs/vite/releases/tag/v8.3.4) resuelve el árbol vulnerable identificado por la auditoría; el coste y la verificación del override se describen en [seguridad](security.md).
