# Retrospectiva

## Decisiones que sostienen el resultado

El monolito modular mantiene ingesta, consultas, acceso, tiempo real y reproductor dentro de NestJS, con límites comprobados entre módulos. PostgreSQL concentra identidad persistente, transacciones, proyección y outbox; pg-boss permite admisión durable sin un cuarto servicio. Esta elección reduce coordinación operativa para la prueba y se verifica con fallos reales; no demuestra capacidad para una flota productiva arbitraria. [Arquitectura](architecture.md) y [recuperación](recovery.md) describen costes y límites.

Angular separa páginas, fachadas, transportes y adaptadores visuales. Una sola coordinación SSE por aplicación alimenta snapshot, flota, alertas y reproductor. Tabla, mapa, trayectoria y gráfico seleccionan la misma identidad exacta; las visualizaciones no reconstruyen reglas de dominio. El mapa conserva posiciones recibidas y el gráfico las velocidades suministradas, sin inferir ruta vial o precisión GPS. Las fracciones temporales se conservan para ordenar, mientras el dibujo usa aproximaciones explícitas.

El reproductor simula al productor por HTTP, con cuerpos y orden originales; pausa/reinicio controlan al emisor. La cola del servidor sigue procesando lo admitido y el diario conserva incertidumbre sin reenvío automático. La distinción evita presentar una pausa visual como control de dispositivos reales. El reset permanece local y conserva evidencia antes de recrear exclusivamente recursos sintéticos propios.

## Dificultades y correcciones comprobadas

- La unicidad concurrente exigió releer después de perder una inserción; la consulta previa no garantizaba idempotencia. Se verificó con PostgreSQL real, payload igual/conflictivo y rollback.
- Una confirmación SQL perdida no prueba rollback. Se separó la incertidumbre del rechazo y se comprobó recuperación durable, presupuesto e identidades.
- La consolidación CR-01 encontró un caso de identidad comprimida que no debía procesarse byte a byte sobre TOAST; la corrección y su prueba quedaron separadas de las propuestas comparadas.
- El cierre E4 detectó ciclos en bundles generados. Una primera exclusión global ocultaba además una importación prohibida real; una negativa adicional llevó a analizar entradas de fuentes sin excluir sus dependencias compiladas.
- La carga simultánea de mapas añadió otro estado accesible válido. Un selector global de prueba resultó ambiguo; se acotó a la región de conexión sin alterar la aplicación o expectativas. La causa exacta del fallo remoto original no se declaró demostrada cuando faltaba su reporte privado.
- El gráfico recortaba puntos situados en límites explícitos. La inspección real del canvas detectó el problema; se ajustó el recorte y se conservaron las exigencias visuales, incluida velocidad finita extrema.
- La preparación de Firefox/WebKit encontró otro defecto real: el parser de strings de WebKit redondeaba fracciones canónicas largas o las rechazaba. El recorrido de tabla reprodujo el segundo incorrecto; se sustituyó esa conversión de presentación por milisegundos del lector compartido y pasaron los casos ISO/gráfico en tres motores. El dominio conserva toda la precisión.
- Una exploración con ISO crudo parecía indicar un defecto de presentación. La prueba real mostró que la API ya canonicalizaba esa entrada; se retiró el cambio exploratorio y se conservó la regresión de integración, evitando atribuir un fallo no reproducido al producto.

[Verificación](verification.md) y las issues enlazadas conservan fallos, correcciones y alcance de cada resultado. Una repetición aprobada no borra el intento anterior.

## Trabajo agéntico y revisión

EP-03 se construyó antes de CR-01. Los procedimientos de especificación, implementación y revisión se aplicaron a cambios reales y se acompañaron de diffs, pruebas y correcciones. El autor revisó candidatos de main; la QA técnica del agente y el CI no se presentaron como intervención humana. Las barreras se demostraron en el recurso sintético archivado, sin atacar las ramas de entrega. [Gobierno](../AGENT-GOVERNANCE.md), [ciclos](AI-WORKFLOW.md) y [controles](control-demonstrations.md) permiten evaluar esas diferencias.

La comparación general/focalizada usó dos propuestas de lectura autorizadas sobre la misma base, con criterios fijados antes de los intentos. Se seleccionaron partes de ambas tras verificación. Las lecturas declaradas y bytes observados no equivalen a tokens; no se afirmó ahorro causal ni se inventaron métricas de dedicación. [El informe](../AGENT-EFFICIENCY.md) explica condiciones y límites.

## Límites y mejoras posteriores

La cuenta demo/demo, sesiones en memoria, una instancia de API y HTTP de loopback corresponden a una demostración local. Un despliegue real requeriría identidad individual, TLS, gestión de secretos, retención, observabilidad y validación de capacidad con carga representativa. No se presentan esas tareas como requisitos ya entregados.

Las colecciones completas simplifican snapshot y selección, pero necesitarían paginación/ventanas y presupuestos de memoria con históricos mayores. SSE recupera mediante snapshot, sin ACK del navegador o replay durable. Las posiciones no garantizan ubicación actual; la proyección cartográfica tiene límites polares y el proveedor de tiles puede fallar. El historial sigue siendo alternativa accesible para puntos coincidentes. Las pruebas sintéticas no certifican disponibilidad de un proveedor externo.

Estas mejoras requieren criterios propios; no sustituyen los oráculos ni amplían retrospectivamente el alcance de esta entrega. Los resultados finales, navegadores y carga pertenecen al SHA identificado en el manifiesto de la release, no a cualquier revisión posterior del repositorio.

## Hallazgos de la auditoría final

La auditoría contrastó primero la planeación vigente y después el PDF/kit originales, sin corregir durante esa revisión. Consolidó ocho hallazgos y seis unidades de corrección antes de editar fuentes. [El registro](final-audit.md) relaciona problemas, código, pruebas e issues.

El ampliado detectó una incompatibilidad del intermediario de pruebas con CSP en WebKit: el stream directo funcionaba, pero el cambio de origen impedía llegar al proxy. Se conservó el origen y se cortaron conexiones TCP reales del cliente seleccionado; pasaron los tres casos afectados en tres motores. La aplicación mantuvo su CSP.

El detalle temporal conservaba precisión en API/SQL pero no permitía inspeccionarla en la interfaz. Se incorporaron la cadena recibida y el UTC completo, con validación del mismo instante y un control accesible. Una aserción de consultas todavía esperaba los siete campos anteriores; se actualizó la lista cerrada y se comprobó el original, preservando los oráculos.

Las reglas de importación detectaban ciclos y cruces entre aplicaciones, pero faltaban límites de módulos/capas. Se añadieron negativas que comprueban el bloqueo real del comando y se ubicó AppShell en la composición. El reporter JSON podía devolver cero con violaciones; su código de salida por sí solo no probaba el bloqueo que usa CI.

También se concretaron exclusión de adjuntos con un marcador ficticio y medición de carga: latencias de cliente, memoria del servidor y uso del contenedor separados. Las métricas se atribuyen al recorrido que las obtuvo; una muestra pequeña o un ensayo parcial no acredita el ampliado final. Los resultados por candidato se consultan en CI y el manifiesto de entrega, conservando fallos anteriores.
