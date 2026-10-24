# Demostración del núcleo

Esta guía reproduce el par obligatorio con datos originales, dos clientes y controles reales. Separa la conformidad de los datos del CI, la revisión humana y demás entregables. Se conservan los resultados del contrato original y los oráculos [resumido](../fixtures/expected_sample.json) y [detallado](../fixtures/expected_detailed.json), sin modificar sus archivos. El [extracto de demo](requirements/DEMO-REPLAY.md) identifica su alcance de consulta.

## Preparar un destino propio

Requisitos: Docker/Compose, Bash y OpenSSL. Node.js 24.22.1 y npm 12.2.0 se necesitan si se utiliza el reset por CLI o se ejecutan pruebas desde el host. Desde la raíz, generar `.env.local` solo si todavía no existe. Conservarlo privado y usar un puerto disponible; 8081 es el ejemplo para no modificar el entorno habitual de 8080.

```sh
bash scripts/configure-local.sh
WEB_PORT=8081 docker compose --project-name nexo-demo --env-file .env.local -f infra/compose.yaml up --build -d --wait
```

El generador rechaza sobrescribir la configuración; no regenerarla si ya existe. El proyecto indicado debe ser sintético y propio. Mantener el mismo WEB_PORT en todos sus comandos. Para una instalación ya iniciada en 8080, se puede utilizar directamente esa URL y preparar sus datos desde el panel, sin crear otro proyecto.

Abrir http://localhost:8081 en dos sesiones independientes, por ejemplo ventana normal y privada, e ingresar con demo/demo. Ambas deben mostrar En vivo. Abrir Reproductor → Control. Si hay datos anteriores, finalizar cualquier reproducción activa, esperar las ingestas y pulsar la papelera Limpiar demostración; confirmar el borrado sin respaldo. Deben quedar cero vehículos y cero alertas. El ingreso, recarga o apertura del panel no inicia una reproducción.

El [reset por CLI](demo-reset.md) es una alternativa local: identifica el volumen, conserva evidencia técnica y lo recrea. La limpieza del panel conserva cuenta/esquema/volumen y funciona también en la demo HTTPS. En Azure, ingresar como Demo con la contraseña privada y usar el panel; los comandos locales anteriores no operan sobre la nube.

## Primer recorrido y pausa

1. Elegir 750 ms para que los cambios sean observables e iniciar desde uno de los paneles.
2. Verificar que ambas tablas/progresos cambian sin recargar y que comparten el mismo recorrido.
3. Pausar desde el otro cliente antes de terminar. Esperar Pausado: se resuelve la petición vigente y no se despacha la siguiente. El dashboard conserva En vivo; la pausa controla al emisor.
4. Minimizar o navegar no detiene el receptor. Reabrir y reanudar; continúa por la siguiente línea, sin repetir la anterior.
5. Esperar Recorrido completado y el informe Conforme. El primero es estado del motor; el segundo exige comprobar datos, diario y recibos.

| Evidencia                           | Primera ejecución              | Segunda sin reset |
| ----------------------------------- | ------------------------------ | ----------------- |
| Aceptados / duplicados / rechazados | 20/2/2                         | 0/22/2            |
| Eventos / vehículos / alertas       | 20/8/4                         | 20/8/4            |
| Recibos acumulados del par          | 24                             | 48                |
| Mensajes nuevos de dominio          | 43:20accepted,19updated,4alert | 0                 |

VEH-007 permanece STOPPED y los otros siete MOVING. En el historial de VEH-001, E-001-00 llega tarde a 95 km/h, genera alerta y se ordena antes de 01/02; latest sigue E-001-02. E-004-03 a 80 no alerta; E-005-03 a 81 sí. Alertas exactas: E-002-02, E-005-02, E-001-00 y E-005-03. El inspector muestra rechazos de líneas 22/23, índices globales 21/22 y errors.index = 0 dentro de cada petición unitaria. No hay reparación/reenvío de registros desde esa vista.

## Segundo recorrido e informes

Sin ejecutar reset, usar Reiniciar reproducción al terminar y verificar el primero. El servidor prepara Segundo recorrido oficial y envía nuevamente las 24 líneas originales con nuevas identidades de ingesta. Cambia el progreso operativo, pero conserva el dominio, las alertas y los mensajes originales: duplicados/rechazados no notifican cambios nuevos.

Esperar 0/22/2, informe individual Conforme y elegir Finalizar verificación. El cierre del escenario se muestra separado. En el historial, el primer informe conserva 20/2/2; no se reemplaza por los contadores del segundo. Cerrar sesión en un cliente no cierra el otro ni pausa el motor.

Si aparece inconcluso, no conforme o una respuesta incierta, conservar ese resultado. Reiniciar servicios conserva datos e interrumpe un emisor no terminado; no equivale a reset. Los escenarios de fallo y carga se prueban en destinos independientes y no se mezclan con este par.

## Reproducir la comprobación automatizada

Después de construir imágenes, liberar 8081 del proyecto manual sin borrar su volumen:

```sh
WEB_PORT=8081 docker compose --project-name nexo-demo --env-file .env.local -f infra/compose.yaml down
npm run test:e2e
```

El runner crea un proyecto sintético propio por archivo. [El recorrido del panel](../tests/system/replay-panel.spec.mjs) crea un dato previo por HTTP y ejecuta el mismo reset local antes de abrir ambos navegadores. Contrasta oráculos, pausa, historial/estados, recibos/intentos, huella del dominio antes/después, informes conservados y UUID de los dos streams. El productor previo solo comprueba el reset; el par oficial lo envía el motor a través de los controles Angular. Ninguna prueba escribe telemetría por SQL para simular el replay.

El [inventario de verificación](verification.md) identifica lo efectivamente ejecutado y sus límites. Durante desarrollo se usan pruebas locales focalizadas; la batería local completa se ejecuta al cerrar cada épica y GitHub conserva sus controles completos por candidato.

## Alcance de esta comprobación

Los resultados de los replays acreditan los datos y controles demostrados. Mapa, gráfica y resumen de E5 y comparación CR-01 de E4 conservan pruebas y evidencias propias; no quedan acreditados solo por coincidir 20/2/2. El [estado de entrega](verification.md#estado-de-entrega-y-despliegue) distingue la release publicada, el main desplegado y la evidencia correspondiente.
