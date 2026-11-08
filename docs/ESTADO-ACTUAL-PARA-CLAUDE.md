# Tropa AI: estado actual del código para Claude

Revisión del código de `community-agents/` al 8 de noviembre de 2026. Este documento describe la implementación existente, no la propuesta en `docs/mobile/`. Las rutas son relativas a la raíz del repositorio. No se inspeccionaron ni incluyen los datos privados de la instancia.

## 1. Empaquetado y arranque

La app es Electron **45.2.3**, empaquetada con electron-builder **26.18.0** (`desktop/package.json`). Los destinos configurados son `.deb` y AppImage para Linux, NSIS para Windows y DMG para macOS. La preparación empaqueta Node **24.22.1**, aunque `package.json` exige `node >=24`. `desktop/prepare.py` descarga ese runtime y verifica SHA-256. El código define un backend HTTP Node separado; no usa Tauri ni `pkg`.

En `desktop/main.cjs`, Electron crea una ventana con `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true` y `webSecurity:true`; selecciona Chrome o instala Chromium mediante Playwright cuando no lo encuentra; lanza `desktop-entry.mjs` con Node empaquetado e IPC; al recibir `ready` abre la URL. Los datos se pasan mediante `COMMUNITY_DATA_DIR = app.getPath('userData')/data`.

`desktop-entry.mjs` contiene:

```js
const {server,engine}=createApp({dir:process.env.COMMUNITY_DATA_DIR});
server.listen(Number(process.env.COMMUNITY_PORT||4318),'127.0.0.1',()=>process.send?.({type:'ready',url:`http://127.0.0.1:${server.address().port}`}));
```

El puerto por defecto es **fijo 4318**, configurable por `COMMUNITY_PORT`; `COMMUNITY_PORT=0` solicita uno aleatorio. Escucha solo en `127.0.0.1`. Si el puerto está ocupado, el arranque informa error; no busca automáticamente otro. El arranque web directo de `server.mjs` usa `PORT`, por defecto 4318.

La cookie local se genera una vez por `createApp()` y vive solo en memoria (`server.mjs`):

```js
const token = randomBytes(32).toString('hex');
// ...
if (path === '/') res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Strict; Path=/`);
// ...
if (!(req.headers.cookie || '').split(';').some(c => c.trim() === `session=${token}`))
  return send(401, { error: 'Abrí la aplicación desde su dirección local.' });
```

Se exige además `Host` exacto, `Origin` igual al origen local si está presente, y se rechaza `Sec-Fetch-Site: cross-site`. Los recursos estáticos y rutas internas de broker/extension tienen tratamiento propio antes de la verificación de cookie; no describirla como protección universal. El token cambia al reiniciar; no hay cuenta remota ni sesiones multiusuario implementadas por esta cookie.

### Instrucciones de proyecto y pruebas

No existe `community-agents/AGENTS.md`. El archivo aplicable del directorio padre en el entorno original decía literalmente:

```markdown
# ChatGPT project context

This directory is a local mirror of the ChatGPT project “Everglow Connect”.

- Treat every file under `sources/` as read-only reference material.
- Do not edit, rename, move, or delete synced project files.
- These files may be replaced the next time a task is created from this ChatGPT project.


## Project instructions

This project has no custom instructions.
```

Ese archivo padre pertenece al entorno de trabajo, no forma parte del código de esta app. Los tests usan el runner nativo `node:test` y `node:assert/strict`; se ejecutan con `npm test` (`node --test`). La última ejecución observada pasó 28 pruebas. Cubren handoff, recuperación/cancelación, límites y cookie; navegador y permisos; chat, aislamiento y delegación; archivos; operaciones/programación; cuenta principal; OAuth y broker Google. Muchas pruebas usan proveedores/servicios simulados: no prueban todos los proveedores externos reales extremo a extremo.

## 2. Modelo de datos

`engine.mjs`, constructor de `Engine`, utiliza `DatabaseSync` de `node:sqlite`, archivo `<dir>/state.sqlite`, directorio 0700 y BD 0600, con WAL. El SQL completo creado por el motor es:

