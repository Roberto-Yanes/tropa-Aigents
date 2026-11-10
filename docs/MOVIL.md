# Tropa móvil: estado de Desktop, relay y app

**Actualización:** el cliente está en el repositorio independiente
[`Roberto-Yanes/tropa-mobile`](https://github.com/Roberto-Yanes/tropa-mobile).
Las referencias históricas a `mobile-app/` de este documento corresponden a esa
copia separada. El gateway `mobile/`, el protocolo de Desktop `protocol/` y
el relay permanecen aquí. Para ejecutar los chequeos de compatibilidad entre
repositorios, establecer `TROPA_MOBILE_DIR` con la ruta del checkout móvil
antes de ejecutar `node --test test/mobile.test.mjs`.

El cliente versiona una copia de protocolo y fuentes gráficas en
`vendor/desktop/`. Su README explica cómo importarlas y regenerar los
archivos; los cambios de protocolo requieren coordinar las dos versiones.

Estado al 9 de noviembre de 2026. Especificación completa: documento «Tropa AI móvil: especificación técnica».

## Qué existe

| Pieza | Archivos | Estado |
| --- | --- | --- |
| Protocolo compartido | `protocol/crypto.mjs`, `protocol/client.mjs` | Claves Ed25519 y X25519 (tweetnacl), sobres `nacl.box`, protección contra repeticiones, invitación QR, código de 6 dígitos y cliente del teléfono. Se reutiliza tal cual en la app React Native. |
| Gateway en Desktop | `mobile/gateway.mjs`, `mobile/api.mjs`, `mobile/store.mjs` | Identidad en `<data>/mobile/identity.json` (0600), emparejamiento con confirmación del código, API móvil, eventos persistentes con cursor, idempotencia por `clientId`, push sin contenido y revocación. |
| Relay | `relay/server.mjs`, `relay/Dockerfile`, `relay/docker-compose.yml`, `relay/README.md` | Desafío y firma, salas por clave de Desktop, lista de teléfonos autorizados, invitaciones, reenvío, presencia y Expo Push. |
| Interfaz Desktop | `public/app.js` (vista `phones`), `public/index.html`, `public/style.css` | Teléfonos: dirección del relay, QR, confirmación del código, lista de teléfonos y desvincular. |
| App móvil | `mobile-app/` (Expo SDK 58, Expo Router) | Bienvenida, vinculación por QR o enlace con código de 6 dígitos, Inicio con aprobaciones, chats con agentes y equipos, tareas, detalle con pasos y descarga de archivos, flujos guardados, ajustes y desvincular. Avatares y animaciones de estado iguales a los de Desktop. Modo demostración sin compu. Ver `mobile-app/README.md`. |
| Servidor | `server.mjs` | `/api/mobile/status`, `/invite`, `/confirm`, `/settings`, `/devices/:id/revoke`. `createApp` devuelve también `mobile`. |

## Reglas

- El teléfono nunca toca la API HTTP local: todo entra por el relay y el gateway, que llama a las mismas funciones del motor.
- No hay métodos de administración en la API móvil: crear o editar equipos, permisos de Google y del navegador, WhatsApp y vincular otros teléfonos no existen ahí.
- `runs.resume` exige `confirm:true`.
- Los valores de las aprobaciones salen recortados a 40 caracteres.
- `engine.chat` acepta `channel:'mobile'` con `deviceId`; `teamChat` acepta `opts` con lo mismo. Así Desktop sabe a qué teléfono avisar cuando termina una tarea.
- La dirección del relay se toma del ajuste `mobile:relayUrl`, de la variable `TROPA_RELAY_URL` o, por defecto, de `wss://tropa.galateasoftware.com.ar/relay`. `TROPA_RELAY_URL=''` desactiva el relay.
- Desktop solo se conecta al relay si hay teléfonos vinculados o una invitación abierta.
- `mobile-app/src/protocol/` es una copia generada de `protocol/` (`npm run sync-protocol` en `mobile-app`). Lo mismo con `mobile-app/src/avatars/generated.js`, que sale de `public/tropa-animation.js`, `public/tropa-animaciones.css` y las hojas de avatares (`npm run sync`). Las pruebas fallan si se desincronizan. El protocolo no usa `TextEncoder`, `btoa` ni `atob`, porque Hermes no los garantiza.

## Pruebas

`test/mobile.test.mjs`: emparejamiento real con QR y código, QR de un solo uso, prueba falsificada, chat idempotente, eventos y reconexión, aprobaciones del navegador y de flujos, push con el teléfono desconectado, revocación, falta de poderes de administración, descarga por partes, compu apagada, manipulación y repetición de sobres, permisos del archivo de identidad y que la app use el mismo protocolo, avatares y animaciones.

La app se verificó en su versión web contra un relay y un Desktop locales: vinculación con código, chat de ida y vuelta, modo demostración, aprobaciones y detalle de tareas. También pasa `tsc --noEmit` y `expo-doctor` (20/20).

## Pendiente

- Cuenta gratuita en expo.dev y `eas init` para tener el `projectId` (lo necesitan las notificaciones push) y compilar el APK de Android.
- Pruebas con teléfonos reales (Android por APK; iPhone por Expo Go, sin push).
- Cuentas de Apple Developer y Google Play para publicar y para push en iPhone.
