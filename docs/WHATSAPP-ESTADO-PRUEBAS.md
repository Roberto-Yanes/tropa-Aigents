# Estado de pruebas: canal WhatsApp

Estado al 8 de noviembre de 2026: **implementación en curso; no es un MVP terminado ni validado con WhatsApp real**. La cuenta, la base de datos y las sesiones de la instancia habitual no se utilizaron para las pruebas del canal.

## Comprobado

- `npm test`: 51 pruebas pasan en el entorno Linux de desarrollo, con directorios temporales y transporte de prueba. La suite cubre migración/copia, emisión de eventos, vinculación simulada, deduplicación, límites de entrada, número propio, dueño dedicado, mensajes antiguos, reanudación, respuestas, archivos, aprobaciones y rutas locales. No todos los casos de aceptación de la especificación tienen aún prueba individual.
- `import('baileys')` funciona en Linux con Node 24.22.1, incluido el runtime preparado de Node. Se inició después una prueba manual aislada con una cuenta de prueba: el QR se escaneó y la conexión llegó al estado conectado. El registro del dueño todavía no se completó.
- La pantalla inicial de WhatsApp se observó en una instancia temporal aislada; se verificó el aviso de riesgo y el selector de modo.
- El paquete fijado de Baileys es `7.0.0-rc14`; la revisión preliminar de licencias y el inventario se encuentran en `WHATSAPP-DEPENDENCIAS.md` y `LICENCIAS-DEPENDENCIAS.md`.

## Pendiente antes de dar por terminado

- Verificar y reforzar idempotencia de entrega frente a caída después de que WhatsApp acepte un envío pero antes de actualizar SQLite, y frente a envíos multipartes o archivos que fallen a mitad: el estado `notified` por run no garantiza entrega exactamente una vez en esa ventana.
- Completar y revisar los casos automatizados faltantes de la especificación, incluidos varios fallos y reconexiones del transporte, y comprobar los tiempos y el comportamiento del modo número propio con JID/LID reales.
- Probar vinculación QR y código, el registro del dueño, las autorizaciones, los archivos y la reconexión usando una cuenta real autorizada por la persona usuaria; registrar resultados reproducibles. El QR y la conexión inicial sí se probaron en Linux; el registro del dueño y la conversación todavía no se verificaron.
- Probar bandeja, cierre, primer aviso, arranque automático y suspensión en sistemas reales. Las implementaciones de escritorio todavía no tienen prueba manual.
- Probar la importación dentro de los paquetes instalados de Linux, Windows y macOS y las distribuciones correspondientes. No se generaron instaladores nuevos.
- Revisar las obligaciones de distribución: `libsignal@6.0.0` declara GPL-3.0 y hay paquetes opcionales LGPL. No asumir que todo el conjunto se puede distribuir sin condiciones por tener Baileys licencia MIT.
- No se han comprometido ni publicado estos cambios en GitHub.

## Correcciones del 8 de noviembre (tarde)

- Un "sí" o "no" solo se toma como respuesta cuando Tropa preguntó algo (autorización, reanudar o mensajes antiguos). Si no hay nada pendiente, llega al agente como mensaje normal.
- Los mensajes antiguos (más de 15 minutos) se agrupan durante 2,5 segundos y se confirman con una sola pregunta. Con SI se ejecutan juntos en un único pedido; los demás quedan en estado `merged` con el mismo `run_id`.
- El transporte clasifica cada mensaje (`text`, `media`, `reaction`, `protocol`, `other`). Reacciones y mensajes de protocolo no se responden nunca, lo que evita el eco de la reacción ⏳ en modo número propio. Solo `media` recibe el aviso "Por ahora solo leo texto".
- El dueño se reconoce por su JID de teléfono o por su LID (`remoteJidAlt`, `socket.user.lid`), y se guarda `whatsapp:ownerAlt`. Esto todavía no se verificó con una cuenta real.
- `BrowserService.decide` devuelve `approved`, `rejected` o `page_changed`, y WhatsApp informa cuando la acción no se realizó porque la página cambió.
- El estado `text_sent` registra que la respuesta ya se envió: si falla un archivo, el reintento envía solo los archivos.
- El código de registro del dueño se invalida tras 5 intentos fallidos.
- Se quitó el cambio global de `umask`: la carpeta de sesión 0700 ya protege los archivos que crea Baileys.
- La bandeja y la notificación muestran el estado real (sesión cerrada, bloqueado, no disponible, conectando).

## Licencias: decisión pendiente

`libsignal@6.0.0`, que llega con Baileys, declara GPL-3.0. Distribuirla dentro del instalador de una app Apache-2.0 puede obligar a publicar el conjunto bajo GPL. Opciones:

1. Descargar el canal de WhatsApp aparte, solo cuando el usuario lo activa, para que no forme parte del instalador.
2. Publicar Tropa bajo una licencia compatible con GPL-3.0.
3. Cambiar la biblioteca de WhatsApp.

Conviene consultarlo con alguien que sepa de licencias antes de publicar un instalador con WhatsApp.