```sql
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

`operations.mjs`, constructor de `Operations`, agrega:

```sql
CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, kind TEXT, body TEXT);
```

No existen tablas `agents`, `routines`, `workflows`, `schedules` ni `tasks`: los equipos y ejecuciones son objetos JSON completos en `body`; `operations.kind` distingue `routines`, `workflows` y `schedules`; las tareas mostradas son runs. `settings` guarda `mainTeamId` y permisos Google por clave `google:<teamId>` y correo asociado. Nombre/correo del perfil y algunas apariencias se guardan en `localStorage` de la interfaz (`public/app.js`), no en `settings`.

`validateTeam(value)` en `engine.mjs` devuelve `{id, name, agents, browserAccess}`; `agents` es un array de `{tools,browser,avatar,name,instructions,provider,model}`, sin ID propio. Los chats directos se buscan por `source.teamId` y `source.index`; la delegación también usa índices. **No encontré una ruta implementada de borrar/reordenar agentes/equipos**: no hay remapeo de índices. Si una modificación futura cambia el orden sin migrar referencias, el historial por índice puede atribuirse a otro agente. Las ejecuciones contienen instantáneas del equipo y participantes, pero su asociación de chat también usa índice. Tampoco hay sistema de migraciones, versión de esquema ni `PRAGMA user_version`; solo `CREATE TABLE IF NOT EXISTS`.

### Atlas / agente principal

Atlas es un nombre elegido por el usuario, no una clase ni una cuenta especial. `Engine.createMain(body)` crea un equipo `Agente principal` con un único agente y guarda su ID en `settings.mainTeamId`; exige `codex`, `claude` o `kimi`, e impide crear otro si ya existe. El nombre viene de `body.name`.

La selección de participantes para chat directo está en `Engine.chat(teamId, index, message)`:

```js
const all=teamId===this.mainTeamId()?teams:teams.filter(t=>t.id===teamId);
const participants=all.flatMap(t=>t.agents.map((agent,i)=>({agent,teamId:t.id,index:i,teamName:t.name,browserAccess:t.browserAccess})));
```

`executeDirectChat(id, controller)` calcula contactos filtrando por equipo o por ser el equipo principal y valida que `decision.destinatario` esté en esa lista. El principal puede consultar a todos los equipos; un agente de equipo ordinario solo a su propio equipo. Se excluye demo como destinatario y hay límite de seis consultas por mensaje. `teamChat()` rechaza el equipo principal y construye participantes solo del equipo elegido. Google tiene permisos separados por equipo y correo; ser principal no concede acceso global a Gmail/Calendar.

## 3. Chat y ejecuciones

Firmas reales en `engine.mjs`:

```js
chat(teamId, index, message)
teamChat(teamId, message, index=0)
async executeDirectChat(id,controller)
async executeTeamChat(id,controller)
start(teamId, objective, files=[])
startSnapshot(team, objective, source, files=[])
launch(id)
async execute(id, controller)
cancel(id)
resume(id)
```

`chat()` valida equipo/índice/mensaje y una respuesta pendiente del mismo chat, recoge hasta diez turnos completados y prepara `source` con participantes, pila y contador. `teamChat()` valida un equipo que no sea el principal, destinatario y ausencia de otro chat de equipo pendiente, y conserva hasta seis turnos. Ambos pasan por `startSnapshot()`, guardan un run y llaman `launch()`; actualmente ambos usan `source.mode='direct-collab'`, por lo que `launch()` elige `executeDirectChat()`. Existe además `executeTeamChat()`, una rama anterior para fuentes `kind='teamchat'` sin ese modo; no es la ruta producida por el `teamChat()` actual.

En `executeDirectChat()`, el proveedor recibe la solicitud, historial, intervenciones y lista de contactos. Debe devolver JSON `accion: delegar` o `accion: finalizar`. La delegación agrega una intervención, apila el destinatario y lo invoca; la respuesta del destinatario se registra y vuelve al llamador. El código verifica destinatario, estructura y límite de consultas. `run.source.stack` y `run.steps` se guardan en SQLite, no son un canal de mensajes independiente.

Los POST de chat **no esperan** la respuesta completa. `server.mjs` devuelve `201` con el run que creó el motor:

```js
if(teamChatWrite)return send(201,engine.teamChat(teamChatWrite[1],body.message,body.index));
if(chatWrite)return send(201,engine.chat(chatWrite[1],Number(chatWrite[2]),body.message));
```

`launch()` inicia la promesa sin esperarla desde el POST. Como las funciones async ejecutan código hasta el primer `await`, el run devuelto ya puede estar `running`, en vez de `queued`. `public/app.js` consulta el historial de chat o `/api/state` **cada 1.000 ms** mientras corresponde y la página está visible. No hay SSE ni WebSocket para progreso de runs. No existe streaming de tokens de respuesta en la interfaz.

Estados observados: `queued`, `running`, `completed`, `failed`, `cancelled`, `interrupted`. La secuencia normal es `queued → running → completed`; errores o cancelación llevan a `failed`/`cancelled`; al crear el motor, los runs `queued` o `running` recuperados se marcan `interrupted`. Esa recuperación recorre `runs()`, que limita a 100 filas. `resume()` admite `failed`, `interrupted` y `cancelled`, y vuelve a lanzar el mismo run. No persiste una transición intermedia explícita a `queued` durante resume.

Intervenciones reales guardadas, según `executeDirectChat()`:

```js
run.steps.push({agent:agent.name,provider:agent.provider,
  output:decision.mensaje.trim(),target:target.agent.name,
  kind:'delegation',completedAt:new Date().toISOString()});
