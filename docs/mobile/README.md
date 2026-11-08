# Tropa AI móvil: dossier para implementar Android e iOS

Estado: especificación para implementar, no una función existente. Alcance: una aplicación de teléfono/tableta que se empareja con una instalación de Tropa Desktop y permite conversar con agentes, enviar tareas, ver intervenciones, autorizar acciones y leer resultados. El motor y las cuentas de IA permanecen en la computadora. La app móvil no ejecuta CLI de escritorio ni usa la sesión de ChatGPT o Claude de forma independiente. La computadora debe estar encendida y el servicio disponible; una notificación push no la despierta por sí sola.

## Punto de partida real

Proyecto: `community-agents/`. `engine.mjs` guarda equipos, ejecuciones y ajustes en SQLite; `server.mjs` ofrece una API vinculada a loopback y una cookie de sesión local. `desktop-entry.mjs` inicia el motor, `providers.mjs` usa los CLI oficiales, `browser-service.mjs` y `browser-bridge.mjs` implementan el navegador y sus autorizaciones. `public/app.js` es el cliente actual. El estado incluye `teams`, `runs`, rutinas, flujos, programación y `mainTeamId`. El chat individual usa `GET/POST /api/teams/{id}/agents/{index}/chat`; el chat de equipo usa `GET/POST /api/teams/{id}/chat` y `index` selecciona destinatario. Estos endpoints son **locales, sin contrato de acceso remoto**; no exponerlos directamente. Revisar el código vigente antes de implementar, en particular `Engine.chat`, `teamChat`, `executeDirectChat`, `resume`, `cancel` y la aprobación de navegador.

## Experiencia móvil (MVP)

1. Primera apertura: explicar que hace falta Tropa Desktop encendida; escanear el QR de emparejamiento mostrado por el escritorio.
2. Lista de equipos y agentes ordenados como escritorio. Atlas puede acceder a los equipos; cada agente conserva su alcance por equipo. La UI no es la frontera de autorización: validar en el servidor.
3. Chat con agente y chat de equipo: texto, destinatario explícito, intervenciones entre agentes, progreso, errores y cancelación. Enviar usa un identificador de operación único, confirma que fue aceptada y permite recuperar el estado tras perder conectividad.
4. Ver y decidir solicitudes pendientes del navegador y acciones externas; mostrar aplicación, cuenta, destinatario, acción y contenido relevante. Nunca aprobar automáticamente.
5. Mostrar archivos generados mediante descargas autenticadas, sin ejecutar contenido. Preview limitado a formatos seguros. La subida de adjuntos es una fase posterior salvo que se implementen límites, análisis y almacenamiento seguro.
6. Historial y estado sincronizados con escritorio; mostrar claramente desconectado, vencido, revocado o fuera de línea. Las notificaciones push son opcionales y no contienen mensajes, nombres de cuentas ni datos sensibles.

## Arquitectura de comunicación

`móvil → canal autenticado y cifrado → gateway del escritorio → motor existente`. El gateway es un servicio nuevo, separado de la cookie local y sin privilegios de administrador. Dos opciones por validar: (A) LAN con mTLS y descubrimiento explícito, sin abrir puertos públicos; (B) relay opaco con cifrado de extremo a extremo y presencia, solo como producto posterior. No asumir que el relay ni el acceso fuera de casa ya existen. Escoger tecnología tras prototipo de iOS/Android; conexiones en segundo plano pueden ser suspendidas por el SO. No usar una IP remota configurable sin autenticación fuerte; no exponer la API local a internet.

El QR representa una invitación aleatoria de un solo uso, caducidad corta, identidad y clave pública del escritorio, dirección LAN y versión de protocolo; no contiene credenciales de Google, Claude o ChatGPT. Intercambiar claves efímeras, verificar identidad del escritorio por código corto visible en ambos extremos y pedir aprobación desde escritorio. Crear identidad de dispositivo por par de claves protegidas por Android Keystore / iOS Keychain. Credenciales específicas del dispositivo con scopes, expiración, revocación y rotación. Desemparejar invalida sesiones y notificaciones. Nunca mostrar tokens en logs ni notificaciones. Diseñar bloqueo por abuso, protección contra repetición, secuencia y límites de tamaño.

## Contrato propuesto (no implementado)

Versionar bajo `/mobile/v1`; autenticación de dispositivo, autorización por recurso y control de origen en cada llamada. JSON UTF-8 con `requestId`, `deviceId`, `clientVersion`; errores `{code,message,retryable,requestId}` sin secretos. Propuestas:

