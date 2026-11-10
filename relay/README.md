# Relay de Tropa

Servidor WebSocket que conecta los teléfonos con Tropa Desktop. Solo reenvía sobres cifrados de extremo a extremo: no puede leer mensajes, aprobaciones ni archivos. Guarda únicamente, por sala, la lista de teléfonos autorizados y sus tokens de notificación push (`/data/rooms.json`).

## Desplegar en el servidor de Galatea

1. Creá en el DNS de `galateasoftware.com.ar` un registro `A` (o `CNAME`) `tropa` que apunte al servidor de Galatea.
2. Desde la raíz del repositorio:
   ```bash
   docker compose -f relay/docker-compose.yml up -d --build
   ```
3. Publicá `127.0.0.1:8787` con HTTPS en el proxy. Tiene que dejar pasar WebSocket.

   **Caddy**
   ```
   tropa.galateasoftware.com.ar {
     handle_path /relay/* {
       reverse_proxy 127.0.0.1:8787
     }
     handle /relay {
       reverse_proxy 127.0.0.1:8787
     }
     handle {
       root * /var/www/tropa-site/current
       file_server
     }
   }
   ```

   **Nginx**
   ```
   location = /relay {
     proxy_pass http://127.0.0.1:8787;
     proxy_http_version 1.1;
     proxy_set_header Upgrade $http_upgrade;
     proxy_set_header Connection "upgrade";
     proxy_read_timeout 3600s;
   }
   location /relay/ {
     proxy_pass http://127.0.0.1:8787/;
     proxy_http_version 1.1;
     proxy_set_header Upgrade $http_upgrade;
     proxy_set_header Connection "upgrade";
     proxy_read_timeout 3600s;
   }
   ```

   **Traefik:** quitá `ports` del compose y agregá las etiquetas del router con `tls=true` y el servicio en el puerto 8787.
4. Comprobá: `curl https://tropa.galateasoftware.com.ar/relay/health` devuelve `{"ok":true,...}`.
5. Tropa Desktop ya usa `wss://tropa.galateasoftware.com.ar/relay` por defecto. Otra dirección se puede poner en Teléfonos › Relay.

## Variables

| Variable | Valor por defecto | Uso |
| --- | --- | --- |
| `PORT` | `8787` | Puerto interno |
| `DATA_DIR` | `/data` | Lista de teléfonos autorizados y tokens push |
| `EXPO_ACCESS_TOKEN` | vacío | Opcional, para Expo Push con límites más altos |

## Seguridad

- Desktop y teléfonos se identifican firmando un desafío con su clave Ed25519. La sala es el hash de la clave de Desktop, así que nadie más puede abrirla.
- Solo los teléfonos que Desktop autoriza pueden entrar a la sala. Revocar corta la conexión en el acto.
- Una invitación de emparejamiento vence a los 15 minutos como máximo y admite pocos intentos.
- Límites: 30 tramas por segundo por conexión, 512 KB por trama y 20 teléfonos por sala.
- Las notificaciones push no llevan contenido: "Tropa necesita tu aprobación" o "Tu tarea terminó".

## Pruebas

Las pruebas de punta a punta están en `test/mobile.test.mjs` (Desktop real, relay real y un teléfono simulado). Se ejecutan con `npm test` desde la raíz.