// Al contestar: kind:'reply' para un colega o kind:'final' para 'Vos'.
```

El mensaje de usuario está en `run.source.message`; los pasos son un array en `runs.body`, no una tabla de mensajes ni eventos con IDs propios.

### Concurrencia y reanudación

`Engine.active` es un `Map` en memoria de ID a `AbortController`. Hay límite global de dos runs activos. `chat()` impide otro mensaje pendiente al mismo par equipo/índice; `teamChat()` impide otro team-chat pendiente del mismo equipo. Estas comprobaciones son por tipo de historial: no constituyen un bloqueo general por equipo. Dos chats de distintos agentes, o un chat y otro tipo de ejecución del mismo equipo, pueden coexistir si no superan el máximo global. No hay cola durable general.

`cancel(id)` llama `abort()` y devuelve el run leído antes de que termine la cancelación; el estado final se guarda en el `catch`. En una ejecución secuencial, `execute()` reinicia en `run.steps.length`; se conservan etapas completas, se vuelve a invocar la etapa que no quedó guardada. En colaboración directa se retoman `source.stack`, `calls` y pasos guardados, reejecutando la invocación pendiente. **Sí puede repetir efectos externos ya ocurridos** antes de guardar el resultado; no hay transacción distribuida ni idempotencia general. Las nuevas acciones de navegador vuelven a pasar por su control de autorización, pero eso no revierte acciones ya realizadas. El cierre accidental no reintenta automáticamente.

## 4. Proveedores

`providers.mjs` declara `codex`, `claude`, `kimi` y `demo`; **Gemini no está implementado**. Firma:

```js
export async function runProvider(agent, prompt, cwd, signal, browserAccess, googleAccess)
```

`processCall(command, args, { cwd, input = '', signal, timeout = 180000, env = nativeEnv(), includeStderr = false } = {})` usa `spawn` sin shell, con stdin/stdout/stderr y cancelación. `nativeEnv()` filtra variables con claves/tokens conocidos; las sesiones se consultan en las aplicaciones oficiales.

- **Codex:** `codex exec`, sandbox `workspace-write` o `read-only`, prompt por stdin, salida final en `.last-response.txt`. Puede agregar MCP de navegador y Google.
- **Claude:** `claude -p --output-format json`, prompt por stdin, configuración de herramientas/MCP y `--permission-mode dontAsk`; extrae `result` del JSON.
- **Kimi:** `kimi [...model, '--prompt', prompt, '--output-format', 'text']`; no recibe en este adaptador MCP de Google ni de navegador. `validateTeam()` no permite `tools` o `browser` con Kimi. El chat colaborativo exige JSON puro; como Kimi se devuelve como texto completo sin parsing específico, encabezados u otra salida del CLI pueden hacer fallar ese parsing: una consulta simple real no demuestra que la delegación Kimi funcione de punta a punta.
- **Demo:** devuelve un texto simulado tras 700 ms.

Para Codex/Claude, el timeout es 180 s normal, 480 s con herramientas y 1.200 s con navegador; Kimi usa 180 s. Son **límites**, no tiempos típicos medidos. El código no registra una distribución de latencias que permita responder cuánto suele tardar. El subprocess limita la salida combinada a 2.000.000 bytes.

## 5. Aprobaciones

En `browser-service.mjs`, firma `async approval(s,action,signal)`, la solicitud vive en `s.pending` dentro del mapa de sesiones en memoria:

```js
const timer=setTimeout(()=>finish(Error('No se recibió autorización en cinco minutos.')),300000);
const finish=err=>{clearTimeout(timer);signal.removeEventListener('abort',abort);s.pending=null;err?reject(err):resolve();};
s.pending={id:randomUUID(),action,url:s.page.url(),finish};
```

`state(id)` solo expone `{id, action, url}`; `action` depende de la operación: `type`, y según corresponda `url`, `target`, `destination`, `value` o `session`. No hay fecha de expiración persistida ni tabla de aprobaciones. `decide(id,pendingId,allow)` verifica ID y que la URL siga igual, acepta una vez o rechaza; una cancelación/cierre también rechaza. Si no contestan en cinco minutos, rechaza; tras reinicio desaparece la solicitud y la ejecución en curso pasa a interrumpida bajo la recuperación descrita.

Se pide aprobación para abrir sitios y para click/fill/select/press, con excepción de rutas de demostración; inspección y scroll no la piden. La sesión del navegador externo también requiere autorización de sitios permitidos y de cada acción indicada. El Chromium interno verifica los sitios y bloquea contraseñas en herramientas de agente.

`browser-bridge.mjs` mantiene **otra** cola en memoria, distinta de la aprobación humana:

```js
this.pending.set(id,{command:{id,runId,action,args,sites,expires:Date.now()+45000},claimed:false,finish});
```

La extensión debe reclamar y devolver resultado; vence a los 45 s, se cancela con el run y no se repite automáticamente.

Fuera del navegador: OAuth Google requiere consentimiento del usuario en Google y permisos asignados por equipo; las herramientas Google implementadas son lectura y no piden una aprobación interactiva por cada lectura. No existe un sistema general de aprobaciones persistentes para todas las acciones externas. Hay restricciones y avisos en prompts, pero no deben confundirse con un control general de ejecución.

## 6. Archivos generados

`files.mjs` define:

```js
export function workspace(dir,id){return resolve(dir,'runs',id,'workspace');}
export function addInputs(dir,id,files=[])
export function listFiles(dir,id)
export function readArtifact(dir,id,name)
```

Ruta: `<data>/runs/<run-id>/workspace/`. Todos los agentes de un mismo run comparten carpeta. En desktop `<data>` es `app.getPath('userData')/data`; en ejecución normal por defecto es `community-agents/data`.

Entradas: hasta cinco archivos `.txt`, `.md`, `.csv`, `.json`, máximo 50.000 bytes combinados. Al agente se le pide que produzca esos tipos, pero no hay medición de tamaños típicos ni restricción general de extensión de salida en `listFiles`. El listado omite nombres ocultos y symlinks, recorre hasta profundidad 5 y 100 archivos. La lectura de un artefacto rechaza rutas inseguras/symlinks y archivos superiores a 2.000.000 bytes.

`GET /api/runs/:id/files` lista `{name,size}`; con `?name=...` entrega `application/octet-stream` con `Content-Disposition: attachment`. La UI permite descargar y previsualizar con `response.text()`, de modo que no hay previsualizador binario especializado. Archivos ocultos internos como `.last-response.txt` no aparecen en el listado.

## 7. Eventos

No encontré un bus interno de eventos de aplicación (`EventEmitter` u otro) para cambios de runs, mensajes, aprobaciones o artefactos. Existen callbacks de Node, subprocess/IPC de Electron y polling de interfaz, pero no un contrato de eventos publicable. Para un gateway móvil habría que crear instrumentación o un bus; si necesita recuperación tras reinicios y reconexión, además debe persistir eventos y cursores. Eso no existe actualmente.