- `POST /pairings/start`, `POST /pairings/complete` y `DELETE /devices/{id}`: ciclo de emparejamiento, confirmación y revocación.
- `GET /teams`, `GET /teams/{id}/agents`, `GET /conversations/{id}/events?cursor=…`: lecturas autorizadas y paginadas.
- `POST /conversations/{id}/messages`: `{clientMessageId,recipientId,text}`; idempotencia persistida por dispositivo y conversación; rechazo de llave repetida con cuerpo distinto.
- `GET /runs/{id}`, `POST /runs/{id}/cancel` y `POST /runs/{id}/resume`: estado y control; reanudar una etapa incierta siempre requiere acción explícita, no repetir tras reconexión.
- `GET /approvals`, `POST /approvals/{id}/decision`: decisión ligada a usuario, dispositivo, ejecución, destino y hash exacto de acción; una sola vez y con caducidad.
- `GET /artifacts/{runId}/{artifactId}`: permisos por ejecución, límites, Content-Disposition seguro, protección contra traversal y enlaces simbólicos.
- `GET /events?cursor=…`: SSE o WebSocket autenticado con eventos versionados `message`, `run_status`, `approval`, `artifact`, `revoked`. Recuperar eventos por cursor; heartbeat y reconexión con backoff. No depender de la entrega en vivo.

Cada comando debe pasar por la misma capa de permisos del escritorio. Las restricciones del equipo se consultan en el servidor, no se confía en nombres, índices ni `teamId` enviados por el cliente. Identificadores de agentes estables: el MVP usa índices dentro de equipos; migrar a UUID persistente y proporcionar compatibilidad para equipos existentes antes de diseñar sincronización multi-dispositivo. Versionar esquema y migraciones SQLite con copia y rollback.

## Seguridad y privacidad

No ejecutar como instrucciones el contenido de páginas, documentos, correos o mensajes de otros agentes; aislar datos y autoridad, permisos mínimos y aprobaciones para efectos externos. No guardar contraseñas ni cookies del proveedor en el móvil. Cifrar secretos con almacenes del sistema, no hardcodear secretos en binarios. Proteger pantalla de capturas solo cuando el producto lo requiera; permitir borrar datos locales y revocar dispositivos. Evaluar separación por equipo, revocación en vuelo, límites de cuota, prompt injection y consentimiento para enviar contenido a IA. Registrar eventos de auditoría sin prompts, mensajes privados, tokens ni datos de contacto; documentación explícita de retención. TLS con identidad fijada o mTLS correctamente validada; nunca deshabilitar verificación de certificados.

## Requisitos de publicación

iOS: cuenta Apple Developer, identificadores, certificados, perfiles, firma y revisión de privacidad; requisitos vigentes se confirman al publicar. Android: aplicación firmada (AAB), firma de Play y políticas de permisos/privacidad. No exponer credenciales de producción en repo o CI. Autorización Google en móvil utiliza SDK/redirecciones apropiadas: el loopback de apps de escritorio no es el método móvil recomendado. iPad y tabletas: navegación adaptativa, accesibilidad, texto dinámico y orientación. Push: APNs/FCM requieren infraestructura y consentimiento; no prometer entrega inmediata.

## Pruebas de aceptación

- Emparejar, caducar QR, rechazar código equivocado/reutilizado, revocar y verificar que el dispositivo ya no accede, incluso con una conexión abierta.
- Iniciar una tarea desde Android e iOS, comprobar ejecución real en desktop con cuentas del usuario, nombres y transferencias; consultar un compañero del mismo equipo y rechazar otro equipo.
- Equipo apagado: indicarlo, no simular ejecución; recuperar historial al volver sin duplicar tareas. Repetir POST con mismo ID entrega el mismo resultado, con payload distinto devuelve conflicto.
- Mostrar una aprobación genuina de navegador, rechazarla y confirmar que no se ejecuta; aprobar solo acción exacta una vez; probar timeout y revocación.
- Cortar la red durante envío, ejecución y descarga; reiniciar app/desktop, reconciliar cursor, pendientes e interrupción sin replay automático.
- Archivos grandes, nombres maliciosos, acceso a otro equipo, permisos revocados, prompts hostiles, logs sin secretos, rotación de claves, reloj incorrecto, varios dispositivos y límites de cuota.
- Pruebas de integración reales en Linux/Windows/macOS y dispositivos/emuladores Android/iOS; revisión de accesibilidad y rendimiento. No marcar como terminado solo con mocks.

## Orden de trabajo para Claude

1. Inspeccionar AGENTS.md, arquitectura actual y pruebas; no modificar datos del usuario. Definir mapa de migración de IDs y contrato en OpenAPI con ejemplos y estados.
2. Implementar gateway local emparejado y suite de seguridad primero; probar dos clientes falsos y revocación antes de habilitar acciones.
3. Crear cliente móvil multiplataforma (proponer React Native/Expo o Flutter tras evaluar experiencia existente), navegación, almacenamiento de claves y conexión LAN; no duplicar el motor.
4. Implementar chats, estado, cancelación y aprobaciones sobre el gateway; diseñar compatibilidad de errores y accesibilidad.
5. Integrar pruebas E2E reales y documentación de compilación y firma. Publicación, relay externo y push quedan fuera hasta contar con infraestructura y decisión del usuario.

Criterio de terminado: resultados demostrados desde al menos un dispositivo Android y uno iOS conectados a desktop, con registro reproducible; especificar claramente lo no probado.
